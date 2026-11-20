import assert from 'node:assert/strict';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { devNull, tmpdir, userInfo } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { setImmediate as immediate, setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { SYSTEM_ATLAS } from '../src/data/systemAtlas.js';
import { SOURCE_REF, SOURCE_REPOSITORY_URL } from '../src/data/sourceRepository.js';
import { sourceLinksPlugin } from './source-links-plugin.mjs';

const API = '/__vigil/source-links';
const sources = new Set();
function collect(node)
{
	for (const source of node.source.split(';')) sources.add(source.trim());
	node.children.forEach(collect);
}
collect(SYSTEM_ATLAS);
const [SOURCE_A, SOURCE_B, SOURCE_C] = [...sources];
const SENTINELS = [
	'docker-compose.yml',
	'services/web/src/App.tsx',
	'services/telemetry-collector/buildtime/exporter/delivery.go',
];
const [OPTIONAL_A, OPTIONAL_B, OPTIONAL_C] = [...sources].filter(source => !SENTINELS.includes(source));

async function put(root, source, content = 'fixture source\n')
{
	const file = join(root, source);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, content);
	return file;
}

async function seedCheckout(root)
{
	for (const source of SENTINELS) await put(root, source);
	return root;
}

const INVALID_CANDIDATES = [
	{ name: 'missing directory', setup: async () => {} },
	{ name: 'non-directory', setup: root => writeFile(root, 'user-owned file') },
	{ name: 'empty directory', setup: root => mkdir(root) },
	{
		name: 'unrelated directory with only a generic Compose file',
		setup: async root =>
		{
			await put(root, 'docker-compose.yml', 'unrelated compose');
			await put(root, 'user-owned.txt', 'keep this unrelated directory');
		},
	},
	...SENTINELS.flatMap(source => ['missing file', 'directory', 'escaping symlink'].map(problem => ({
		name: `${problem}: ${source}`,
		setup: async (root, outside) =>
		{
			await seedCheckout(root);
			const file = join(root, source);
			await rm(file);
			if (problem === 'directory') await mkdir(file);
			if (problem === 'escaping symlink') await symlink(await put(outside, source, 'outside sentinel'), file);
		},
	}))),
];

async function snapshot(file)
{
	try
	{
		const info = await lstat(file);
		if (info.isSymbolicLink()) return ['symlink', await readlink(file)];
		if (!info.isDirectory()) return ['file', await readFile(file, 'utf8')];
		const children = (await readdir(file)).sort();
		return ['directory', await Promise.all(children.map(async name => [name, await snapshot(join(file, name))]))];
	}
	catch (error)
	{
		if (error.code === 'ENOENT') return null;
		throw error;
	}
}

function assertSources(response, expected = SENTINELS)
{
	assert.deepEqual(Object.keys(response.body.links).sort(), [...expected].sort());
}

function deferred()
{
	let resolvePromise;
	const promise = new Promise(accept => { resolvePromise = accept; });
	return { promise, resolve: resolvePromise };
}

async function waitFor(predicate)
{
	for (let attempt = 0; attempt < 100; attempt++)
	{
		if (predicate()) return;
		await delay(10);
	}
	assert.fail('Timed out waiting for fixture requests');
}

async function fixture(t, options = {})
{
	const base = await mkdtemp(join(tmpdir(), 'vigil-source-links-test-'));
	const root = join(base, 'spec');
	const temporaryRoot = join(base, 'scratch');
	await mkdir(root);
	await mkdir(temporaryRoot);
	let gitCalls = 0;
	const plugin = sourceLinksPlugin({
		environment: options.environment ?? {},
		temporaryRoot,
		runGit: async (...args) =>
		{
			gitCalls++;
			assert.ok(options.runGit, 'Tests must never execute real Git or use the network');
			return options.runGit(...args);
		},
	});
	let middleware;
	plugin.configureServer({ config: { root }, middlewares: { use: handler => { middleware = handler; } } });
	let reportedAddress;
	let encrypted = false;
	let received = 0;
	// Exercise the middleware's missing-Host check, not Node's earlier parser rejection.
	const server = createServer({ requireHostHeader: false }, (req, res) =>
	{
		received++;
		// Only this fixture can substitute a socket address; production ignores forwarded headers.
		if (reportedAddress !== undefined)
		{
			Object.defineProperty(req.socket, 'remoteAddress', { value: reportedAddress, configurable: true });
		}
		req.socket.encrypted = encrypted;
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Credentials', 'true');
		middleware(req, res, () => { res.statusCode = 418; res.end('next middleware'); });
	});
	await new Promise((accept, reject) =>
	{
		server.once('error', reject);
		server.listen(0, '127.0.0.1', accept);
	});
	const port = server.address().port;
	const origin = `http://localhost:${port}`;
	async function close()
	{
		if (!server.listening) return;
		await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
	}
	t.after(async () => { await close(); await rm(base, { recursive: true, force: true }); });

	function send({ path = API, method = 'GET', headers = {}, body, chunks } = {})
	{
		const allHeaders = { host: `localhost:${port}`, ...headers };
		if (body !== undefined && !chunks && allHeaders['content-length'] === undefined)
		{
			allHeaders['content-length'] = Buffer.byteLength(body);
		}
		return new Promise((accept, reject) =>
		{
			const req = request({
				hostname: '127.0.0.1', port, path, method, agent: false, setHost: false,
				headers: Object.fromEntries(Object.entries(allHeaders).filter(([, value]) => value !== undefined)),
			}, res =>
			{
				const data = [];
				res.on('data', chunk => data.push(chunk));
				res.on('end', () =>
				{
					const text = Buffer.concat(data).toString('utf8');
					accept({ status: res.statusCode, headers: res.headers, text, body: text.startsWith('{') ? JSON.parse(text) : null });
				});
			});
			req.on('error', reject);
			req.setTimeout(5000, () => req.destroy(new Error('Fixture HTTP request timed out')));
			if (chunks)
			{
				for (const chunk of chunks) req.write(chunk);
				req.end();
			}
			else req.end(body);
		});
	}

	return {
		base, root, temporaryRoot, port, origin, plugin, close, send,
		get gitCalls() { return gitCalls; },
		get received() { return received; },
		setRemoteAddress(address) { reportedAddress = address; },
		setEncrypted(value) { encrypted = value; },
		prepare(options = {})
		{
			return send({
				...options, path: options.path ?? `${API}/prepare`, method: options.method ?? 'POST',
				body: options.body ?? '{}',
				headers: { origin, 'content-type': 'application/json', ...options.headers },
			});
		},
	};
}

function privateJson(response)
{
	assert.equal(response.headers['cache-control'], 'no-store');
	assert.match(response.headers['content-type'], /^application\/json/);
	assert.equal(response.headers['x-content-type-options'], 'nosniff');
	assert.ok(!Object.keys(response.headers).some(header => header.startsWith('access-control-')));
}

function errorResponse(response, status, base)
{
	assert.equal(response.status, status, response.text);
	privateJson(response);
	assert.deepEqual(Object.keys(response.body), ['message']);
	assert.equal(typeof response.body.message, 'string');
	assert.ok(response.body.message.length > 0);
	assert.ok(!response.text.includes(base), 'Errors must not disclose filesystem paths');
}

function unavailable(response, canPrepare, base)
{
	assert.equal(response.status, 200, response.text);
	privateJson(response);
	assert.deepEqual({ ...response.body, message: undefined }, {
		supported: true, ready: false, canPrepare, checkout: null, links: {}, message: undefined,
	});
	assert.equal(typeof response.body.message, 'string');
	assert.ok(response.body.message.length > 0);
	assert.ok(!response.text.includes(base));
}

test('the exact sentinel set comes from the trusted catalog and is sufficient without Git metadata', async t =>
{
	for (const source of SENTINELS) assert.ok(sources.has(source), source);
	const f = await fixture(t);
	const checkout = await seedCheckout(join(f.base, 'vigil'));
	await assert.rejects(access(join(checkout, '.git')), { code: 'ENOENT' });
	const response = await f.prepare();
	assert.equal(response.status, 200);
	assert.equal(response.body.ready, true);
	assert.equal(response.body.checkout, 'local');
	assert.equal(response.body.canPrepare, false);
	assertSources(response);
	assert.equal(f.gitCalls, 0);
	// Fork metadata is irrelevant: only the validated source tree is inspected.
	await put(checkout, '.git/config', '[remote "origin"]\n\turl = https://example.invalid/fork\n');
	assert.deepEqual((await f.send()).body, response.body);
	assert.equal(f.gitCalls, 0);
});

test('manifest contains precisely trusted catalog files, never a directory scan or arbitrary file', async t =>
{
	const f = await fixture(t);
	const checkout = join(f.base, 'vigil');
	for (const source of sources) await put(checkout, source);
	await put(checkout, '.env', 'private');
	await put(checkout, 'unlisted.txt');
	const response = await f.send();
	assert.equal(response.status, 200);
	privateJson(response);
	assert.deepEqual(Object.keys(response.body).sort(), ['canPrepare', 'checkout', 'links', 'ready', 'supported']);
	assert.equal(response.body.supported, true);
	assert.equal(response.body.ready, true);
	assert.equal(response.body.canPrepare, false);
	assert.equal(response.body.checkout, 'local');
	assert.deepEqual(Object.keys(response.body.links).sort(), [...sources].sort());
	for (const [source, links] of Object.entries(response.body.links))
	{
		const pathname = pathToFileURL(join(checkout, source)).pathname;
		assert.deepEqual(links, {
			zed: `zed://file${pathname}`, vscode: `vscode://file${pathname}`, vscodium: `vscodium://file${pathname}`,
		});
	}
	assert.equal(f.gitCalls, 0);
});

test('relative server override wins over sibling and editor URLs encode real filesystem paths', async t =>
{
	const name = 'source # % ? café 🧭';
	const f = await fixture(t, { environment: { VIGIL_SOURCE_ROOT: `../${name}` } });
	const checkout = join(f.base, name);
	await seedCheckout(join(f.base, 'vigil'));
	await seedCheckout(checkout);
	const optional = await put(checkout, SOURCE_C);
	const file = await put(checkout, SOURCE_A, 'do not change');
	const before = await f.send();
	const after = await f.prepare();
	assert.equal(after.status, 200);
	assert.deepEqual(after.body, before.body);
	assertSources(after, [...SENTINELS, SOURCE_C]);
	const pathname = pathToFileURL(file).pathname;
	for (const editor of ['zed', 'vscode', 'vscodium'])
	{
		assert.equal(after.body.links[SOURCE_A][editor], `${editor}://file${pathname}`);
		assert.equal(new URL(after.body.links[SOURCE_A][editor]).hash, '');
		assert.equal(new URL(after.body.links[SOURCE_A][editor]).search, '');
	}
	for (const encoded of ['%20', '%23', '%25', '%3F', '%C3%A9', '%F0']) assert.ok(pathname.includes(encoded));
	assert.equal(await readFile(file, 'utf8'), 'do not change');
	assert.equal(f.gitCalls, 0);
	assert.deepEqual(await readdir(f.temporaryRoot), []);
	await rm(optional);
	const revalidated = await f.send();
	assert.equal(revalidated.body.ready, true);
	assertSources(revalidated);
	assert.equal(await readFile(file, 'utf8'), 'do not change');
});

test('absolute overrides and symlinked checkout roots resolve to the real directory', async t =>
{
	const storage = await mkdtemp(join(tmpdir(), 'vigil-source-root-test-'));
	t.after(() => rm(storage, { recursive: true, force: true }));
	const actual = join(storage, 'actual');
	const alias = join(storage, 'alias');
	await seedCheckout(actual);
	const file = join(actual, SOURCE_A);
	await symlink(actual, alias, 'dir');
	const f = await fixture(t, { environment: { VIGIL_SOURCE_ROOT: alias } });
	const response = await f.prepare();
	assert.equal(response.status, 200);
	assert.equal(response.body.checkout, 'local');
	assert.equal(response.body.links[SOURCE_A].zed, `zed://file${pathToFileURL(file).pathname}`);
	assert.equal(f.gitCalls, 0);
});

test('regular-file containment rejects escaping file symlinks and directories but allows internal symlinks', async t =>
{
	const f = await fixture(t);
	const checkout = join(f.base, 'vigil');
	await seedCheckout(checkout);
	const outside = await put(join(f.base, 'vigil-escape'), 'secret.txt');
	await mkdir(dirname(join(checkout, OPTIONAL_A)), { recursive: true });
	await symlink(outside, join(checkout, OPTIONAL_A));
	const inside = await put(checkout, 'unlisted target #.txt');
	await mkdir(dirname(join(checkout, OPTIONAL_B)), { recursive: true });
	await symlink(inside, join(checkout, OPTIONAL_B));
	await mkdir(join(checkout, OPTIONAL_C), { recursive: true });
	const response = await f.send();
	assert.equal(response.body.ready, true);
	assertSources(response, [...SENTINELS, OPTIONAL_B]);
	assert.equal(response.body.links[OPTIONAL_B].zed, `zed://file${pathToFileURL(inside).pathname}`);
	assert.ok(!response.text.includes('vigil-escape'));
	assert.ok(!response.text.includes('secret.txt'));
});

test('containment also rejects symlinked ancestor directories escaping the checkout', async t =>
{
	const f = await fixture(t);
	const checkout = join(f.base, 'vigil');
	const outside = join(f.base, 'vigil-escape');
	const top = SOURCE_B.split('/')[0];
	assert.ok(SOURCE_B.includes('/'));
	for (const source of SENTINELS)
	{
		if (source.startsWith(`${top}/`)) await put(outside, source.slice(top.length + 1));
		else await put(checkout, source);
	}
	await symlink(outside, join(checkout, top), 'dir');
	unavailable(await f.send(), true, f.base);
});

test('missing sibling is preparable but GET never clones', async t =>
{
	const f = await fixture(t);
	for (let i = 0; i < 3; i++)
	{
		const response = await f.send();
		assert.equal(response.status, 200);
		privateJson(response);
		assert.deepEqual({ ...response.body, message: undefined }, {
			supported: true, ready: false, canPrepare: true, checkout: null, links: {}, message: undefined,
		});
		assert.match(response.body.message, /temporary source checkout/);
		assert.ok(!response.text.includes(f.base));
	}
	assert.equal(f.gitCalls, 0);
	assert.deepEqual(await readdir(f.temporaryRoot), []);
});

test('unavailable, empty and non-directory overrides never silently fall back or clone', async t =>
{
	for (const override of ['../missing-private-location', '', '   ', '../not-a-directory'])
	{
		await t.test(JSON.stringify(override), async sub =>
		{
			const f = await fixture(sub, { environment: { VIGIL_SOURCE_ROOT: override } });
			await seedCheckout(join(f.base, 'vigil'));
			await writeFile(join(f.base, 'not-a-directory'), 'not a directory');
			for (const response of [await f.send(), await f.prepare()])
			{
				assert.equal(response.status, 200);
				assert.equal(response.body.ready, false);
				assert.equal(response.body.canPrepare, false);
				assert.equal(response.body.checkout, null);
				assert.deepEqual(response.body.links, {});
				assert.match(response.body.message, /VIGIL_SOURCE_ROOT is unavailable/);
				assert.ok(!response.text.includes('missing-private-location'));
				assert.ok(!response.text.includes(f.base));
			}
			assert.equal(f.gitCalls, 0);
		});
	}
});

test('unusable siblings offer explicit temporary preparation and are never modified', async t =>
{
	for (const scenario of INVALID_CANDIDATES)
	{
		await t.test(scenario.name, async sub =>
		{
			const f = await fixture(sub, { runGit: async (command, args) => seedCheckout(args.at(-1)) });
			const sibling = join(f.base, 'vigil');
			await scenario.setup(sibling, join(f.base, 'outside'));
			const before = await snapshot(sibling);
			unavailable(await f.send(), true, f.base);
			assert.equal(f.gitCalls, 0);
			assert.deepEqual(await readdir(f.temporaryRoot), []);
			const prepared = await f.prepare();
			assert.equal(prepared.status, 200, prepared.text);
			assert.equal(prepared.body.ready, true);
			assert.equal(prepared.body.checkout, 'temporary');
			assert.equal(prepared.body.canPrepare, false);
			assertSources(prepared);
			assert.deepEqual(await snapshot(sibling), before);
			assert.deepEqual((await f.send()).body, prepared.body);
			assert.equal(f.gitCalls, 1);
		});
	}
});

test('unusable configured roots expose no partial links, never fall back and never clone or mutate', async t =>
{
	for (const scenario of INVALID_CANDIDATES)
	{
		await t.test(scenario.name, async sub =>
		{
			const f = await fixture(sub, { environment: { VIGIL_SOURCE_ROOT: '../configured' } });
			const sibling = await seedCheckout(join(f.base, 'vigil'));
			const configured = join(f.base, 'configured');
			await scenario.setup(configured, join(f.base, 'outside'));
			const before = await snapshot(configured);
			const siblingBefore = await snapshot(sibling);
			for (const response of [await f.send(), await f.prepare()])
			{
				unavailable(response, false, f.base);
				assert.match(response.body.message, /VIGIL_SOURCE_ROOT/);
				for (const source of SENTINELS) assert.ok(response.body.message.includes(source));
				assert.match(response.body.message, /regular file inside the checkout/);
			}
			assert.equal(f.gitCalls, 0);
			assert.deepEqual(await readdir(f.temporaryRoot), []);
			assert.deepEqual(await snapshot(configured), before);
			assert.deepEqual(await snapshot(sibling), siblingBefore);
		});
	}
});

test('sentinels may be internal symlinks when all resolve to contained regular files', async t =>
{
	const f = await fixture(t);
	const checkout = await seedCheckout(join(f.base, 'vigil'));
	const targets = [];
	for (const [index, source] of SENTINELS.entries())
	{
		const target = await put(checkout, `internal targets/target #${index}.txt`);
		targets.push(target);
		await rm(join(checkout, source));
		await symlink(target, join(checkout, source));
	}
	const response = await f.send();
	assert.equal(response.body.ready, true);
	assert.equal(response.body.checkout, 'local');
	assertSources(response);
	for (const [index, source] of SENTINELS.entries())
	{
		assert.equal(response.body.links[source].zed, `zed://file${pathToFileURL(targets[index]).pathname}`);
	}
	assert.equal(f.gitCalls, 0);
});

test('socket allowlist accepts only IPv4/IPv6 loopback, including mapped 127/8', async t =>
{
	const f = await fixture(t);
	for (const address of ['127.0.0.1', '127.42.6.8', '127.255.255.255', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::ffff:127.233.1.2', '::ffff:7fff:ffff'])
	{
		f.setRemoteAddress(address);
		assert.equal((await f.send()).status, 200, address);
	}
	for (const address of ['192.168.1.7', '10.0.0.2', '::', '::2', '::ffff:192.168.1.2', '::ffff:7e00:1', '127.0.0.1.bad', '', null])
	{
		f.setRemoteAddress(address);
		errorResponse(await f.send({ headers: { forwarded: 'for=127.0.0.1;host=localhost', 'x-forwarded-for': '127.0.0.1' } }), 403, f.base);
	}
	assert.equal(f.gitCalls, 0);
});

test('Host must be localhost or a loopback literal, never an arbitrary domain or forwarded host', async t =>
{
	const f = await fixture(t);
	for (const host of ['localhost', `LOCALHOST:${f.port}`, '127.0.0.1', '127.244.1.2:1234', `[::1]:${f.port}`, `[::ffff:127.0.0.1]:${f.port}`])
	{
		assert.equal((await f.send({ headers: { host } })).status, 200, host);
	}
	for (const host of ['example.com', 'localhost.evil.test', 'localhost.', '0.0.0.0', '192.168.0.1', '[::]', '[::2]', '[::ffff:192.168.1.2]', '127.0.0.1.example', '127.1', '2130706433', '0x7f000001', 'localhost@evil.test', 'user@localhost', 'localhost/path', 'localhost:0', 'localhost:65536', 'localhost,localhost', '127.0.0.999', '[127.0.0.1]', undefined])
	{
		errorResponse(await f.send({ headers: { host, 'x-forwarded-host': `localhost:${f.port}` } }), 403, f.base);
	}
});

test('Origin and Fetch-Site enforce same-origin access; POST always requires Origin', async t =>
{
	const f = await fixture(t);
	await seedCheckout(join(f.base, 'vigil'));
	for (const site of [undefined, 'same-origin', 'none'])
	{
		assert.equal((await f.send({ headers: { origin: f.origin, 'sec-fetch-site': site } })).status, 200);
		assert.equal((await f.prepare({ headers: { 'sec-fetch-site': site } })).status, 200);
	}
	for (const origin of ['https://evil.test', 'null', `${f.origin}/`, `${f.origin}.evil.test`, `http://127.0.0.1:${f.port}`, 'http://localhost:1', f.origin.replace('http:', 'https:')])
	{
		errorResponse(await f.send({ headers: { origin } }), 403, f.base);
		errorResponse(await f.prepare({ headers: { origin } }), 403, f.base);
	}
	for (const site of ['same-site', 'cross-site', 'untrusted', ''])
	{
		errorResponse(await f.send({ headers: { 'sec-fetch-site': site } }), 403, f.base);
		errorResponse(await f.prepare({ headers: { 'sec-fetch-site': site } }), 403, f.base);
	}
	errorResponse(await f.prepare({ headers: { origin: undefined, 'sec-fetch-site': 'same-origin' } }), 403, f.base);
	errorResponse(await f.prepare({ headers: { origin: f.origin.replace('http:', 'https:'), 'x-forwarded-proto': 'https' } }), 403, f.base);
	f.setEncrypted(true);
	assert.equal((await f.prepare({ headers: { origin: f.origin.replace('http:', 'https:') } })).status, 200);
	errorResponse(await f.prepare(), 403, f.base);
	assert.equal(f.gitCalls, 0);
});

test('routes allow only manifest GET and explicit prepare POST, with no query-selected inputs', async t =>
{
	const f = await fixture(t);
	for (const [path, method, allow] of [[API, 'POST', 'GET'], [`${API}/prepare`, 'GET', 'POST'], [`${API}/prepare`, 'PUT', 'POST'], [API, 'OPTIONS', 'GET'], [API, 'DELETE', 'GET']])
	{
		const response = await f.send({ path, method, headers: { origin: f.origin } });
		errorResponse(response, 405, f.base);
		assert.equal(response.headers.allow, allow);
	}
	for (const query of ['?path=../../.env', '?root=/tmp', '?url=https://evil.test/repo', '?editor=zed', '?command=touch', '?'])
	{
		errorResponse(await f.send({ path: API + query }), 400, f.base);
		errorResponse(await f.prepare({ path: `${API}/prepare${query}` }), 400, f.base);
	}
	errorResponse(await f.prepare({ path: `${API}/open` }), 404, f.base);
	errorResponse(await f.send({ body: '{"path":".env"}' }), 400, f.base);
	assert.equal((await f.send({ path: '/unrelated' })).status, 418);
	assert.equal(f.gitCalls, 0);
	assert.deepEqual(await readdir(f.temporaryRoot), []);
});

test('prepare accepts only a small empty application/json object, rejecting every client-selected field', async t =>
{
	const f = await fixture(t);
	for (const type of [undefined, 'text/plain', 'application/jsonp', 'application/x-www-form-urlencoded'])
	{
		errorResponse(await f.prepare({ headers: { 'content-type': type } }), 415, f.base);
	}
	errorResponse(await f.prepare({ headers: { 'content-encoding': 'gzip' } }), 415, f.base);
	for (const body of ['', '{', 'null', '[]', '[{}]', 'true', '0', '"{}"', '{"path":"../../.env"}', '{"root":"/tmp"}', '{"url":"https://evil.test/repo"}', '{"repository":"https://evil.test/repo"}', '{"ref":"other"}', '{"command":"touch /tmp/x"}', '{"editor":"zed"}', '{"__proto__":{}}'])
	{
		errorResponse(await f.prepare({ body }), 400, f.base);
	}
	errorResponse(await f.prepare({ body: '{}' + ' '.repeat(255) }), 413, f.base);
	errorResponse(await f.prepare({ chunks: ['{', ' '.repeat(300), '}'], headers: { 'transfer-encoding': 'chunked' } }), 413, f.base);
	errorResponse(await f.prepare({ body: '{}' + 'é'.repeat(128) }), 413, f.base);
	assert.equal(f.gitCalls, 0);
	assert.deepEqual(await readdir(f.temporaryRoot), []);
	await seedCheckout(join(f.base, 'vigil'));
	for (const body of ['{}', ' \n {}\t', '{}' + ' '.repeat(254)])
	{
		assert.equal((await f.prepare({ body, headers: { 'content-type': 'application/json; charset=utf-8' } })).status, 200);
	}
	assert.equal(f.gitCalls, 0);
});

test('concurrent explicit prepares share one hardened shallow clone, then reuse the retained checkout', async t =>
{
	const entered = deferred();
	const release = deferred();
	t.after(() => release.resolve());
	let scratch;
	let checkout;
	const f = await fixture(t, {
		environment: {
			PATH: '/trusted/bin', HOME: '/untrusted/home', GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'url.evil.insteadOf', GIT_CONFIG_VALUE_0: 'https://github.com/',
			GIT_SSH_COMMAND: 'untrusted command', GIT_ASKPASS: 'untrusted command',
			GIT_TEMPLATE_DIR: '/untrusted/templates', GIT_EXEC_PATH: '/untrusted/bin',
		},
		runGit: async (command, args, options) =>
		{
			entered.resolve();
			assert.equal(command, 'git');
			scratch = options.cwd;
			checkout = args.at(-1);
			const empty = join(scratch, 'empty');
			assert.deepEqual(args, [
				'-c', `core.hooksPath=${empty}`, '-c', 'core.fsmonitor=false',
				'-c', 'credential.helper=', '-c', 'credential.interactive=false',
				'-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
				'clone', '--quiet', '--depth=1', '--single-branch', '--no-tags',
				'--branch', SOURCE_REF, `--template=${empty}`, '--', SOURCE_REPOSITORY_URL, checkout,
			]);
			assert.equal(relative(f.temporaryRoot, dirname(scratch)), '');
			assert.equal(checkout, join(scratch, 'checkout'));
			assert.equal((await stat(scratch)).mode & 0o777, 0o700);
			assert.equal((await stat(empty)).mode & 0o777, 0o700);
			assert.deepEqual(await readdir(empty), []);
			assert.equal(options.shell, false);
			assert.equal(options.timeout, 120000);
			assert.equal(options.killSignal, 'SIGKILL');
			assert.equal(options.maxBuffer, 64 * 1024);
			assert.deepEqual(options.env, {
				PATH: '/trusted/bin', HOME: scratch, XDG_CONFIG_HOME: scratch,
				GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: devNull, GIT_CONFIG_GLOBAL: devNull,
				GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'https', GIT_ATTR_NOSYSTEM: '1',
				GIT_LFS_SKIP_SMUDGE: '1', LC_ALL: 'C',
			});
			await release.promise;
			await seedCheckout(checkout);
		},
	});
	assert.equal((await f.send()).body.canPrepare, true);
	const responses = Array.from({ length: 6 }, () => f.prepare());
	await entered.promise;
	await waitFor(() => f.received >= 7);
	await immediate();
	const during = await f.send();
	assert.equal(during.body.ready, false);
	assert.equal(f.gitCalls, 1);
	release.resolve();
	const completed = await Promise.all(responses);
	for (const response of completed)
	{
		assert.equal(response.status, 200, response.text);
		privateJson(response);
		assert.equal(response.body.ready, true);
		assert.equal(response.body.canPrepare, false);
		assert.equal(response.body.checkout, 'temporary');
		assertSources(response);
		assert.equal(response.body.links[SOURCE_A].vscode, `vscode://file${pathToFileURL(join(checkout, SOURCE_A)).pathname}`);
	}
	assert.deepEqual((await f.send()).body, completed[0].body);
	assert.deepEqual((await f.prepare()).body, completed[0].body);
	assert.equal(f.gitCalls, 1);
	// A user checkout appearing later takes priority, without touching either checkout.
	await seedCheckout(join(f.base, 'vigil'));
	await put(join(f.base, 'vigil'), SOURCE_B, 'user-owned');
	await put(join(f.base, 'vigil'), SOURCE_C);
	const local = await f.prepare();
	assert.equal(local.body.checkout, 'local');
	assertSources(local, [...SENTINELS, SOURCE_C]);
	assert.equal(f.gitCalls, 1);
	await f.close();
	await access(join(checkout, SOURCE_A));
	await access(scratch);
	assert.equal(await readFile(join(f.base, 'vigil', SOURCE_B), 'utf8'), 'user-owned');
});

test('failed/timeout clones share a sanitized error, clean only owned scratch and allow retry', async t =>
{
	const entered = deferred();
	const release = deferred();
	t.after(() => release.resolve());
	let attempts = 0;
	const f = await fixture(t, {
		runGit: async (command, args, options) =>
		{
			attempts++;
			entered.resolve();
			await seedCheckout(args.at(-1));
			if (attempts === 1)
			{
				await release.promise;
				throw Object.assign(new Error(`Git timed out at ${options.cwd} with private stderr`), { killed: true });
			}
		},
	});
	const sentinel = await put(f.temporaryRoot, 'unowned/keep.txt', 'keep');
	const responses = Array.from({ length: 4 }, () => f.prepare());
	await entered.promise;
	await waitFor(() => f.received >= 4);
	await immediate();
	release.resolve();
	for (const response of await Promise.all(responses))
	{
		errorResponse(response, 502, f.base);
		assert.ok(!response.text.includes('private stderr'));
	}
	assert.equal(f.gitCalls, 1);
	assert.deepEqual(await readdir(f.temporaryRoot), ['unowned']);
	assert.equal(await readFile(sentinel, 'utf8'), 'keep');
	const missing = await f.send();
	assert.equal(missing.body.ready, false);
	assert.equal(missing.body.canPrepare, true);
	const retried = await f.prepare();
	assert.equal(retried.status, 200);
	assert.equal(retried.body.checkout, 'temporary');
	assert.equal(f.gitCalls, 2);
});

test('successful runner without a contained checkout is treated as failure and cleaned', async t =>
{
	for (const escape of [false, true])
	{
		await t.test(escape ? 'escaping checkout symlink' : 'missing checkout', async sub =>
		{
			const f = await fixture(sub, {
				runGit: async (command, args) =>
				{
					if (escape)
					{
						const outside = join(f.base, 'outside');
						await seedCheckout(outside);
						await put(outside, SOURCE_A, 'untouched');
						await symlink(outside, args.at(-1), 'dir');
					}
				},
			});
			errorResponse(await f.prepare(), 502, f.base);
			assert.deepEqual(await readdir(f.temporaryRoot), []);
			if (escape) assert.equal(await readFile(join(f.base, 'outside', SOURCE_A), 'utf8'), 'untouched');
		});
	}
});

test('unusable post-clone candidates fail validation, clean owned scratch and can be retried', async t =>
{
	for (const scenario of INVALID_CANDIDATES)
	{
		await t.test(scenario.name, async sub =>
		{
			let attempts = 0;
			let outsideBefore;
			const f = await fixture(sub, {
				runGit: async (command, args) =>
				{
					if (attempts++ === 0)
					{
						await scenario.setup(args.at(-1), join(f.base, 'outside'));
						outsideBefore = await snapshot(join(f.base, 'outside'));
					}
					else await seedCheckout(args.at(-1));
				},
			});
			const unowned = await put(f.temporaryRoot, 'unowned/keep.txt', 'keep');
			errorResponse(await f.prepare(), 502, f.base);
			assert.equal(f.gitCalls, 1);
			assert.deepEqual(await readdir(f.temporaryRoot), ['unowned']);
			assert.equal(await readFile(unowned, 'utf8'), 'keep');
			assert.deepEqual(await snapshot(join(f.base, 'outside')), outsideBefore);
			unavailable(await f.send(), true, f.base);
			assert.equal(f.gitCalls, 1);
			const retried = await f.prepare();
			assert.equal(retried.status, 200, retried.text);
			assert.equal(retried.body.ready, true);
			assert.equal(retried.body.checkout, 'temporary');
			assert.equal(retried.body.canPrepare, false);
			assertSources(retried);
			assert.equal(f.gitCalls, 2);
		});
	}
});

test('managed candidates are revalidated, lost required sources permit explicit retry, optional files stay optional', async t =>
{
	for (const scenario of INVALID_CANDIDATES)
	{
		await t.test(scenario.name, async sub =>
		{
			const managed = [];
			const f = await fixture(sub, {
				runGit: async (command, args) =>
				{
					managed.push(args.at(-1));
					await seedCheckout(args.at(-1));
					await put(args.at(-1), OPTIONAL_A);
				},
			});
			const prepared = await f.prepare();
			assert.equal(prepared.status, 200, prepared.text);
			assert.equal(prepared.body.ready, true);
			assert.equal(prepared.body.checkout, 'temporary');
			assertSources(prepared, [...SENTINELS, OPTIONAL_A]);
			await rm(join(managed[0], OPTIONAL_A));
			const partial = await f.send();
			assert.equal(partial.body.ready, true);
			assert.equal(partial.body.checkout, 'temporary');
			assert.equal(partial.body.canPrepare, false);
			assertSources(partial);
			assert.equal(f.gitCalls, 1);
			await rm(managed[0], { recursive: true, force: true });
			await scenario.setup(managed[0], join(f.base, 'outside'));
			const before = await snapshot(managed[0]);
			const outsideBefore = await snapshot(join(f.base, 'outside'));
			unavailable(await f.send(), true, f.base);
			assert.equal(f.gitCalls, 1, 'GET must not replace a lost managed checkout');
			const replacement = await f.prepare();
			assert.equal(replacement.status, 200, replacement.text);
			assert.equal(replacement.body.ready, true);
			assert.equal(replacement.body.checkout, 'temporary');
			assert.equal(replacement.body.canPrepare, false);
			assertSources(replacement, [...SENTINELS, OPTIONAL_A]);
			assert.equal(f.gitCalls, 2);
			assert.notEqual(managed[1], managed[0]);
			assert.deepEqual(await snapshot(managed[0]), before, 'Prior scratch is retained, not reset or deleted');
			assert.deepEqual(await snapshot(join(f.base, 'outside')), outsideBefore);
			assert.deepEqual((await f.prepare()).body, replacement.body);
			assert.equal(f.gitCalls, 2);
		});
	}
});

test('a managed root replaced by an escaping symlink is not reused or deleted', async t =>
{
	const managed = [];
	const f = await fixture(t, {
		runGit: async (command, args) =>
		{
			managed.push(args.at(-1));
			await seedCheckout(args.at(-1));
		},
	});
	assert.equal((await f.prepare()).body.ready, true);
	const outside = await seedCheckout(join(f.base, 'outside'));
	await rm(managed[0], { recursive: true, force: true });
	await symlink(outside, managed[0], 'dir');
	const before = await snapshot(outside);
	unavailable(await f.send(), true, f.base);
	assert.equal(f.gitCalls, 1);
	const prepared = await f.prepare();
	assert.equal(prepared.status, 200, prepared.text);
	assert.equal(prepared.body.ready, true);
	assert.equal(prepared.body.checkout, 'temporary');
	assert.equal(f.gitCalls, 2);
	assert.ok((await lstat(managed[0])).isSymbolicLink());
	assert.deepEqual(await snapshot(outside), before);
});

test('Vite config preserves its existing temporary cache and installs a dev-only plugin', async () =>
{
	const { default: config } = await import('../vite.config.js');
	assert.equal(config.cacheDir, join(tmpdir(), `vigil-technical-spec-vite-${userInfo().uid}`));
	const plugin = config.plugins.flat().find(item => item.name === 'vigil-source-links');
	assert.ok(plugin);
	assert.equal(plugin.apply, 'serve');
	assert.equal(typeof plugin.configureServer, 'function');
	assert.equal(plugin.configurePreviewServer, undefined);
	assert.equal(plugin.buildStart, undefined);
	assert.equal(resolve(config.cacheDir), config.cacheDir);
});

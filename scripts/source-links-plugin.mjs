import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { devNull, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { SYSTEM_ATLAS } from '../src/data/systemAtlas.js';
import { SOURCE_REF, SOURCE_REPOSITORY_URL } from '../src/data/sourceRepository.js';

const ENDPOINT = '/__vigil/source-links';
const BODY_LIMIT = 256;
const executeGit = promisify(execFile);

class RequestError extends Error
{
	constructor(status, message)
	{
		super(message);
		this.status = status;
	}
}

function catalogPaths(node, paths = new Set())
{
	for (const entry of node.source.split(';'))
	{
		const source = entry.trim();
		if (source && !isAbsolute(source) && !/[\\\0:]/.test(source)
			&& source.split('/').every(part => part && part !== '.' && part !== '..'))
		{
			paths.add(source);
		}
	}
	for (const child of node.children) catalogPaths(child, paths);
	return paths;
}

// The browser can never extend this allowlist, including through query/body fields.
const SOURCES = catalogPaths(SYSTEM_ATLAS);
const SENTINELS = [
	'docker-compose.yml',
	'services/web/src/App.tsx',
	'services/telemetry-collector/buildtime/exporter/delivery.go',
];

function contained(root, file)
{
	const local = relative(root, file);
	return local !== '' && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

async function realDirectory(directory)
{
	try
	{
		const root = await realpath(directory);
		return (await stat(root)).isDirectory() ? root : null;
	}
	catch
	{
		return null;
	}
}

async function editorLinks(root)
{
	const links = Object.create(null);
	if (!root) return links;
	await Promise.all([...SOURCES].map(async source =>
	{
		try
		{
			const file = await realpath(resolve(root, source));
			if (!contained(root, file) || !(await stat(file)).isFile()) return;
			const pathname = pathToFileURL(file).pathname;
			links[source] = {
				zed: `zed://file${pathname}`,
				vscode: `vscode://file${pathname}`,
				vscodium: `vscodium://file${pathname}`,
			};
		}
		catch
		{
			// Missing, unreadable and escaping catalog entries have no local link.
		}
	}));
	return links;
}

async function inspectCandidate(directory, parent = null)
{
	if (!directory) return null;
	const root = await realDirectory(directory);
	if (!root || (parent && !contained(parent, root))) return null;
	const links = await editorLinks(root);
	// Readiness requires characteristic catalog files, not Git metadata or just a directory.
	return SENTINELS.every(source => Object.hasOwn(links, source)) ? { root, links } : null;
}

function loopback(address)
{
	if (typeof address !== 'string') return false;
	if (isIP(address) === 4) return address.startsWith('127.');
	if (isIP(address) !== 6) return false;
	try
	{
		const host = new URL(`http://[${address}]/`).hostname;
		return host === '[::1]' || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host);
	}
	catch
	{
		return false;
	}
}

function requestOrigin(req)
{
	const host = req.headers.host;
	if (typeof host !== 'string') return null;
	const match = /^(localhost|127(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/i.exec(host);
	if (!match || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return null;
	const hostname = match[1].replace(/^\[|\]$/g, '');
	if (match[1].startsWith('[') && isIP(hostname) !== 6) return null;
	if (hostname.toLowerCase() !== 'localhost' && !loopback(hostname)) return null;
	return new URL(`${req.socket.encrypted ? 'https' : 'http'}://${host}`).origin;
}

function authorize(req)
{
	const origin = requestOrigin(req);
	const fetchSite = req.headers['sec-fetch-site'];
	if (!loopback(req.socket.remoteAddress) || !origin
		|| (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none')
		|| (req.headers.origin !== undefined && req.headers.origin !== origin)
		|| (req.method === 'POST' && req.headers.origin !== origin))
	{
		throw new RequestError(403, 'Source editor links require a same-origin loopback client.');
	}
}

async function emptyJson(req)
{
	const type = req.headers['content-type'];
	if (typeof type !== 'string' || type.split(';')[0].trim().toLowerCase() !== 'application/json'
		|| (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity'))
	{
		throw new RequestError(415, 'Use application/json with an empty JSON object.');
	}
	if (req.headers['content-length'] && Number(req.headers['content-length']) > BODY_LIMIT)
	{
		throw new RequestError(413, 'The prepare request body is too large.');
	}
	const body = await new Promise((accept, reject) =>
	{
		const chunks = [];
		let size = 0;
		const finish = (error) =>
		{
			clearTimeout(timer);
			req.off('data', onData);
			req.off('end', onEnd);
			req.off('error', onError);
			req.off('aborted', onError);
			if (error)
			{
				req.resume();
				reject(error);
			}
			else accept(Buffer.concat(chunks).toString('utf8'));
		};
		const onData = (chunk) =>
		{
			size += chunk.length;
			if (size > BODY_LIMIT) finish(new RequestError(413, 'The prepare request body is too large.'));
			else chunks.push(chunk);
		};
		const onEnd = () => finish();
		const onError = () => finish(new RequestError(400, 'Could not read the prepare request.'));
		const timer = setTimeout(() => finish(new RequestError(408, 'The prepare request timed out.')), 5000);
		timer.unref();
		req.on('data', onData);
		req.once('end', onEnd);
		req.once('error', onError);
		req.once('aborted', onError);
	});
	let value;
	try
	{
		value = JSON.parse(body);
	}
	catch
	{
		throw new RequestError(400, 'The prepare body must be an empty JSON object.');
	}
	if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length)
	{
		throw new RequestError(400, 'The prepare body must be an empty JSON object.');
	}
}

function sendJson(res, status, body)
{
	if (res.destroyed || res.writableEnded) return;
	res.statusCode = status;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.setHeader('Cache-Control', 'no-store');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	for (const header of res.getHeaderNames())
	{
		if (header.toLowerCase().startsWith('access-control-')) res.removeHeader(header);
	}
	if (status === 413 || status === 408) res.setHeader('Connection', 'close');
	res.end(JSON.stringify(body));
}

function bridge(root, { runGit, environment, temporaryRoot })
{
	const overridden = environment.VIGIL_SOURCE_ROOT !== undefined;
	const override = environment.VIGIL_SOURCE_ROOT;
	const preferred = overridden
		? (typeof override === 'string' && override.trim() ? resolve(root, override) : null)
		: resolve(root, '..', 'vigil');
	let temporaryCheckout = null;
	let pending = null;

	async function inspect()
	{
		const local = await inspectCandidate(preferred);
		if (local) return { ...local, checkout: 'local', canPrepare: false };
		if (overridden)
		{
			return {
				root: null, links: {}, checkout: null, canPrepare: false,
				message: `VIGIL_SOURCE_ROOT is unavailable or lacks required VIGIL source files (${SENTINELS.join(', ')}). Each must resolve to a regular file inside the checkout; fix the server setting to enable local editor links.`,
			};
		}
		const temporary = await inspectCandidate(temporaryCheckout?.root, temporaryCheckout?.parent);
		if (temporary) return { ...temporary, checkout: 'temporary', canPrepare: false };
		return {
			root: null, links: {}, checkout: null, canPrepare: true,
			message: 'No usable local VIGIL checkout was found. Prepare a temporary source checkout to enable editor links.',
		};
	}

	function manifest(state)
	{
		return {
			supported: true,
			ready: Boolean(state.root),
			canPrepare: state.canPrepare,
			checkout: state.checkout,
			links: state.links,
			...(state.message ? { message: state.message } : {}),
		};
	}

	async function clone()
	{
		let scratch;
		try
		{
			scratch = await mkdtemp(join(temporaryRoot, 'vigil-source-links-'));
			const empty = join(scratch, 'empty');
			const checkout = join(scratch, 'checkout');
			await mkdir(empty, { mode: 0o700 });
			// No inherited Git config, templates, hooks, filters, credentials or URL rewrites.
			await runGit('git', [
				'-c', `core.hooksPath=${empty}`,
				'-c', 'core.fsmonitor=false',
				'-c', 'credential.helper=',
				'-c', 'credential.interactive=false',
				'-c', 'protocol.allow=never',
				'-c', 'protocol.https.allow=always',
				'clone', '--quiet', '--depth=1', '--single-branch', '--no-tags',
				'--branch', SOURCE_REF, `--template=${empty}`, '--', SOURCE_REPOSITORY_URL, checkout,
			], {
				cwd: scratch,
				env: {
					...(environment.PATH ? { PATH: environment.PATH } : {}),
					...(environment.SystemRoot ? { SystemRoot: environment.SystemRoot } : {}),
					HOME: scratch,
					XDG_CONFIG_HOME: scratch,
					GIT_CONFIG_NOSYSTEM: '1',
					GIT_CONFIG_SYSTEM: devNull,
					GIT_CONFIG_GLOBAL: devNull,
					GIT_TERMINAL_PROMPT: '0',
					GIT_ALLOW_PROTOCOL: 'https',
					GIT_ATTR_NOSYSTEM: '1',
					GIT_LFS_SKIP_SMUDGE: '1',
					LC_ALL: 'C',
				},
				shell: false,
				timeout: 120000,
				killSignal: 'SIGKILL',
				maxBuffer: 64 * 1024,
				windowsHide: true,
			});
			const parent = await realpath(scratch);
			const candidate = await inspectCandidate(checkout, parent);
			if (!candidate) throw new Error('Invalid checkout');
			temporaryCheckout = { root: candidate.root, parent };
			return { ...candidate, checkout: 'temporary', canPrepare: false };
		}
		catch
		{
			if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {});
			throw new RequestError(502, 'Could not prepare a usable temporary source checkout. Check Git, network access and the source branch, then retry.');
		}
	}

	function prepare()
	{
		if (!pending)
		{
			pending = (async () =>
			{
				const state = await inspect();
				return manifest(state.canPrepare ? await clone() : state);
			})().finally(() => { pending = null; });
		}
		return pending;
	}

	return async (req, res, next) =>
	{
		const pathname = req.url?.split('?')[0];
		if (pathname !== ENDPOINT && !pathname?.startsWith(`${ENDPOINT}/`)) return next();
		try
		{
			authorize(req);
			if (req.url.includes('?')) throw new RequestError(400, 'Source link routes do not accept query parameters.');
			if (pathname !== ENDPOINT && pathname !== `${ENDPOINT}/prepare`)
			{
				throw new RequestError(404, 'Unknown source link route.');
			}
			const method = pathname === ENDPOINT ? 'GET' : 'POST';
			if (req.method !== method)
			{
				res.setHeader('Allow', method);
				throw new RequestError(405, `Use ${method} for this source link route.`);
			}
			if (method === 'POST') await emptyJson(req);
			else if (req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0)
			{
				throw new RequestError(400, 'The source link manifest does not accept a request body.');
			}
			sendJson(res, 200, method === 'POST' ? await prepare() : manifest(await inspect()));
		}
		catch (error)
		{
			req.resume();
			sendJson(res, error instanceof RequestError ? error.status : 500, {
				message: error instanceof RequestError ? error.message : 'Source editor links are temporarily unavailable.',
			});
		}
	};
}

// Dependencies are injectable by trusted server-side tests, never by HTTP clients.
export function sourceLinksPlugin({ runGit = executeGit, environment = process.env, temporaryRoot = tmpdir() } = {})
{
	return {
		name: 'vigil-source-links',
		apply: 'serve',
		configureServer(server)
		{
			server.middlewares.use(bridge(resolve(server.config.root), { runGit, environment, temporaryRoot }));
		},
	};
}

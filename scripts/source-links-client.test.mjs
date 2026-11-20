import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { SOURCE_EDITORS, SOURCE_REF, SOURCE_REPOSITORY_URL } from '../src/data/sourceRepository.js';
import { preferredSourceEditor, rememberSourceEditor, repositorySourceUrl, requestSourceLinks, sourcePaths, sourceTarget } from '../src/utils/sourceLinks.js';

const file = 'services/web/src/App.tsx';
const urls = {
	zed: 'zed://file/tmp/vigil%20sources/services/web/src/App.tsx',
	vscode: 'vscode://file/tmp/vigil%20sources/services/web/src/App.tsx',
	vscodium: 'vscodium://file/tmp/vigil%20sources/services/web/src/App.tsx',
};
const manifest = { supported: true, ready: true, canPrepare: false, checkout: 'local', links: { [file]: urls } };

function response(body, status = 200, type = 'application/json')
{
	return new Response(type.includes('application/json') ? JSON.stringify(body) : body, { status, headers: { 'Content-Type': type } });
}

test('source lists preserve repository-relative paths and deduplicate entries', () =>
{
	assert.deepEqual(sourcePaths('  services/web/src/App.tsx; docker-compose.yml ; ; services/web/src/App.tsx '), [file, 'docker-compose.yml']);
	assert.deepEqual(sourcePaths(null), []);
});

test('GitHub fallback encodes path segments without embedding any checkout root', () =>
{
	assert.equal(repositorySourceUrl(file), `${SOURCE_REPOSITORY_URL}/blob/${SOURCE_REF}/${file}`);
	const url = new URL(repositorySourceUrl('folder with spaces/file#1?%.txt'));
	assert.ok(url.pathname.endsWith('/folder%20with%20spaces/file%231%3F%25.txt'));
	assert.equal(url.search, '');
	assert.equal(url.hash, '');
});

test('unsafe, absolute and traversal paths cannot become source links', () =>
{
	for (const path of ['', '/etc/passwd', '../secret', 'a/../secret', './file', 'a//b', 'C:/secret', 'a\\b', 'a\0b', null])
	{
		assert.throws(() => repositorySourceUrl(path), /repository-relative/);
	}
});

test('only declared editors are restored; missing or inaccessible storage defaults to Zed', () =>
{
	for (const { id } of SOURCE_EDITORS) assert.equal(preferredSourceEditor({ getItem: () => id }), id);
	for (const value of [null, 'unknown', 'javascript:', '__proto__']) assert.equal(preferredSourceEditor({ getItem: () => value }), 'zed');
	assert.equal(preferredSourceEditor(null), 'zed');
	assert.equal(preferredSourceEditor({ getItem() { throw new Error('denied'); } }), 'zed');
});

test('saving an editor is optional and never writes unsupported values', () =>
{
	const writes = [];
	const storage = { setItem: (...args) => writes.push(args) };
	rememberSourceEditor(storage, 'vscode');
	rememberSourceEditor(storage, 'unknown');
	assert.deepEqual(writes, [['vigil-source-editor', 'vscode']]);
	assert.doesNotThrow(() => rememberSourceEditor({ setItem() { throw new Error('denied'); } }, 'zed'));
	assert.doesNotThrow(() => rememberSourceEditor(null, 'zed'));
});

test('each editor uses its own validated native protocol and keeps a GitHub alternative', () =>
{
	for (const [editor, href] of Object.entries(urls))
	{
		const target = sourceTarget(file, editor, manifest);
		assert.equal(target.href, href);
		assert.equal(target.local, true);
		assert.equal(target.web, repositorySourceUrl(file));
		assert.equal(target.editor, SOURCE_EDITORS.find(({ id }) => id === editor).label);
	}
});

test('static hosting, missing files and explicit GitHub selection remain real HTTPS links', () =>
{
	for (const [editor, bridge] of [['zed', null], ['zed', { ...manifest, ready: false }], ['github', manifest], ['unknown', manifest], ['zed', { ...manifest, links: {} }]])
	{
		const target = sourceTarget(file, editor, bridge);
		assert.equal(target.href, repositorySourceUrl(file));
		assert.equal(target.local, false);
		assert.equal(target.editor, 'GitHub');
	}
});

test('unexpected bridge URLs cannot launch arbitrary protocols or destinations', () =>
{
	for (const href of ['javascript:alert(1)', 'file:///etc/passwd', 'https://example.com', 'data:text/plain,test', 'vscode://file/tmp/x', 'zed://remote/tmp/x', 'zed://user@file/tmp/x', 'zed://file:22/tmp/x', 'zed://file/tmp/x?command=test', 'zed://file/tmp/x#fragment', 'zed://file/', 'not a url'])
	{
		const target = sourceTarget(file, 'zed', { ...manifest, links: { [file]: { zed: href } } });
		assert.equal(target.local, false, href);
		assert.equal(target.href, repositorySourceUrl(file));
	}
});

test('manifest requests are same-origin, no-store and contain no filesystem or repository input', async () =>
{
	const controller = new AbortController();
	let request;
	const result = await requestSourceLinks({ signal: controller.signal, fetcher: async (...args) => { request = args; return response(manifest); } });
	assert.deepEqual(result, manifest);
	assert.equal(request[0], '/__vigil/source-links');
	assert.equal(request[1].method, 'GET');
	assert.equal(request[1].credentials, 'same-origin');
	assert.equal(request[1].cache, 'no-store');
	assert.equal(request[1].signal, controller.signal);
	assert.ok(!Object.hasOwn(request[1], 'body'));
});

test('preparing is an explicit JSON POST with only an empty object', async () =>
{
	let request;
	await requestSourceLinks({ prepare: true, fetcher: async (...args) => { request = args; return response(manifest); } });
	assert.equal(request[0], '/__vigil/source-links/prepare');
	assert.equal(request[1].method, 'POST');
	assert.equal(request[1].headers['Content-Type'], 'application/json');
	assert.equal(request[1].body, '{}');
});

test('HTML from a deployed SPA is not mistaken for a local bridge', async () =>
{
	await assert.rejects(requestSourceLinks({ fetcher: async () => response('<!doctype html>', 200, 'text/html') }), /local development server/);
});

test('server preparation errors are actionable without changing the fallback target', async () =>
{
	await assert.rejects(requestSourceLinks({ prepare: true, fetcher: async () => response({ message: 'GitHub is unreachable; retry.' }, 502) }), /GitHub is unreachable/);
	assert.equal(sourceTarget(file, 'zed', null).local, false);
});

test('malformed manifests are rejected', async () =>
{
	for (const invalid of [{}, { ...manifest, supported: false }, { ...manifest, ready: 'true' }, { ...manifest, canPrepare: null }, { ...manifest, links: null }, { ...manifest, links: [] }])
	{
		await assert.rejects(requestSourceLinks({ fetcher: async () => response(invalid) }), /invalid response/);
	}
});

test('aborted or failed requests remain failures for the component to handle', async () =>
{
	const failure = new DOMException('Aborted', 'AbortError');
	await assert.rejects(requestSourceLinks({ fetcher: async () => { throw failure; } }), error => error === failure);
});

// Exercise the component's actual hook/request lifecycle without needing a DOM renderer.
test('unmount aborts an active preparation request and clears its timeout', async () =>
{
	const source = readFileSync(new URL('../src/components/SourceLinks.jsx', import.meta.url), 'utf8');
	const start = source.indexOf('function browserStorage()');
	const end = source.indexOf('\n\treturn (', source.indexOf('export default function SourceLinks'));
	assert.ok(start >= 0 && end > start);
	const implementation = source.slice(start, end).replace('export default function SourceLinks', 'function SourceLinks') + '\nreturn { prepare };\n}';
	const timers = new Map();
	const requests = [];
	const updates = [];
	let cleanup;
	let timerId = 0;
	const component = runInNewContext(`${implementation}\nSourceLinks({source: 'docker-compose.yml'})`, {
		AbortController,
		window: { localStorage: null },
		preferredSourceEditor: () => 'zed',
		sourcePaths: () => ['docker-compose.yml'],
		useState: initial => [typeof initial === 'function' ? initial() : initial, value => updates.push(value)],
		useRef: initial => ({ current: initial }),
		useId: () => 'source-editor',
		useEffect: setup => { cleanup = setup(); },
		setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, {callback,ms}); return id; },
		clearTimeout: id => timers.delete(id),
		requestSourceLinks: options => new Promise(resolve => requests.push({ ...options, resolve })),
	});
	requests[0].resolve(manifest);
	await new Promise(resolve => setImmediate(resolve));
	const preparation = component.prepare();
	assert.equal(requests.length, 2);
	assert.equal(requests[1].prepare, true);
	assert.equal(requests[1].signal.aborted, false);
	assert.ok([...timers.values()].some(({ms}) => ms === 150000));
	cleanup();
	assert.equal(requests[1].signal.aborted, true);
	assert.equal(timers.size, 0);
	const count = updates.length;
	requests[1].resolve(manifest);
	await preparation;
	assert.equal(updates.length, count, 'unmounted requests must not update state');
});

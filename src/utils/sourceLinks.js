import { SOURCE_EDITORS, SOURCE_REF, SOURCE_REPOSITORY_URL } from '../data/sourceRepository.js';

export const SOURCE_LINKS_ENDPOINT = '/__vigil/source-links';
const EDITOR_STORAGE_KEY = 'vigil-source-editor';
const EDITOR_SCHEMES =
{
	zed: 'zed:',
	vscode: 'vscode:',
	vscodium: 'vscodium:'
};

export function sourcePaths(source)
{
	return [
	   ...new Set((typeof source === 'string' ? source : '').split(';').map(path => path.trim()).filter(Boolean))
	];
}

export function repositorySourceUrl(source)
{
	if (typeof source !== 'string' || !source || /[\\\0:]/.test(source)
		|| source.split('/').some(part => !part || part === '.' || part === '..'))
	{
		throw new Error('Expected a repository-relative source path.');
	}
	const path = source.split('/').map(encodeURIComponent).join('/');
	return `${SOURCE_REPOSITORY_URL}/blob/${encodeURIComponent(SOURCE_REF)}/${path}`;
}

export function preferredSourceEditor(storage)
{
	try
	{
		const editor = storage?.getItem(EDITOR_STORAGE_KEY);
		if (SOURCE_EDITORS.some(({ id }) => id === editor)) return editor;
	}
	catch
	{
		// Editor preferences are optional when browser storage is unavailable.
	}
	return 'zed';
}

export function rememberSourceEditor(storage, editor)
{
	if (!SOURCE_EDITORS.some(({ id }) => id === editor)) return;
	try
	{
		storage?.setItem(EDITOR_STORAGE_KEY, editor);
	}
	catch
	{
		// Opening source files must not depend on writable browser storage.
	}
}

export function sourceTarget(source, editor, manifest)
{
	const web = repositorySourceUrl(source);
	const href = manifest?.ready && manifest.links?.[source]?.[editor];
	if (href && Object.hasOwn(EDITOR_SCHEMES, editor))
	{
		try
		{
			const url = new URL(href);
			if (url.protocol === EDITOR_SCHEMES[editor] && url.hostname === 'file'
				&& !url.username && !url.password && !url.port && !url.search && !url.hash
				&& url.pathname.startsWith('/') && url.pathname.length > 1)
			{
				return {
				   href,
				   web,
				   local: true,
				   editor: SOURCE_EDITORS.find(({ id }) => id === editor).label
				};
			}
		}
		catch
		{
			// Invalid bridge responses must never become arbitrary external protocols.
		}
	}
	return { href: web, web, local: false, editor: 'GitHub' };
}

export async function requestSourceLinks({
	prepare = false,
	signal,
	fetcher = fetch
} = {})
{
	const endpoint = prepare ? `${SOURCE_LINKS_ENDPOINT}/prepare` : SOURCE_LINKS_ENDPOINT;
	const response = await fetcher(endpoint, {
		method: prepare ? 'POST' : 'GET',
		credentials: 'same-origin',
		cache: 'no-store',
		headers: prepare ? {
		   Accept: 'application/json',
		   'Content-Type': 'application/json'
		} : {
		   Accept: 'application/json'
		},
		...(prepare ? { body: '{}' } : {}),
		signal,
	});
	if (!response.headers.get('content-type')?.includes('application/json'))
	{
		throw new Error('Local source links require this app’s local development server.');
	}
	const manifest = await response.json();
	if (!response.ok) throw new Error(typeof manifest.message === 'string' ? manifest.message : 'Local source links are unavailable.');
	if (manifest.supported !== true || typeof manifest.ready !== 'boolean' || typeof manifest.canPrepare !== 'boolean'
		|| !manifest.links || typeof manifest.links !== 'object' || Array.isArray(manifest.links))
	{
		throw new Error('The local source-link service returned an invalid response.');
	}
	return manifest;
}

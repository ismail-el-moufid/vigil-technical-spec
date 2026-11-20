import { useEffect, useId, useRef, useState } from 'react';
import { SOURCE_EDITORS } from '../data/sourceRepository.js';
import { preferredSourceEditor, rememberSourceEditor, requestSourceLinks, sourcePaths, sourceTarget } from '../utils/sourceLinks.js';

function browserStorage()
{
	try
	{
		return window.localStorage;
	}
	catch
	{
		return null;
	}
}

export default function SourceLinks({ source })
{
	const [
	   editor,
	   setEditor
	] = useState(() => preferredSourceEditor(browserStorage()));
	const [manifest, setManifest] = useState(null);
	const [status, setStatus] = useState('loading');
	const [error, setError] = useState('');
	const requestRef = useRef(null);
	const editorId = useId();
	const paths = sourcePaths(source);

	useEffect(() =>
	{
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 8000);
		requestRef.current = { controller, timeout };
		requestSourceLinks({ signal: controller.signal }).then(result =>
		{
			if (!controller.signal.aborted)
			{
				setManifest(result);
				setStatus('ready');
			}
		}).catch(() =>
		{
			if (requestRef.current?.controller === controller) setStatus('unavailable');
		}).finally(() => clearTimeout(timeout));
		return () =>
		{
			const active = requestRef.current;
			requestRef.current = null;
			active?.controller.abort();
			clearTimeout(active?.timeout);
			clearTimeout(timeout);
		};
	}, []);

	async function prepare()
	{
		requestRef.current?.controller.abort();
		clearTimeout(requestRef.current?.timeout);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 150000);
		requestRef.current = { controller, timeout };
		setStatus('preparing');
		setError('');
		try
		{
			const result = await requestSourceLinks({
			   prepare: true,
			   signal: controller.signal
			});
			if (requestRef.current?.controller === controller)
			{
				setManifest(result);
				setStatus('ready');
			}
		}
		catch (failure)
		{
			if (requestRef.current?.controller === controller)
			{
				setError(controller.signal.aborted ? 'Source checkout preparation timed out. Retry or use GitHub.' : failure.message);
				setStatus('ready');
			}
		}
		finally
		{
			clearTimeout(timeout);
		}
	}

	return (
		<details className="atlas-source">
			<summary>Source evidence in vigil · {paths.length} {paths.length === 1 ? 'file' : 'files'}</summary>
			{manifest?.supported && (
				<div className="source-controls">
					<label htmlFor={editorId}>Open in
						<select id={editorId} value={editor} onChange={(event) =>
						{
							setEditor(event.target.value);
							rememberSourceEditor(browserStorage(), event.target.value);
						}}>
							{SOURCE_EDITORS.map(({
							   id,
							   label
							}) => <option value={id} key={id}>{label}</option>)}
						</select>
					</label>
					{manifest.canPrepare && <button type="button" disabled={status === 'preparing'} onClick={prepare}>{status === 'preparing' ? 'Preparing source checkout…' : 'Prepare source checkout in /tmp'}</button>}
				</div>
			)}
			<p className="source-help" role="status">
				{status === 'loading' ? 'Checking for a local checkout… GitHub links are available below.'
					: !manifest ? 'Local editor links are available with npm run dev on this machine. These links open GitHub.'
						: manifest.ready ? `${manifest.checkout === 'temporary' ? 'Temporary' : 'Local'} checkout · your browser may ask permission to open the selected editor. Each file also has a GitHub fallback.`
							: manifest.message}
			</p>
			{manifest?.canPrepare && <p className="source-help">Preparation downloads a shallow public checkout into a private temporary directory. It does not install dependencies or run project code. Until it is ready, file links open GitHub.</p>}
			{error && <p className="source-error" role="alert">{error}</p>}
			<ul className="source-file-list">
				{paths.map(path =>
				{
					const target = sourceTarget(path, editor, manifest);
					const title = `Open ${path} in ${target.editor}`;
					return (
						<li key={path}>
							<a href={target.href} title={title} target={target.local ? undefined : '_blank'} rel="noopener noreferrer"><code>{path}</code></a>
							{target.local && <a className="source-web-link" href={target.web} target="_blank" rel="noopener noreferrer">GitHub ↗</a>}
						</li>
					);
				})}
			</ul>
		</details>
	);
}

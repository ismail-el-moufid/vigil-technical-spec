import { useEffect, useId, useRef, useState } from 'react';
import { ARCHITECTURE_SECTIONS, ARCHITECTURE_DELIVERY_DIAGRAM as DELIVERY_DIAGRAM } from '../data/architecture';



// Serialize this view's renders because Mermaid configuration is process-global.
let renderQueue = Promise.resolve();

function DeliveryDiagram()
{
	const hostRef = useRef(null);
	const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(true);

	useEffect(() =>
	{
		let cancelled = false;
		const host = hostRef.current;
		const render = async () =>
		{
			let staging;
			try
			{
				const { default: mermaid } = await import('mermaid');
				if (cancelled) return;
				const styles = getComputedStyle(host);
				const theme = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: 'strict',
					theme: 'base',
					flowchart: { htmlLabels: false, useMaxWidth: true },
					themeVariables: {
						primaryColor: theme('--surface2', 'transparent'),
						primaryTextColor: theme('--text', 'white'),
						primaryBorderColor: theme('--border', 'white'),
						lineColor: 'white',
						background: 'transparent',
						fontFamily: theme('--font-sans', 'sans-serif'),
					},
				});
				staging = document.createElement('div');
				staging.className = 'architecture-diagram-staging';
				staging.setAttribute('aria-hidden', 'true');
				document.body.appendChild(staging);
				const {
				   svg
				} = await mermaid.render(`architecture-${id}`, DELIVERY_DIAGRAM, staging);
				if (!cancelled)
				{
					host.innerHTML = svg;
					setLoading(false);
				}
			}
			catch (cause)
			{
				if (!cancelled)
				{
					setError(cause instanceof Error ? cause.message : String(cause));
					setLoading(false);
				}
			}
			finally
			{
				staging?.remove();
			}
		};
		renderQueue = renderQueue.then(render, render);
		return () =>
		{
			cancelled = true;
			host.replaceChildren();
		};
	}, [id]);

	return (
		<figure className="architecture-diagram">
			<figcaption>Storage-success callback sequence</figcaption>
			{loading && <p role="status">Loading delivery diagram…</p>}
			{error && <p className="architecture-error" role="alert">Diagram could not render: {error}</p>}
			<div ref={hostRef} className="architecture-diagram-canvas" role="img" aria-label="The writer stores telemetry in ClickHouse and confirms queryability before calling trigger-evaluation. The backend evaluates rules synchronously, persists resulting alerts, and returns 204 without storing the notification." />
			<details>
				<summary>Read the diagram as text</summary>
				<pre>{DELIVERY_DIAGRAM}</pre>
			</details>
		</figure>
	);
}

export default function ArchitectureView({ highlightSectionId })
{
	const sectionRefs = useRef({});
	const instanceId = useId();

	useEffect(() =>
	{
		const section = sectionRefs.current[highlightSectionId];
		if (section)
		{
			section.scrollIntoView({ block: 'start', behavior: 'auto' });
		}
	}, [highlightSectionId]);

	return (
		<div className="architecture-view">
			<header className="architecture-header">
				<p className="architecture-eyebrow">Technical specification / Architecture</p>
				<h1>Storage, evaluation, and delivery</h1>
				<p>Component responsibilities, delivery contracts, storage settings, and operational requirements.</p>
			</header>
			<nav className="architecture-nav" aria-label="Architecture sections">
				{ARCHITECTURE_SECTIONS.map((section) => (
					<a key={section.id} href={"#" + instanceId + "-" + section.id} aria-current={highlightSectionId === section.id ? 'location' : undefined}>{section.title}</a>
				))}
			</nav>
			<div className="architecture-sections">
				{ARCHITECTURE_SECTIONS.map((section, index) => (
					<section
						key={section.id}
						id={instanceId + "-" + section.id}
						ref={(node) => 
						{
							sectionRefs.current[section.id] = node; 
						}}
						className={"architecture-section" + (highlightSectionId === section.id ? " architecture-section-highlighted" : "")}
						aria-labelledby={instanceId + "-" + section.id + "-title"}
						tabIndex={-1}
					>
						<div className="architecture-section-heading">
							<span className="architecture-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
							<h2 id={instanceId + "-" + section.id + "-title"}>{section.title}</h2>
						</div>
						<p className="architecture-summary">{section.summary}</p>
						<div className="architecture-cards">
							{section.items.map((item) => (
								<article className="architecture-card" key={item.title}>
									{item.status && <span className="architecture-status">{item.status}</span>}
									<h3>{item.title}</h3>
									<p>{item.text}</p>
								</article>
							))}
						</div>
						{section.id === 'delivery' && <DeliveryDiagram />}
					</section>
				))}
			</div>
		</div>
	);
}

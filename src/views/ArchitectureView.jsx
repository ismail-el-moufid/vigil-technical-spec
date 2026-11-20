import { useLayoutEffect, useRef } from 'react';
import FlowDiagram from '../components/FlowDiagram';
import SystemAtlas from '../components/SystemAtlas';
import ArchitectureConnections from '../components/ArchitectureConnections';
import { ARCHITECTURE_SECTIONS } from '../data/architecture';
import { SECTION_LINKS } from '../data/architectureLinks';
import { CONNECTIONS, INCIDENT, TOPICS } from '../data/architectureStory';

const SECTIONS = new Map(ARCHITECTURE_SECTIONS.map(section => [
	section.id,
	section
]));
// Example event times in one 60-second window, relative to its left boundary.
const ERRORS = [7, 20, 32, 44, 60];

function IncidentEvidence({ chapter })
{
	const counting = chapter === 1;
	return (
		<figure className="incident-evidence" aria-label="Example incident evidence">
			<figcaption><span>checkout-api</span><span>{[
			   'GET /work',
			   'error_count',
			   'alert history',
			   'alert history'
			][chapter]}</span></figcaption>
			{chapter < 2 ? <>
				<div className="incident-reading"><samp>{counting ? '5 / 5' : '500'}</samp><span>{counting ? 'errors to trigger' : 'HTTP response'}</span></div>
				<svg viewBox="0 0 320 42" preserveAspectRatio="none" className={'incident-window' + (counting ? ' is-counted' : '')} role="img" aria-label="Five logged errors in the example’s sixty-second window">
					<path className="incident-axis" d="M2 33H318" />
					{ERRORS.map(second =>
					{
						const tickPath = 'M' + (2 + second / 60 * 316) + ' 10v23';
						return <path key={second} className={'incident-tick' + (second === 60 ? ' is-latest' : '')} d={tickPath} />;
					})}
				</svg>
				<div className="incident-scale"><span>−60 s</span><span>latest event</span></div>
			</> : <>
				<div className="incident-reading"><samp>{chapter === 2 ? 'sent' : 'Analysis unavailable'}</samp></div>
				<div className="incident-field"><span>{chapter === 2 ? 'status' : 'llm_analysis'}</span><span>PostgreSQL</span></div>
			</>}
		</figure>
	);
}

function Connections({ sectionId, onSelect })
{
	return (
		<section className="incident-connections" aria-label="Implementation connections">
			<div className="reference-notes-head"><h2>What connects here</h2>
				<button type="button" onClick={() => onSelect('connections/' + sectionId)}>View all connections <span aria-hidden="true">↗</span></button>
			</div>
			<ul>{CONNECTIONS.filter(([
			   a,
			   b
			]) => a === sectionId || b === sectionId).map(([
			   a,
			   b,
			   label,
			   text
			]) =>
			{
				const other = a === sectionId ? b : a;
				return <li key={other}>
					<span className="connection-type">{label}</span>
					<span>{text}</span>
					<button type="button" onClick={() => onSelect(other)}>{TOPICS[other][0]} <span aria-hidden="true">↗</span></button>
				</li>;
			})}</ul>
		</section>
	);
}

function SpecLinks({ sectionId, onNavigate })
{
	const { groups, screens } = SECTION_LINKS.get(sectionId);
	if (!groups.length && !screens.length) return null;
	return (
		<section className="reference-surfaces">
			<h2>Connected routes and screens</h2>
			<dl>{groups.map(group => <div key={group.label}>
				<dt>{group.label}</dt>
				<dd>{group.endpoints.map(endpoint => <button key={endpoint.id} type="button" onClick={() => onNavigate('endpoints', endpoint.id)}>
					{endpoint.method} {endpoint.route}
				</button>)}</dd>
			</div>)}
			{screens.length > 0 && <div>
				<dt>{sectionId === 'offline-navigation' ? 'Navigation fallback' : 'Screens using these routes, including shared dashboard controls'}</dt>
				<dd>{screens.map(screen => <button key={screen.id} type="button" onClick={() => onNavigate('pages', null, screen.id)}>{screen.name}</button>)}</dd>
			</div>}</dl>
		</section>
	);
}

export default function ArchitectureView({
	referenceId,
	onReferenceChange,
	onNavigate,
	chapter,
	onChapterChange
})
{
	const beat = INCIDENT[chapter];
	const atlas = referenceId === 'atlas' || referenceId?.startsWith('atlas/');
	const map = referenceId === 'connections' || referenceId?.startsWith('connections/');
	const section = SECTIONS.get(referenceId);
	const inReference = Boolean(atlas || map || section);
	const page = inReference ? 'reference/' + referenceId : 'story/' + beat.section;
	const previousPage = useRef(inReference ? null : page);
	const root = useRef(null);
	const heading = useRef(null);
	const picker = useRef(null);

	useLayoutEffect(() =>
	{
		if (previousPage.current === page) return;
		previousPage.current = page;
		if (document.activeElement !== picker.current) heading.current?.focus({
		   preventScroll: true
		});
		root.current?.scrollIntoView({ block: 'start' });
	}, [page]);

	return (
		<div ref={root} className="spec-architecture">
			{inReference ? <>
				<header className="incident-mast">
					<button type="button" onClick={() => onReferenceChange(null)}>← Back to the incident</button>
					<select aria-label="Choose an architecture reference" ref={picker} value={atlas ? 'atlas' : map ? 'connections' : referenceId} onChange={event => onReferenceChange(event.target.value)}>
						<option value="atlas">System atlas</option>
						<option value="connections">Implementation connections</option>
						{Object.keys(TOPICS).map(id => <option key={id} value={id}>{SECTIONS.get(id).title}</option>)}
					</select>
				</header>
				<h1 className="reference-heading" tabIndex={-1} ref={heading}>{atlas ? 'System atlas' : map ? 'Implementation connections' : section.title}</h1>
				{map ? <ArchitectureConnections key={referenceId} initialTopic={referenceId.split('/')[1]} onSelect={onReferenceChange} /> : atlas ? <SystemAtlas key={referenceId} initialNodeId={referenceId.split('/')[1]} /> : <>
					<p className="reference-summary">{section.summary}</p>
					<FlowDiagram key={section.id} source={section.diagram} title={section.title} compact />
					<Connections sectionId={section.id} onSelect={onReferenceChange} />
					<section className="reference-notes">
						<div className="reference-notes-head"><h2>Implementation notes</h2>
							<button type="button" onClick={() => onReferenceChange('atlas/' + TOPICS[section.id][1])}>Locate in atlas <span aria-hidden="true">↗</span></button>
						</div>
						<dl>{section.items.map(item => <div key={item.title}><dt>{item.title}{item.status && <small> · {item.status}</small>}</dt><dd>{item.text}</dd></div>)}</dl>
					</section>
					<SpecLinks sectionId={section.id} onNavigate={onNavigate} />
				</>}
			</> : <>
				<header className="incident-mast">
					<span>Architecture <span aria-hidden="true">/</span> Example incident</span>
					<button type="button" onClick={() => onReferenceChange(beat.section)}>Diagram &amp; notes <span aria-hidden="true">↗</span></button>
				</header>
				<div className="incident-progress" aria-hidden="true"><span style={{
				   width: (chapter + 1) / INCIDENT.length * 100 + '%'
				}} /></div>
				<div className="incident-spread">
					<div className="incident-chapter" key={beat.section}>
						<p className="incident-position">Step {chapter + 1} of {INCIDENT.length} <span aria-hidden="true">/</span> {beat.place}</p>
						<h1 ref={heading} tabIndex={-1}>{beat.title}</h1>
						<p className="incident-copy">{beat.text}</p>
					</div>
					<IncidentEvidence chapter={chapter} />
				</div>
				<nav className="incident-turn" aria-label="Incident chapters">
					<button className="incident-next" type="button" onClick={() => chapter === INCIDENT.length - 1 ? onReferenceChange('atlas') : onChapterChange(chapter + 1)}>{beat.next} <span aria-hidden="true">→</span></button>
					{chapter > 0 && <button type="button" className="incident-back" onClick={() => onChapterChange(chapter - 1)}>← Previous step</button>}
				</nav>
				<Connections sectionId={beat.section} onSelect={onReferenceChange} />
			</>}
		</div>
	);
}

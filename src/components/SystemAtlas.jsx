import { useEffect, useId, useRef, useState } from 'react';
import { SYSTEM_ATLAS } from '../data/systemAtlas';
import { flushSync } from 'react-dom';
import SourceLinks from './SourceLinks';
import { getAtlasScope, indexAtlas } from '../utils/systemAtlas';

const NODES = indexAtlas(SYSTEM_ATLAS);

export default function SystemAtlas({ initialNodeId = SYSTEM_ATLAS.id } = {})
{
	const [
	   selectedId,
	   setSelectedId
	] = useState(() => NODES.has(initialNodeId) ? initialNodeId : SYSTEM_ATLAS.id);
	const headingRef = useRef(null);
	const focusAfter = useRef(false);
	const id = useId();
	const transitionPrefix = 'atlas-' + id.replace(/[^a-zA-Z0-9_-]/g, '');
	const selected = NODES.get(selectedId);
	const scope = getAtlasScope(NODES, selectedId);
	const trail =
	[
	   ...selected.ancestors,
	   selected.id
	].map((key) => NODES.get(key));
	const detailId = `${id}-detail`;
	const headingId = `${id}-heading`;
	const instructionsId = `${id}-instructions`;

	useEffect(() =>
	{
		if (focusAfter.current)
		{
			headingRef.current?.focus({ preventScroll: true });
			focusAfter.current = false;
		}
	}, [scope.id]);

	function select(node)
	{
		if (!node || node.id === selectedId) return;
		focusAfter.current = getAtlasScope(NODES, node.id).id !== scope.id;
		if (focusAfter.current && document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
		{
			document.startViewTransition(() => flushSync(() => setSelectedId(node.id)));
		}
		else setSelectedId(node.id);
	}

	return (
		<figure className="auth-flow system-atlas" onKeyDown={(event) =>
		{
			if (!event.defaultPrevented && event.key === 'Escape' && selected.ancestors.length)
			{
				event.preventDefault();
				event.stopPropagation();
				if (!event.repeat) select(event.shiftKey ? SYSTEM_ATLAS : NODES.get(selected.ancestors.at(-1)));
			}
		}}>
			<nav className="atlas-navigation" aria-label="System atlas breadcrumb">
				<button type="button" disabled={!selected.ancestors.length} onClick={() => select(NODES.get(selected.ancestors.at(-1)))}>← Back</button>
				{trail.slice(0, -1).map((node) => (
					<button type="button" key={node.id} aria-current={node.id === selectedId ? 'location' : undefined} onClick={() => select(node)}>{node.title}</button>
				))}
			</nav>
			<p className="screen-reader-only" id={instructionsId}>Choose a component within this group to explore it or read its evidence. Esc goes back; Shift+Esc returns to the root.</p>
			<div className="atlas-map" role="group" aria-labelledby={headingId} aria-describedby={instructionsId}>
				<div className="atlas-parent" style={{
				   viewTransitionName: transitionPrefix + scope.id
				}}>
					<svg className="atlas-choice-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
						<polygon points="50,1 99,50 50,99 1,50" vectorEffect="non-scaling-stroke" />
					</svg>
					<span className="atlas-node-meta">Explore</span>
					<h2 ref={headingRef} tabIndex={-1} id={headingId}>{scope.title}</h2>
				</div>
				{scope.children.length > 0 && <div className="atlas-relation" aria-hidden="true" />}
				<div className="atlas-branches" style={{
				   '--atlas-columns': Math.max(1, scope.children.length)
				}}>
					{scope.children.map((node) => (
						<div className="atlas-branch" key={node.id}>
							<button type="button" className="atlas-node" style={{
							   viewTransitionName: transitionPrefix + node.id
							}} aria-pressed={selectedId === node.id} aria-controls={detailId} onClick={() => select(NODES.get(node.id))}>
								<span className="atlas-node-label">{node.title}</span>
								{node.children.length > 0 && <span className="atlas-child-count" aria-label={node.children.length + ' components'}>{node.children.length} <span aria-hidden="true">→</span></span>}
							</button>
						</div>
					))}
				</div>
			</div>
			<figcaption className="auth-flow-caption atlas-detail" id={detailId} aria-live="polite" aria-atomic="true">
				{selected.id !== scope.id && <strong>{selected.title}</strong>}
				<p>{selected.description}</p>
				<SourceLinks source={selected.source} />
			</figcaption>
		</figure>
	);
}

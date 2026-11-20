import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { MOBILE_LAYOUT_QUERY, fitDiagram, getDiagramScale, prepareDiagram, renderFlowDiagram, startArrowSequence } from "../utils/flowDiagram";

export default function FlowDiagram({
	source,
	title = "Architecture diagram",
	compact = false,
	visible = true,
	description
})
{
	const id = useId();
	const viewportRef = useRef(null);
	const diagramRef = useRef(null);
	const edgesRef = useRef([]);
	const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
	const [viewportWidth, setViewportWidth] = useState(1);
	const [
	   mobileLayout,
	   setMobileLayout
	] = useState(() => window.matchMedia(MOBILE_LAYOUT_QUERY).matches);
	const [status, setStatus] = useState("loading");
	const [error, setError] = useState("");
	const [view, setView] = useState("fit");
	const [animate, setAnimate] = useState(true);
	const scale = getDiagramScale(dimensions.width, viewportWidth, view);
	const instructionsId = `${id}-instructions`;
	const viewportId = `${id}-viewport`;
	const scaleLabel = `${title} scale`;

	useEffect(() =>
	{
		const media = window.matchMedia(MOBILE_LAYOUT_QUERY);
		function updateLayout(event)
		{
			setMobileLayout(event.matches);
		}
		media.addEventListener("change", updateLayout);
		return () => media.removeEventListener("change", updateLayout);
	}, []);

	useEffect(() =>
	{
		let cancelled = false;
		const host = diagramRef.current;
		async function renderDiagram()
		{
			try
			{
				setStatus("loading");
				setError("");
				if (typeof source !== "string" || !source.trim()) throw new Error("No Mermaid flowchart source provided.");
				const graph = source.match(/```mermaid\s*\n([\s\S]*?)```/)?.[1] || source;
				const responsiveSource = mobileLayout ? graph.replace(/\b(flowchart|graph)\s+LR\b/, "$1 TB") : graph;
				const {
				   markup,
				   renderId,
				   graphData
				} = await renderFlowDiagram(responsiveSource);
				if (cancelled) return;
				const diagram = prepareDiagram(markup, renderId, graphData.edges, title);
				host.replaceChildren(diagram.svg);
				edgesRef.current = graphData.edges;
				setDimensions(fitDiagram(diagram.svg));
				setStatus("ready");
			}
			catch (cause)
			{
				if (cancelled) return;
				host.replaceChildren();
				setError(cause instanceof Error ? cause.message : String(cause));
				setStatus("error");
			}
		}
		renderDiagram();
		return () =>
		{
			cancelled = true;
			host.replaceChildren();
		};
	}, [source, title, mobileLayout]);

	useEffect(() =>
	{
		const svg = diagramRef.current.querySelector("svg");
		if (animate && visible && status === "ready" && svg) return startArrowSequence(svg, edgesRef.current);
	}, [animate, visible, status, dimensions]);

	useEffect(() =>
	{
		const observer = new ResizeObserver(([entry]) =>
		{
			if (entry.contentRect.width > 0) setViewportWidth(entry.contentRect.width);
		});
		observer.observe(viewportRef.current);
		return () => observer.disconnect();
	}, []);

	useLayoutEffect(() =>
	{
		const svg = diagramRef.current.querySelector("svg");
		if (svg)
		{
			svg.setAttribute("width", dimensions.width * scale);
			svg.setAttribute("height", dimensions.height * scale);
		}
	}, [dimensions, scale]);

	return (
		<figure className="auth-flow">
			<div className="auth-flow-toolbar">
				{!compact && <div className="auth-flow-kicker">{title}</div>}
				<div className="flow-controls">
					<div className="flow-scale-controls" role="group" aria-label={scaleLabel}>
						{[
						   ["fit", "Fit width"],
						   ["readable", "Readable"],
						   ["actual", "100%"]
						].map(([
						   value,
						   label
						]) => (
							<button type="button" key={value} aria-pressed={view === value} aria-controls={viewportId} onClick={() => setView(value)}>{label}</button>
						))}
					</div>
					<button type="button" aria-pressed={animate} aria-controls={viewportId} onClick={() => setAnimate(!animate)}>Animate routes</button>
				</div>
			</div>
			<div className="auth-flow-viewport" data-view={view} id={viewportId} ref={viewportRef} tabIndex={view === "fit" ? undefined : 0} role="region" aria-label={title} aria-describedby={instructionsId} aria-busy={status === "loading"}>
				{status === "loading" && <p role="status">Loading diagram…</p>}
				{status === "error" && <p role="alert">Unable to render diagram: {error}</p>}
				<div className="auth-flow-render" ref={diagramRef} />
			</div>
			<figcaption className="auth-flow-caption">
				{description && <p>{description}</p>}
				<p className="screen-reader-only" id={instructionsId}>Fit width shows the whole diagram. Select Readable or 100% for a closer view.</p>
				<details open={status === "error"}>
					<summary>Diagram source</summary>
					<pre><code>{source}</code></pre>
				</details>
			</figcaption>
		</figure>
	);
}

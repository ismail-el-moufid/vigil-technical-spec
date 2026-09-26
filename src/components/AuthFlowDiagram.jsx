import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import authFlowMarkdown from "../../auth-setup-flow.md?raw";
import "./AuthFlowDiagram.css";

const MOBILE_LAYOUT_QUERY = "(max-width: 760px)";
const SVG_NS = "http://www.w3.org/2000/svg";
let renderSequence = 0;

function svgElement(name, attributes)
{
	const element = document.createElementNS(SVG_NS, name);
	for (const [
	   key,
	   value
	] of Object.entries(attributes)) element.setAttribute(key, value);
	return element;
}

function orderFlowEdges(edges)
{
	const outgoing = new Map();
	const targets = new Set(edges.map((edge) => edge.end));
	for (const edge of edges)
	{
		if (!outgoing.has(edge.start)) outgoing.set(edge.start, []);
		outgoing.get(edge.start).push(edge);
	}
	const responses = new Map([
		["R_SUCCESS", "C_200"],
		["R_UNAUTHORIZED", "C_401"],
		["R_ERROR", "C_ERROR"],
		["ST_SETUP", "U_SETUP"],
		["ST_LOGIN", "U_LOGIN"],
		["ST_ERROR", "U_ERROR"],
	]);
	const ordered = [];
	function visit(node, route, visited, refreshBranch, setupBranch)
	{
		if (node.startsWith("R_") && responses.has(node)) refreshBranch = responses.get(node);
		if (node.startsWith("ST_") && responses.has(node)) setupBranch = responses.get(node);
		const branch = node === "C" ? refreshBranch : node === "U" ? setupBranch : null;
		const next = (outgoing.get(node) || []).filter((edge) =>
			!visited.has(edge.end) && (!branch || edge.end === branch));
		if (!next.length)
		{
			ordered.push(...route);
			return;
		}
		for (const edge of next)
		{
			visit(edge.end, [
			   ...route,
			   edge.id
			], new Set([
			   ...visited,
			   edge.end
			]), refreshBranch, setupBranch);
		}
	}
	// Replay shared connectors for each complete route, so every response reaches
	// its matching frontend check before the next request scenario starts.
	for (const node of outgoing.keys())
	{
		if (!targets.has(node)) visit(node, [], new Set([node]), null, null);
	}
	return ordered;
}

function startArrowSequence(svg, graphEdges)
{
	const renderedPaths = new Map([
	   ...svg.querySelectorAll(".auth-flow-animated-edge")
	]
		.map((path) => [path.getAttribute("data-id"), path]));
	const paths = orderFlowEdges(graphEdges).map((edgeId) => renderedPaths.get(edgeId));
	const steps = paths.map((path) =>
	{
		const length = path.getTotalLength();
		const circle = svg.querySelector(`#${path.dataset.spotlightCircle}`);
		circle.setAttribute("r", Math.min(160, Math.max(30, length * 0.35)));
		return { path, circle, length, duration: Math.max(450, length / 360 * 1000) };
	}).filter((step) => Number.isFinite(step.length) && step.length > 0);
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	let frame = null;
	let index = 0;
	let elapsed = 0;
	let previousTime = null;
	let finished = false;

	function tick(time)
	{
		if (finished)
		{
			steps[index].circle.setAttribute("opacity", "0");
			index = (index + 1) % steps.length;
			elapsed = 0;
			previousTime = time;
			finished = false;
		}
		// Do not skip connectors when the tab resumes after being backgrounded.
		if (previousTime !== null) elapsed += Math.min(64, time - previousTime);
		previousTime = time;
		const step = steps[index];
		const progress = Math.min(1, elapsed / step.duration);
		const point = step.path.getPointAtLength(step.length * progress);
		step.circle.setAttribute("cx", point.x);
		step.circle.setAttribute("cy", point.y);
		step.circle.setAttribute("opacity", Math.min(1, elapsed / 200));
		finished = progress === 1;
		frame = requestAnimationFrame(tick);
	}

	function syncMotion()
	{
		cancelAnimationFrame(frame);
		previousTime = null;
		for (const step of steps) step.circle.setAttribute("opacity", "0");
		if (!reducedMotion.matches && steps.length) frame = requestAnimationFrame(tick);
	}
	reducedMotion.addEventListener("change", syncMotion);
	syncMotion();
	return () =>
	{
		cancelAnimationFrame(frame);
		reducedMotion.removeEventListener("change", syncMotion);
	};
}

function prepareDiagram(markup, id, graphEdges)
{
	const documentNode = new DOMParser().parseFromString(markup, "image/svg+xml");
	const svg = documentNode.documentElement;
	const [
	   x,
	   y,
	   width,
	   height
	] = svg.getAttribute("viewBox").split(/[\s,]+/).map(Number);
	if (![
	   x,
	   y,
	   width,
	   height
	].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error("Mermaid returned an invalid diagram size.");
	svg.classList.add("auth-flow-svg");
	svg.style.maxWidth = "none";
	svg.style.background = "transparent";
	svg.setAttribute("role", "img");
	svg.setAttribute("aria-label", "Authentication and setup flow: frontend and backend");
	for (const rect of svg.querySelectorAll(".node rect, .cluster rect"))
	{
		rect.setAttribute("rx", "0");
		rect.setAttribute("ry", "0");
	}

	const defs = svgElement("defs", {});
	const gradientId = `${id}-gradient`;
	const gradient = svgElement("radialGradient", { id: gradientId });
	for (const [
	   offset,
	   opacity
	] of [
	   [0, 1],
	   [28, 1],
	   [55, 0.65],
	   [85, 0.15],
	   [100, 0]
		])
	{
		gradient.append(svgElement("stop", {
		   offset: `${offset}%`,
		   "stop-color": "white",
		   "stop-opacity": opacity
		}));
	}
	defs.append(gradient);

	const edgeIds = new Set(graphEdges.map((edge) => edge.id));
	let pathIndex = 0;
	for (const edges of [...svg.querySelectorAll(".edgePaths")])
	{
		const base = edges.cloneNode(true);
		base.classList.add("auth-flow-edge-base");
		base.removeAttribute("id");
		base.setAttribute("aria-hidden", "true");
		for (const element of base.querySelectorAll("[id]")) element.removeAttribute("id");
		edges.before(base);
		for (const path of edges.querySelectorAll("path[data-edge]"))
		{
			if (!edgeIds.has(path.getAttribute("data-id"))) throw new Error("Unable to match a rendered connector to the flow graph.");
			const maskId = `${id}-mask-${pathIndex++}`;
			const circleId = `${maskId}-circle`;
			const mask = svgElement("mask", {
				id: maskId,
				maskUnits: "userSpaceOnUse",
				x: x - 1000,
				y: y - 1000,
				width: width + 2000,
				height: height + 2000,
			});
			mask.style.maskType = "alpha";
			const circle = svgElement("circle", {
				id: circleId,
				r: 160,
				opacity: 0,
				fill: `url(#${gradientId})`,
			});
			circle.classList.add("auth-flow-spotlight-mask");
			mask.append(circle);
			defs.append(mask);
			path.classList.add("auth-flow-animated-edge");
			path.setAttribute("data-spotlight-circle", circleId);
			path.setAttribute("mask", `url(#${maskId})`);
		}
	}
	svg.prepend(defs);
	return { svg: document.importNode(svg, true), width, height };
}

export default function AuthFlowDiagram()
{
	const id = useId();
	const viewportRef = useRef(null);
	const diagramRef = useRef(null);
	const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
	const [viewportWidth, setViewportWidth] = useState(1);
	const [
	   mobileLayout,
	   setMobileLayout
	] = useState(() => window.matchMedia(MOBILE_LAYOUT_QUERY).matches);
	const [status, setStatus] = useState("loading");
	const [error, setError] = useState("");
	const scale = Math.min(1, viewportWidth / dimensions.width);
	const instructionsId = `${id}-instructions`;

	useEffect(() =>
	{
		const media = window.matchMedia(MOBILE_LAYOUT_QUERY);
		function updateLayout(event)
		{
			setStatus("loading");
			setError("");
			setMobileLayout(event.matches);
		}
		media.addEventListener("change", updateLayout);
		return () => media.removeEventListener("change", updateLayout);
	}, []);

	useEffect(() =>
	{
		let cancelled = false;
		let stopAnimation = () =>
		{};
		const host = diagramRef.current;
		async function renderDiagram()
		{
			try
			{
				const graph = authFlowMarkdown.match(/```mermaid\s*\n([\s\S]*?)```/)?.[1];
				if (!graph) throw new Error("No Mermaid graph found in auth-setup-flow.md.");
				const source = mobileLayout ? graph.replace(/flowchart\s+LR\b/, "flowchart TB") : graph;
				const { default: mermaid } = await import("mermaid");
				if (cancelled) return;
				await document.fonts.ready;
				if (cancelled) return;
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					theme: "base",
					themeVariables: {
						background: "transparent",
						primaryColor: "transparent",
						primaryTextColor: "white",
						primaryBorderColor: "white",
						lineColor: "white",
						clusterBkg: "transparent",
						clusterBorder: "white",
						edgeLabelBackground: "transparent",
					},
				});
				const renderId = `auth-flow-mermaid-${++renderSequence}`;
				const parsed = await mermaid.mermaidAPI.getDiagramFromText(source);
				const graphEdges = parsed.db.getData().edges;
				const { svg: markup } = await mermaid.render(renderId, source);
				if (cancelled) return;
				const diagram = prepareDiagram(markup, renderId, graphEdges);
				host.replaceChildren(diagram.svg);
				for (const cluster of diagram.svg.querySelectorAll(".cluster"))
				{
					const label = cluster.querySelector(":scope > .cluster-label");
					const border = cluster.querySelector(":scope > rect");
					if (!label || !border) continue;
					const box = label.getBBox();
					const bounds = border.getBBox();
					const originalY = label.transform.baseVal.consolidate()?.matrix.f || 0;
					const labelScale = 1.5;
					const x = bounds.x + bounds.width / 2 - labelScale * (box.x + box.width / 2);
					const y = originalY - (labelScale - 1) * (box.y + box.height / 2);
					label.setAttribute("transform", `translate(${x}, ${y}) scale(${labelScale})`);
				}
				stopAnimation = startArrowSequence(diagram.svg, graphEdges);
				setDimensions({ width: diagram.width, height: diagram.height });
				setStatus("ready");
			}
			catch (cause)
			{
				if (cancelled) return;
				setError(cause instanceof Error ? cause.message : String(cause));
				setStatus("error");
			}
		}
		renderDiagram();
		return () =>
		{
			cancelled = true;
			stopAnimation();
			host.replaceChildren();
		};
	}, [mobileLayout]);

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
				<div className="auth-flow-kicker"><span>Authentication and setup flow</span></div>
			</div>
			<div className="auth-flow-viewport" ref={viewportRef} tabIndex={0} role="region" aria-label="Scrollable authentication and setup flow diagram" aria-describedby={instructionsId} aria-busy={status === "loading"}>
				{status === "loading" && <p role="status">Loading authentication flow…</p>}
				{status === "error" && <p role="alert">Unable to render authentication flow: {error}</p>}
				<div className="auth-flow-render" ref={diagramRef} />
			</div>
			<figcaption className="auth-flow-caption">
				<p id={instructionsId}>The frontend reuses a valid in-memory access token and uses refresh only when it is missing or expired. The diagram automatically fits the available width and switches to a vertical layout on mobile.</p>
				<ul>
					<li>A hard reload clears the in-memory access token, so it takes the refresh path.</li>
					<li>An empty refresh cookie follows the missing-cookie path. An invalid, expired, or revoked non-empty cookie returns an ordinary <code>401</code>.</li>
					<li>Network failures, <code>429</code>, and <code>5xx</code> from refresh or setup status remain error/retry states, not login redirects.</li>
					<li>Setup status is informational only. Setup creation must atomically verify that initial setup remains allowed.</li>
				</ul>
			</figcaption>
		</figure>
	);
}

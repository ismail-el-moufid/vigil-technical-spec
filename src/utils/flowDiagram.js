export const MOBILE_LAYOUT_QUERY = "(max-width: 760px)";
const SVG_NS = "http://www.w3.org/2000/svg";

export function getDiagramScale(width, viewportWidth, view = "fit")
{
	if (view === "actual" || width <= 0 || viewportWidth <= 0) return 1;
	const fit = viewportWidth / width;
	// Readable mode keeps the original 14–16px label range.
	return view === "fit" ? fit : Math.min(1, Math.max(0.875, fit));
}

// Keep initialization, parsing and rendering in one queue: Mermaid config is global.
let renderQueue = Promise.resolve();
let renderSequence = 0;

export function renderFlowDiagram(source)
{
	const render = async () =>
	{
		const { default: mermaid } = await import("mermaid");
		await document.fonts.ready;
		const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace";
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",

			theme: "base",
			themeVariables: {
				fontFamily,
				fontSize: "16px",
				background: "transparent",
				primaryColor: "transparent",
				primaryTextColor: "white",
				primaryBorderColor: "white",
				lineColor: "white",
				clusterBkg: "transparent",
				clusterBorder: "white",
				edgeLabelBackground: "transparent",
			},
			flowchart: {
				htmlLabels: true,
				useMaxWidth: false,
				curve: "basis",
				nodeSpacing: 36,
				rankSpacing: 52,
				padding: 16,
				wrappingWidth: 220,
				subGraphTitleMargin: { top: 12, bottom: 12 },
			},
		});
		const renderId = `auth-flow-mermaid-${++renderSequence}`;
		// A private staging host also contains Mermaid's error markup on failure.
		const staging = document.createElement("div");
		staging.style.visibility = "hidden";
		staging.style.position = "absolute";
		document.body.append(staging);
		try
		{
			const parsed = await mermaid.mermaidAPI.getDiagramFromText(source);
			if (typeof parsed.db.getData !== "function") throw new Error("Expected a Mermaid flowchart.");
			const graphData = parsed.db.getData();
			if (!Array.isArray(graphData.edges)) throw new Error("Expected a Mermaid flowchart.");
			const { svg: markup } = await mermaid.render(renderId, source, staging);
			return { markup, renderId, graphData };
		}
		finally
		{
			staging.remove();
		}
	};
	const result = renderQueue.then(render);
	// A malformed diagram must not block subsequent renders.
	renderQueue = result.catch(() =>
	{});
	return result;
}

function svgElement(name, attributes)
{
	const element = document.createElementNS(SVG_NS, name);
	for (const [
	   key,
	   value
	] of Object.entries(attributes)) element.setAttribute(key, value);
	return element;
}

// Yield one complete branch at a time, replaying its shared prefix. A cycle
// ends when the route returns to a node it already visited.
export function* flowRoutes(edges)
{
	const outgoing = new Map();
	const targets = new Set();
	for (const edge of edges)
	{
		if (!outgoing.has(edge.start)) outgoing.set(edge.start, []);
		outgoing.get(edge.start).push(edge);
		targets.add(edge.end);
	}

	const reached = new Set();
	function* visit(node, route, ancestors)
	{
		reached.add(node);
		const next = outgoing.get(node);
		if (!next || ancestors.has(node))
		{
			yield* route;
			return;
		}
		ancestors.add(node);
		for (const edge of next)
		{
			route.push(edge.id);
			yield* visit(edge.end, route, ancestors);
			route.pop();
		}
		ancestors.delete(node);
	}

	for (const node of outgoing.keys())
	{
		if (!targets.has(node)) yield* visit(node, [], new Set());
	}
	// A disconnected feedback loop may have no entry node.
	for (const node of outgoing.keys())
	{
		if (!reached.has(node)) yield* visit(node, [], new Set());
	}
}

export function getConnectorDuration(length, edgeCount)
{
	// Spread a reading beat across a compact diagram. Long paths still take
	// their full travel time, and dense diagrams retain the 450 ms minimum.
	const minimumMs = Math.max(450, Math.min(1500, 7200 / Math.max(1, edgeCount)));
	return Math.max(minimumMs, length / 360 * 1000);
}

export function startArrowSequence(svg, graphEdges)
{
	const steps = new Map();
	for (const path of svg.querySelectorAll(".auth-flow-animated-edge"))
	{
		const length = path.getTotalLength();
		const circle = svg.querySelector(`#${path.dataset.spotlightCircle}`);
		if (!circle || !Number.isFinite(length) || length <= 0) continue;
		circle.setAttribute("r", Math.min(160, Math.max(30, length * 0.35)));
		steps.set(path.getAttribute("data-id"), {
			path, circle, length, duration: getConnectorDuration(length, graphEdges.length)
		});
	}
	const edges = graphEdges.filter((edge) => steps.has(edge.id));
	let route = flowRoutes(edges);
	let step = steps.get(route.next().value);
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	let frame = null;
	let elapsed = 0;
	let previousTime = null;
	let finished = false;

	function tick(time)
	{
		if (finished)
		{
			step.circle.setAttribute("opacity", "0");
			let next = route.next();
			if (next.done)
			{
				route = flowRoutes(edges);
				next = route.next();
			}
			step = steps.get(next.value);
			elapsed = 0;
			previousTime = time;
			finished = false;
		}
		// Do not skip connectors when the tab resumes after being backgrounded.
		if (previousTime !== null) elapsed += Math.min(64, time - previousTime);
		previousTime = time;
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
		for (const step of steps.values()) step.circle.setAttribute("opacity", "0");
		svg.classList.toggle("flow-playing", !reducedMotion.matches && Boolean(step));
		if (!reducedMotion.matches && step) frame = requestAnimationFrame(tick);
	}
	reducedMotion.addEventListener("change", syncMotion);
	syncMotion();
	return () =>
	{
		cancelAnimationFrame(frame);
		for (const step of steps.values()) step.circle.setAttribute("opacity", "0");
		svg.classList.remove("flow-playing");
		reducedMotion.removeEventListener("change", syncMotion);
	};
}

export function prepareDiagram(markup, id, graphEdges, title = "Authentication and setup flow: frontend and backend")
{
	// Mermaid serializes HTML labels with void elements such as <br>, not XML <br/>.
	const documentNode = new DOMParser().parseFromString(markup, "text/html");
	const svg = documentNode.querySelector("svg");
	if (!svg) throw new Error("Mermaid returned no SVG diagram.");
	const [
	   x,
	   y,
	   width,
	   height
	] = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
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
	svg.setAttribute("aria-label", title);
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

export function fitDiagram(svg)
{
	// Keep Mermaid's measured label geometry; scaling labels after layout causes overlaps.
	const bounds = svg.getBBox();
	const view = svg.viewBox.baseVal;
	const padding = 20;
	const minX = Math.min(view.x, bounds.x - padding);
	const minY = Math.min(view.y, bounds.y - padding);
	const maxX = Math.max(view.x + view.width, bounds.x + bounds.width + padding);
	const maxY = Math.max(view.y + view.height, bounds.y + bounds.height + padding);
	svg.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
	return { width: maxX - minX, height: maxY - minY };
}

import { FAVICON_FRAMES, FAVICON_FRAME_INTERVAL_MS } from "./faviconFrames.js";

// CSS/SMIL animation inside an SVG favicon only actually plays in Firefox's
// tab strip — Chrome, Edge, and Safari render just the first frame and never
// repaint it. The only way to get a favicon that animates everywhere is the
// old "swap the icon file on an interval" trick, so we pre-render the shimmer
// sweep + sparkle cycle as a strip of small PNG frames (see faviconFrames.js)
// and cycle the <link rel="icon"> href between them here.
export function startFaviconAnimation()
{
	if (typeof document === "undefined" || FAVICON_FRAMES.length === 0) return () => {};

	let link = document.querySelector('link[rel="icon"]');
	if (!link)
	{
		link = document.createElement("link");
		link.rel = "icon";
		document.head.appendChild(link);
	}
	link.type = "image/png";

	let i = 0;
	const tick = () =>
	{
		link.href = FAVICON_FRAMES[i];
		i = (i + 1) % FAVICON_FRAMES.length;
	};
	tick();
	const id = setInterval(tick, FAVICON_FRAME_INTERVAL_MS);

	// Browsers throttle/suspend background-tab timers; resync immediately
	// on return so the icon doesn't look frozen on a stale frame.
	const onVisible = () =>
	{
		if (document.visibilityState === "visible") tick();
	};
	document.addEventListener("visibilitychange", onVisible);

	return () =>
	{
		clearInterval(id);
		document.removeEventListener("visibilitychange", onVisible);
	};
}

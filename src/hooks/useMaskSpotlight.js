/**
 * useMaskSpotlight - Creates a circular spotlight mask effect on an element.
 * The spotlight follows the cursor, revealing the border AND brightening the
 * text glyphs underneath — and only the glyphs, not their background — near
 * the cursor position. Uses CSS mask for a smooth, hardware-accelerated effect.
 *
 * Everything expensive (cloning the element's content, MutationObserver,
 * ResizeObserver) is deferred until the cursor actually enters the element —
 * not built on mount. With many cards on a page, eagerly building this for
 * every card regardless of whether it's ever hovered is the difference
 * between near-zero mount cost and a clone+observe pass per card on load.
 *
 * @param {boolean} isExpanded - When true, skips the spotlight entirely and
 * renders a plain white border instead (no text glow, no clone, no observers
 * at all — just a static border on mount). Pass component state here
 * directly, e.g. <div ref={useMaskSpotlight(isExpanded)}>. The returned ref
 * callback is memoized on `isExpanded`/`border`, so listeners are only torn
 * down and rebuilt when one of those actually changes — not on every
 * unrelated re-render of the component.
 * @param {{border?: boolean}} [options] - Set `border: false` to keep the
 * spotlight glow/tracking but drop the top/bottom border lines entirely —
 * used for cards nested inside another spot-bordered list (e.g. an
 * EndpointCard inside a page's "Endpoints used" list, or a PageCard inside
 * an endpoint's "Used by pages" list), where the outer list item shouldn't
 * also draw its own border.
 */

import { useCallback } from "react";

const SPOTLIGHT_RADIUS = "1000px";
const GLOW_RADIUS = "260px";

const spotlightStyle = (showBorder) => `
	position: absolute;
	inset: 0;
	pointer-events: none;
	${showBorder
		? `border-top: 0.1px solid currentColor;
	border-bottom: 0.1px solid currentColor;
	border-left: none;
	border-right: none;`
		: "border: none;"}
	border-radius: inherit;
	mask-image: radial-gradient(circle ${SPOTLIGHT_RADIUS} at var(--mx, -999px) var(--my, -999px), #000 0%, transparent 60%);
	-webkit-mask-image: radial-gradient(circle ${SPOTLIGHT_RADIUS} at var(--mx, -999px) var(--my, -999px), #000 0%, transparent 60%);
`;

// Wrapper for the cloned content. Pinned exactly over `wrap` so cloned
// glyphs line up pixel-for-pixel with the originals underneath.
const glowWrapStyle = `
	position: absolute;
	inset: 0;
	pointer-events: none;
	overflow: hidden;
`;

// Applied to the clone itself: paints text white but background-clip'd so
// only glyphs pick up the fill — backgrounds, borders, and any non-text
// chrome on cloned nodes stay fully transparent. Radially masked so the
// glow only shows near the cursor.
// Marks glowInner so App.css can suppress generated ::before/::after
// content within the clone — pseudo-elements aren't real DOM nodes, so
// they can't be reached or styled from sanitizeClone in JS.
const GLOW_CLONE_CLASS = "ms-glow-clone";

const glowInnerStyle = `
	color: transparent;
	background: #fff;
	background-clip: text;
	-webkit-background-clip: text;
	mask-image: radial-gradient(circle ${GLOW_RADIUS} at var(--mx, -999px) var(--my, -999px), rgba(0,0,0,0.85) 0%, transparent 70%);
	-webkit-mask-image: radial-gradient(circle ${GLOW_RADIUS} at var(--mx, -999px) var(--my, -999px), rgba(0,0,0,0.85) 0%, transparent 70%);
`;

const expandedStyle = (showBorder) => `
	position: absolute;
	inset: 0;
	pointer-events: none;
	${showBorder
		? `border: 0.1px solid rgba(255, 255, 255, 0.3);`
		: "border: none;"}
	border-radius: inherit;
`;

// Strips ids (avoid duplicate-id collisions) and form-control values
// (avoid duplicating interactive state) from a cloned subtree in place.
function sanitizeClone(node)
{
	if (node.nodeType !== 1) return;
	node.removeAttribute("id");
	// A cloned descendant's own explicit `color` (e.g. from a stylesheet
	// rule on its class) overrides the `color: transparent` it would
	// otherwise inherit from glowInner, which silently defeats
	// `background-clip: text` for that subtree — the glyphs render in
	// their normal color instead of clipping to the white glow fill.
	// Forcing color:inherit on every node closes that off.
	node.style.setProperty("color", "inherit", "important");
	if ("value" in node) node.value = "";
	for (const child of node.children) sanitizeClone(child);
}

function buildClone(wrap)
{
	const clone = wrap.cloneNode(true);
	clone.removeAttribute("style");
	clone.setAttribute("style", "all: unset; display: contents;");
	// `host` (the spotlight overlay) now lives inside `wrap`, so a deep
	// clone of `wrap` would otherwise include a clone of `host` itself —
	// recursing further on every subsequent rebuild. Strip it out.
	const hostInClone = clone.querySelector("[data-spotlight-host]");
	if (hostInClone) hostInClone.remove();
	sanitizeClone(clone);
	return clone;
}

export default function useMaskSpotlight(isExpanded = false, {
	border = true
} = {})
{
	return useCallback((wrap) =>
	{
		if (!wrap) return;

		// Expanded: just a static border, no spotlight tracking, no glow,
		// no observers — cheapest possible path, same cost as before.
		// Expanded always shows a full border; the `border` option only
		// affects the collapsed state's top/bottom border.
		if (isExpanded)
		{
			const borderEl = document.createElement("div");
			borderEl.setAttribute("style", expandedStyle(true));
			const wrapPos = getComputedStyle(wrap).position;
			if (wrapPos === "static") wrap.style.position = "relative";
			wrap.appendChild(borderEl);

			return () =>
			{
				borderEl.remove();
			};
		}

		// Collapsed: mount only a mouseenter listener. Nothing else is
		// built until the cursor actually arrives, so cards that are never
		// hovered cost one listener add/remove and nothing more.
		let teardownActive = null;

		function activate()
		{
			if (teardownActive) return;

			const wrapPosition = getComputedStyle(wrap).position;
			if (wrapPosition === "static") wrap.style.position = "relative";

			// `host` is appended directly inside `wrap` and filled with
			// inset: 0, so it always exactly matches wrap's box with no
			// cross-element math. Previously `host` was appended to
			// `wrap.parentElement` and positioned via
			// `wrap.getBoundingClientRect()` diffed against
			// `parent.getBoundingClientRect()`. That diff is sound in
			// general, but in Pages view `parent` is the group-section
			// <fieldset>, and appending a new child to a <fieldset>
			// invalidates and regenerates the UA-internal anonymous box
			// fieldsets use to carve out room for the <legend> — which
			// happens synchronously on the same appendChild call that adds
			// `host` itself. The fieldset's getBoundingClientRect() read
			// immediately after that append doesn't yet reflect the same
			// reference frame `wrap` (laid out earlier, unaffected by the
			// fieldset's box regeneration) is measured in, so the left/top
			// diff comes out wrong by roughly one row's worth of layout —
			// reproducibly, on the very first hover, regardless of any
			// other card's state. Anchoring `host` to `wrap` itself sidesteps
			// the fieldset entirely: no parent rect, no diffing, nothing
			// that can disagree.
			const host = document.createElement("div");
			host.setAttribute("data-spotlight-host", "");
			host.setAttribute(
				"style",
				"position: absolute; inset: 0; pointer-events: none;",
			);
			wrap.appendChild(host);

			const borderEl = document.createElement("div");
			borderEl.setAttribute("style", spotlightStyle(border));
			host.appendChild(borderEl);

			// Clone wrap's own content so background-clip:text has glyphs
			// in this overlay to clip against (an empty div has no text to
			// clip to). `host` lives inside `wrap` now (filled via
			// inset: 0, see activate() above), so buildClone() strips it
			// back out of the clone — see the data-spotlight-host check
			// there — to avoid cloning the overlay into itself.
			const glowWrap = document.createElement("div");
			glowWrap.setAttribute("style", glowWrapStyle);
			glowWrap.setAttribute("aria-hidden", "true");

			const glowInner = document.createElement("div");
			glowInner.className = GLOW_CLONE_CLASS;
			glowInner.setAttribute("style", glowInnerStyle);
			glowInner.appendChild(buildClone(wrap));
			glowWrap.appendChild(glowInner);
			host.appendChild(glowWrap);

			// `host`/`glowWrap` are sized and positioned to match wrap's
			// own resolved box exactly, but that doesn't guarantee the
			// CLONE's content lands in the same spot inside that box as
			// the original does inside wrap. CSS box-model effects that
			// resolve differently for an in-flow element (wrap) versus a
			// `display: contents` clone sitting inside an overflow:hidden
			// container (e.g. margin collapsing on wrap's first child
			// escaping wrap entirely in the real DOM, but getting trapped
			// as real space by glowWrap's overflow:hidden in the clone)
			// will silently throw the clone off by exactly that amount.
			// Rather than enumerate every CSS rule that could cause this,
			// measure the actual rendered offset between wrap and the
			// clone's content and correct for it directly.
			function alignClone()
			{
				glowInner.style.transform = "";

				// `buildClone(wrap)` clones wrap itself, so glowInner's
				// only child is a 1:1 stand-in for wrap, and *that* clone's
				// first element child is a 1:1 stand-in for wrap's first
				// element child. Compare those instead of wrap vs glowInner
				// directly: a plain wrap-vs-glowInner comparison only
				// agrees when margin on wrap's first child collapses *out*
				// of wrap into its parent. When wrap is itself a flex/grid
				// item (its own BFC), that margin is trapped inside wrap,
				// so wrap's own rect already reflects it but glowInner's
				// overflow:hidden box additionally traps the clone's copy
				// of that margin too — double-counting it and overcorrecting
				// by that amount. Anchoring on the first child sidesteps
				// the question of where the margin collapses entirely.
				const cloneRoot = glowInner.firstElementChild;
				const realAnchor = wrap.firstElementChild;
				const cloneAnchor = cloneRoot ? cloneRoot.firstElementChild : null;

				let dx, dy;
				if (realAnchor && cloneAnchor)
				{
					const realRect = realAnchor.getBoundingClientRect();
					const cloneRect = cloneAnchor.getBoundingClientRect();
					dx = realRect.left - cloneRect.left;
					dy = realRect.top - cloneRect.top;
				}
				else
				{
					// wrap has no element children to anchor on — fall
					// back to comparing the boxes directly.
					const wrapRect = wrap.getBoundingClientRect();
					const innerRect = glowInner.getBoundingClientRect();
					dx = wrapRect.left - innerRect.left;
					dy = wrapRect.top - innerRect.top;
				}

				if (dx || dy) glowInner.style.transform = `translate(${dx}px, ${dy}px)`;
			}
			alignClone();

			function onMouseMove(e)
			{
				const r = wrap.getBoundingClientRect();
				const mx = (e.clientX - r.left) + "px";
				const my = (e.clientY - r.top) + "px";
				borderEl.style.setProperty("--mx", mx);
				borderEl.style.setProperty("--my", my);
				glowInner.style.setProperty("--mx", mx);
				glowInner.style.setProperty("--my", my);
			}

			wrap.addEventListener("mousemove", onMouseMove);

			let pending = null;
			const observer = new MutationObserver((mutations) =>
			{
				// `host` now lives inside `wrap` (so it can fill it with
				// inset: 0), which means this observer — watching wrap's
				// subtree for real content changes to re-clone — would
				// otherwise also catch host's own children being rebuilt
				// below (border, glowWrap, glowInner) and re-trigger itself.
				// Skip any mutation whose target is inside host; those are
				// our own writes, not real content changes in wrap.
				const isReal = mutations.some((m) => !host.contains(m.target));
				if (!isReal) return;

				if (pending) return;
				pending = requestAnimationFrame(() =>
				{
					pending = null;
					glowInner.replaceChildren(buildClone(wrap));
					alignClone();
				});
			});
			observer.observe(wrap, {
			   childList: true,
			   subtree: true,
			   characterData: true
			});

			teardownActive = () =>
			{
				wrap.removeEventListener("mousemove", onMouseMove);
				observer.disconnect();
				if (pending) cancelAnimationFrame(pending);
				host.remove();
				teardownActive = null;
			};
		}

		function onMouseEnter()
		{
			activate();
		}

		function onMouseLeave()
		{
			if (teardownActive) teardownActive();
		}

		wrap.addEventListener("mouseenter", onMouseEnter);
		wrap.addEventListener("mouseleave", onMouseLeave);

		return () =>
		{
			wrap.removeEventListener("mouseenter", onMouseEnter);
			wrap.removeEventListener("mouseleave", onMouseLeave);
			if (teardownActive) teardownActive();
		};
	}, [isExpanded, border]);
}

import { useEffect, useState, useCallback, useRef } from "react";

// ── Shared global clock ───────────────────────────────────────────────────────
// All useBorderSpotlight instances share a single rAF loop and a single
// travelProgress value so every expanded group border sweeps in lockstep —
// the spotlight position is always the same fraction around the perimeter
// regardless of when a group was mounted or expanded.
//
// Subscribers register a callback; the loop runs only while at least one
// subscriber is active, and stops automatically when the last one unregisters.
const TRAVEL_SPEED = 0.002;
let sharedProgress = 0;
let sharedFrameId = null;
const subscribers = new Set();

function tickSharedClock()
{
	sharedProgress = (sharedProgress + TRAVEL_SPEED) % 1;
	for (const cb of subscribers) cb(sharedProgress);
	sharedFrameId = requestAnimationFrame(tickSharedClock);
}

function subscribeToSharedClock(cb)
{
	subscribers.add(cb);
	if (sharedFrameId === null)
	{
		sharedFrameId = requestAnimationFrame(tickSharedClock);
	}
	return () =>
	{
		subscribers.delete(cb);
		if (subscribers.size === 0 && sharedFrameId !== null)
		{
			cancelAnimationFrame(sharedFrameId);
			sharedFrameId = null;
		}
	};
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useBorderSpotlight - Creates a spotlight effect on fieldset borders
 *
 * When collapsed: spotlight follows the cursor (localized hover).
 * When expanded: a spotlight travels continuously around the border on a
 *                 loop, always — independent of hover — starting from the
 *                 cursor's last known position whenever a group expands.
 *
 * Uses parent-relative coords as single source of truth so the border glow
 * and legend overlay stay in perfect sync.
 *
 * The returned ref MUST go on the `<fieldset>` itself, not its wrapper div
 * — the wrapper is used as the positioning/coordinate context (`element.
 * parentElement`) and as the element hover is actually listened on, so
 * putting the ref there instead would shift that context up one level and
 * break every position calculation in this hook.
 *
 * @param {boolean} collapsed - Whether the fieldset is collapsed
 * @returns {Function} Callback ref to be used as a ref — attach to the fieldset
 */
export default function useBorderSpotlight(collapsed = false)
{
	const [element, setElement] = useState(null);

	// `collapsed` is a normal render-time value, but the mouse handlers
	// below are created ONCE (see the `[element]`-only effect further
	// down) and never recreated just because `collapsed` changed later.
	// Without this ref, those handlers would permanently close over
	// whatever `collapsed` was at the moment the fieldset first mounted
	// — almost always `true`, since groups start collapsed — and every
	// later toggle to expanded would silently keep using collapsed-mode
	// behavior. Reading `collapsedRef.current` instead of `collapsed`
	// inside the handlers keeps them looking at the live value.
	const collapsedRef = useRef(collapsed);

	// Tracks whether the mouse is currently inside the fieldset, and the
	// last known parent-relative mouse position. Needed because toggling
	// a group open/closed (clicking its own header, which lives INSIDE
	// the fieldset) doesn't fire a fresh mouseenter — so reacting only
	// inside handleMouseEnter would miss the most common real-world case.
	const isHoveringRef = useRef(false);
	const lastMouseRef = useRef({ x: 0, y: 0 });

	// When we're in the middle of collapsing the group, the CSS transition
	// on the real collapse-all button (max-width 140px → 0) hasn't started
	// yet on the first frame after React sets `disabled`. Reading
	// getBoundingClientRect() there returns the stale pre-transition width,
	// so the overlay button stays full-width for one frame and appears as a
	// strikethrough. Setting this ref to `true` tells syncCollapseBtnDimensions
	// to skip the layout read entirely and zero the overlay button directly,
	// eliminating the flash. Cleared once the transition window elapses.
	const collapsingBtnRef = useRef(false);

	// Lets the small `[collapsed]` effect below reach into whatever
	// start/stop/apply functions the big setup effect most recently
	// created, without needing the setup effect itself to depend on
	// `collapsed` (which would tear down and rebuild the whole clone,
	// legend overlay, and ResizeObserver on every toggle).
	const controlsRef = useRef({
	   start: () =>
		{},
	   stop: () =>
		{},
	   applySpotlight: () =>
		{},
	   startFromCursor: () =>
		{},
	   show: () =>
		{},
	   hide: () =>
		{},
	   setBorderShape: () =>
		{},
	   syncCollapseBtn: () =>
		{}
	});

	// React to collapsed/expanded toggles immediately, even mid-hover.
	//
	// Collapsed mode stays hover-gated: it only shows the localized
	// spotlight when the cursor is already over the fieldset.
	//
	// Expanded mode is hover-INDEPENDENT: the traveling spotlight is
	// always visible and always animating once a group is expanded,
	// whether or not the cursor happens to be over it. So every
	// transition into expanded shows it immediately, seeded from the
	// last known cursor position (falling back to {0, 0} if the mouse
	// has never been over the fieldset yet) so the spotlight appears to
	// "depart" from wherever the cursor actually is rather than
	// snapping back to the top-left corner.
	useEffect(() =>
	{
		collapsedRef.current = collapsed;
		controlsRef.current.setBorderShape(collapsed);

		if (collapsed)
		{
			controlsRef.current.stop();

			if (isHoveringRef.current)
			{
				const { x, y } = lastMouseRef.current;
				controlsRef.current.applySpotlight(x, y);

				// Set the collapsing flag BEFORE show() so that any
				// syncCollapseBtn call — including the one triggered by the
				// MutationObserver's innerHTML rebuild when React sets
				// `disabled` — immediately zeros the overlay button rather
				// than reading the stale pre-transition layout width.
				// Clear the flag after 200ms (the CSS transition is 150ms).
				collapsingBtnRef.current = true;
				controlsRef.current.syncCollapseBtn();
				controlsRef.current.show();
				setTimeout(() =>
				{
					collapsingBtnRef.current = false;
				}, 200);
			}
			else
			{
				controlsRef.current.hide();
			}
		}
		else
		{
			const { x, y } = lastMouseRef.current;
			controlsRef.current.show();
			controlsRef.current.startFromCursor(x, y);
		}
	}, [collapsed]);

	useEffect(() =>
	{
		if (!element) return;

		const parent = element.parentElement;
		const parentStyle = window.getComputedStyle(parent);
		if (parentStyle.position === "static")
		{
			parent.style.setProperty("position", "relative");
		}

		// ── Border clone ──────────────────────────────────────────────────
		const clone = element.cloneNode(true);
		clone.removeAttribute("id");
		clone.classList.add("spot-border", "spot-border-clone");
		clone.style.position = "absolute";
		clone.style.boxSizing = "border-box";
		clone.style.margin = "0";
		clone.style.pointerEvents = "none";
		clone.style.opacity = "0";
		clone.style.transition = "opacity 0.2s ease";
		clone.style.border = "0.1px solid var(--border, #fff)";
		clone.style.borderRadius = "inherit";

		// Switches the clone between a full four-sided border (expanded)
		// and a top-edge-only border (collapsed). `clone` is a brand-new
		// node we created above, never the `element` state value itself —
		// keeping all mutation of it here, and exposing it through
		// controlsRef below, means nothing later ever needs to re-derive
		// it from `element` (e.g. via `element.nextElementSibling`), which
		// is what previously tripped the immutability lint rule on state.
		const setBorderShape = (isCollapsed) =>
		{
			if (isCollapsed)
			{
				clone.style.borderTop = "0.1px solid var(--border, #fff)";
				clone.style.borderRight = "transparent";
				clone.style.borderBottom = "transparent";
				clone.style.borderLeft = "transparent";
			}
			else
			{
				clone.style.border = "0.1px solid var(--border, #fff)";
			}
		};

		setBorderShape(collapsedRef.current);

		// Hide ALL children — legend included — so only the border draws.
		// The legend is handled by a separate sibling overlay instead.
		clone.querySelectorAll("*").forEach((node) =>
		{
			node.style.visibility = "hidden";
		});

		// Kept so syncLegendContent (below) can resync this too. The browser
		// computes the native fieldset border-skip gap from THIS legend's
		// own rendered width — not the live one — so if it's left frozen
		// at its mount-time size, the gap stays sized for whatever the
		// legend looked like then. When content that changes the legend's
		// width changes later (e.g. the count badge growing from a single
		// digit to two), the skip gap doesn't grow with it, and the border
		// resumes early — cutting straight through the new content instead
		// of routing around it.
		const cloneLegend = clone.querySelector("legend");

		element.insertAdjacentElement("afterend", clone);

		// ── Legend overlay ────────────────────────────────────────────────
		// Appended to parent, NOT inside clone, so its mask is independent.
		const originalLegend = element.querySelector("legend");
		let legendOverlay = null;

		if (originalLegend)
		{
			// Clone the actual legend element so browser rendering is identical.
			// Position it absolutely over the original using getBoundingClientRect.
			legendOverlay = originalLegend.cloneNode(true);
			legendOverlay.setAttribute("aria-hidden", "true");
			legendOverlay.style.position = "absolute";
			legendOverlay.style.pointerEvents = "none";
			legendOverlay.style.opacity = "0";
			legendOverlay.style.transition = "opacity 0.2s ease";
			legendOverlay.style.margin = "0";
			legendOverlay.style.zIndex = "2";
			legendOverlay.style.color = "var(--border, #fff)";

			// The legend's own children (label, count, toggle arrow) carry
			// explicit `color` rules in CSS, which blocks inheritance from
			// this wrapper. Force every descendant too, or the overlay
			// renders in the exact same color as the original underneath
			// it and the spotlight reveal is invisible.
			legendOverlay.querySelectorAll("*").forEach((node) =>
			{
				node.style.color = "var(--border, #fff)";
			});

			// The collapse-all button has CSS transitions (max-width,
			// padding, opacity — see .group-hd-collapse-btn in App.css).
			// Fresh cloned nodes don't replay those transitions; they snap
			// to their final state instantly. Rather than hiding the button
			// (which removed it from the spotlight entirely), we disable
			// transitions on the overlay copy and synchronize its exact
			// rendered dimensions from the real button every animation
			// frame (see syncCollapseBtnDimensions below). That way the
			// overlay button always mirrors the real one — mid-transition
			// included — so it correctly receives the spotlight glow.
			legendOverlay.querySelectorAll(".group-hd-collapse-btn").forEach((btn) =>
			{
				btn.style.transition = "none";
			});

			parent.appendChild(legendOverlay);
		}

		// ── Keep legend overlay content in sync ───────────────────────────
		// legendOverlay above is a ONE-TIME clone taken when this effect
		// first ran. But the real legend keeps changing after that — most
		// visibly, the expand/collapse toggle arrow flips direction. Left
		// alone, the overlay would freeze on whatever the legend looked
		// like at clone time, so toggling could show a stale arrow (e.g.
		// still pointing the collapsed way after expanding). Re-clone the
		// content into the overlay any time the real legend mutates.
		let legendContentObserver = null;

		// Declared here (outside the originalLegend guard) so animate() —
		// which is also defined outside that block — can call it without a
		// ReferenceError. Assigned to a real implementation below if there
		// is a legend; otherwise stays a no-op so the rAF loop is safe.
		let syncCollapseBtnDimensions = () =>
		{};

		if (originalLegend && legendOverlay)
		{
			const realCollapseBtn = originalLegend.querySelector(".group-hd-collapse-btn");

			// Syncs the overlay's collapse-all button to match the REAL
			// button's exact current rendered dimensions (width, padding,
			// margin, opacity) — read via getBoundingClientRect /
			// getComputedStyle so they reflect mid-transition values. Called
			// from syncLegendContent (so a fresh innerHTML clone is
			// immediately corrected) and from every animate() frame (so the
			// button tracks the real one throughout a transition).
			syncCollapseBtnDimensions = () =>
			{
				if (!realCollapseBtn) return;
				const overlayBtn = legendOverlay.querySelector(".group-hd-collapse-btn");
				if (!overlayBtn) return;

				overlayBtn.style.transition = "none";
				overlayBtn.style.maxWidth   = "none";

				// If we're mid-collapse we already KNOW the button should be
				// invisible — don't read getBoundingClientRect() because the
				// CSS transition may not have started yet and we'd get the
				// stale pre-transition width, which draws as a strikethrough.
				// Zero everything directly and bail early instead.
				if (collapsingBtnRef.current)
				{
					overlayBtn.style.width        = "0px";
					overlayBtn.style.paddingLeft  = "0px";
					overlayBtn.style.paddingRight = "0px";
					overlayBtn.style.opacity      = "0";
					return;
				}

				const cs = window.getComputedStyle(realCollapseBtn);
				overlayBtn.style.width            = realCollapseBtn.getBoundingClientRect().width + "px";
				overlayBtn.style.paddingLeft      = cs.paddingLeft;
				overlayBtn.style.paddingRight     = cs.paddingRight;
				overlayBtn.style.borderLeftWidth  = cs.borderLeftWidth;
				overlayBtn.style.borderRightWidth = cs.borderRightWidth;
				overlayBtn.style.marginLeft       = cs.marginLeft;
				overlayBtn.style.opacity          = cs.opacity;
			};

			const syncLegendContent = () =>
			{
				legendOverlay.innerHTML = originalLegend.innerHTML;
				legendOverlay.querySelectorAll("*").forEach((node) =>
				{
					node.style.color = "var(--border, #fff)";
				});
				legendOverlay.querySelectorAll(".group-hd-collapse-btn").forEach((btn) =>
				{
					btn.style.transition = "none";
				});
				// Immediately snap the overlay btn to the real btn's current
				// rendered size (post-innerHTML rebuild the reference is fresh).
				syncCollapseBtnDimensions();

				// Same resync, but for the clone's own legend — this is the
				// one that actually drives the native border-skip gap, so
				// it needs to grow/shrink with the real legend too (see the
				// comment by cloneLegend's declaration above).
				if (cloneLegend)
				{
					cloneLegend.innerHTML = originalLegend.innerHTML;
					cloneLegend.querySelectorAll("*").forEach((node) =>
					{
						node.style.visibility = "hidden";
					});
				}
			};

			legendContentObserver = new MutationObserver(syncLegendContent);
			legendContentObserver.observe(originalLegend,
				{
					childList: true,
					subtree: true,
					attributes: true,
					characterData: true
				});
		}

		// ── Sync positions ────────────────────────────────────────────────
		const sync = () =>
		{
			const pr = parent.getBoundingClientRect();
			const fr = element.getBoundingClientRect();

			clone.style.top    = (fr.top  - pr.top  - 1) + "px";
			clone.style.left   = (fr.left - pr.left - 1) + "px";
			clone.style.width  = (fr.width  + 2) + "px";
			clone.style.height = (fr.height + 2) + "px";

			if (originalLegend && legendOverlay)
			{
				const lr = originalLegend.getBoundingClientRect();
				// Use the legend's exact rendered rect — this captures
				// any browser-native legend positioning automatically
				legendOverlay.style.top    = (lr.top  - pr.top)  + "px";
				legendOverlay.style.left   = (lr.left - pr.left) + "px";
				// Don't constrain width/height — let it size naturally
				// from its own font/padding so it matches the original
			}
		};

		sync();

		const resizeObserver = new ResizeObserver(sync);
		resizeObserver.observe(element);
		resizeObserver.observe(parent);

		// ── Spotlight — all coords in parent-relative space ───────────────
		// Bumped up from 120px so the glow washes over a wider stretch of
		// border at once, and given extra gradient stops (instead of one
		// hard 40%→transparent cliff) for a softer, more natural falloff.
		const SPOTLIGHT_RADIUS = 1000;

		const spotlightGradient = (x, y, radius) =>
			`radial-gradient(circle ${radius}px at ${x}px ${y}px, ` +
			`white 0%, white 28%, rgba(255,255,255,0.65) 55%, rgba(255,255,255,0.15) 85%, transparent 100%)`;

		const applySpotlight = (px, py) =>
		{
			const bcLeft = parseFloat(clone.style.left);
			const bcTop  = parseFloat(clone.style.top);
			const bm = spotlightGradient(px - bcLeft, py - bcTop, SPOTLIGHT_RADIUS);
			clone.style.webkitMaskImage = bm;
			clone.style.maskImage = bm;

			if (legendOverlay)
			{
				const loLeft = parseFloat(legendOverlay.style.left);
				const loTop  = parseFloat(legendOverlay.style.top);
				const lm = spotlightGradient(px - loLeft, py - loTop, SPOTLIGHT_RADIUS);
				legendOverlay.style.webkitMaskImage = lm;
				legendOverlay.style.maskImage = lm;
			}
		};

		const show = () =>
		{
			clone.style.opacity = "1";
			if (legendOverlay) legendOverlay.style.opacity = "1";
		};

		const hide = () =>
		{
			clone.style.opacity = "0";
			clone.style.webkitMaskImage = "";
			clone.style.maskImage = "";

			if (legendOverlay)
			{
				legendOverlay.style.opacity = "0";
				legendOverlay.style.webkitMaskImage = "";
				legendOverlay.style.maskImage = "";
			}
		};

		// ── Travel animation ──────────────────────────────────────────────
		// This instance subscribes to the module-level shared clock so all
		// expanded group borders sweep in lockstep. `unsubscribe` holds the
		// cleanup returned by subscribeToSharedClock(); null when inactive.
		let unsubscribe = null;

		// Walks the perimeter of a w×h box. Returns a point in THAT box's
		// own local coordinate space — the caller picks which shape to walk.
		const perimeterPoint = (progress, w, h) =>
		{
			const perimeter = 2 * (w + h);
			const dist = ((progress % 1) + 1) % 1 * perimeter;

			let lx, ly;
			if (dist < w)
			{
				lx = dist;              ly = 0;
			}
			else if (dist < w + h)
			{
				lx = w;                 ly = dist - w;
			}
			else if (dist < 2 * w + h)
			{
				lx = w - (dist - w - h); ly = h;
			}
			else
			{
				lx = 0;                 ly = h - (dist - 2 * w - h);
			}

			return { x: lx, y: ly };
		};

		// Inverse of perimeterPoint: given a point in a w×h box's local
		// coordinate space, finds the closest point ON the perimeter and
		// returns its progress (0–1) around that perimeter. Used to seed
		// the travel animation at the spot nearest the cursor instead of
		// always restarting from progress 0.
		const closestPerimeterProgress = (lx, ly, w, h) =>
		{
			if (w <= 0 || h <= 0) return 0;

			const cx = Math.min(Math.max(lx, 0), w);
			const cy = Math.min(Math.max(ly, 0), h);

			const distTop    = cy;
			const distBottom = h - cy;
			const distLeft   = cx;
			const distRight  = w - cx;
			const minDist = Math.min(distTop, distBottom, distLeft, distRight);

			const perimeter = 2 * (w + h);
			let dist;

			if (minDist === distTop)         dist = cx;
			else if (minDist === distRight)  dist = w + cy;
			else if (minDist === distBottom) dist = 2 * w + h - cx;
			else                              dist = 2 * w + 2 * h - cy; // distLeft

			return dist / perimeter;
		};

		// Called on every shared-clock tick while this instance is active.
		// `progress` is the global sharedProgress value — identical for all
		// subscribers in the same frame, so all borders advance together.
		const onTick = (progress) =>
		{
			// Border: walks its own full perimeter.
			const bw = parseFloat(clone.style.width);
			const bh = parseFloat(clone.style.height);
			const { x: bx, y: by } = perimeterPoint(progress, bw, bh);
			const bm = spotlightGradient(bx, by, SPOTLIGHT_RADIUS);
			clone.style.webkitMaskImage = bm;
			clone.style.maskImage = bm;

			// Legend: walks its OWN (much smaller) perimeter using the
			// SAME progress value so it stays in visual sync with the border.
			if (legendOverlay)
			{
				const lRect = legendOverlay.getBoundingClientRect();
				const {
				   x: lx,
				   y: ly
				} = perimeterPoint(progress, lRect.width, lRect.height);
				const borderPerimeter = 2 * (bw + bh);
				const legendPerimeter = 2 * (lRect.width + lRect.height);
				const legendRadius = borderPerimeter > 0
					? Math.max(24, SPOTLIGHT_RADIUS * (legendPerimeter / borderPerimeter))
					: SPOTLIGHT_RADIUS;
				const lm = spotlightGradient(lx, ly, legendRadius);
				legendOverlay.style.webkitMaskImage = lm;
				legendOverlay.style.maskImage = lm;
			}

			// Sync collapse-all button dimensions every frame so the
			// overlay button tracks the real button's CSS transitions
			// (max-width, padding, opacity) without ghosting.
			syncCollapseBtnDimensions();
		};

		const startTravelAnimation = () =>
		{
			if (unsubscribe !== null) return; // already subscribed
			unsubscribe = subscribeToSharedClock(onTick);
		};

		const stopTravelAnimation = () =>
		{
			if (unsubscribe !== null)
			{
				unsubscribe();
				unsubscribe = null;
			}
		};

		// Seeds the shared clock's progress from wherever the cursor
		// currently is (parent-relative px, py), then (re)starts the
		// subscription. This keeps the visual "departure point" near the
		// cursor when a group expands, even though the seed is applied to
		// the shared progress — all other subscribers jump to the same
		// position, which is intentional: they were already in sync, and
		// seeding preserves that rather than creating a gap.
		const startTravelFromCursor = (px, py) =>
		{
			// Only seed the shared clock from the cursor position when no
			// other groups are currently animating. If peers are already
			// running, jumping sharedProgress would teleport all their
			// borders instantly — instead, just join the existing clock
			// wherever it already is so everything stays in smooth sync.
			if (subscribers.size === 0)
			{
				const bcLeft = parseFloat(clone.style.left);
				const bcTop  = parseFloat(clone.style.top);
				const bw = parseFloat(clone.style.width);
				const bh = parseFloat(clone.style.height);

				const progress = closestPerimeterProgress(px - bcLeft, py - bcTop, bw, bh);
				sharedProgress = ((progress % 1) + 1) % 1;
			}

			// Force a re-subscribe so onTick fires immediately at the
			// current seed position even if we were already subscribed.
			stopTravelAnimation();
			startTravelAnimation();
		};

		// Expose the live controls so the `[collapsed]` effect above can
		// react to a toggle that happens mid-hover (e.g. clicking the
		// header) without waiting for a mouseenter that won't come.
		controlsRef.current =
		{
		   start: startTravelAnimation,
		   stop: stopTravelAnimation,
		   applySpotlight,
		   startFromCursor: startTravelFromCursor,
		   show,
		   hide,
		   setBorderShape,
		   syncCollapseBtn: syncCollapseBtnDimensions
		};

		// Expanded mode is hover-independent: if a group mounts already
		// expanded, the spotlight starts traveling immediately rather
		// than waiting for a mouseenter that may never come.
		if (!collapsedRef.current)
		{
			show();
			startTravelAnimation();
		}

		// ── Event handlers ────────────────────────────────────────────────

		const handleMouseMove = (e) =>
		{
			const pr = parent.getBoundingClientRect();
			const px = e.clientX - pr.left;
			const py = e.clientY - pr.top;
			lastMouseRef.current = { x: px, y: py };

			if (collapsedRef.current)
			{
				applySpotlight(px, py);
				// Collapsed mode has no rAF loop, so sync the collapse btn
				// dimensions here instead (handles the show/hide transition
				// while the group is collapsed and the cursor is over it).
				syncCollapseBtnDimensions();
			}
		};

		const handleMouseEnter = () =>
		{
			isHoveringRef.current = true;

			// Expanded mode is already visible & animating regardless of
			// hover (see mount-time autoplay and the [collapsed] effect
			// above), so only collapsed mode needs to react here.
			if (collapsedRef.current)
			{
				show();
			}
		};

		const handleMouseLeave = () =>
		{
			isHoveringRef.current = false;

			// Only collapsed mode's localized spotlight hides on leave —
			// expanded mode keeps traveling whether or not the cursor is
			// over the fieldset.
			if (collapsedRef.current)
			{
				hide();
			}
		};

		// Listen on `parent` (the `.group-section-wrap` / `.meta-group-wrap`
		// div), not `element` (the fieldset) — the wrapper now owns the
		// click handler and the padding that used to live on the fieldset,
		// so hovering that padding should trigger the spotlight too. `ref`
		// itself stays on the fieldset (moving it would make `parent` the
		// wrapper's OWN parent instead, breaking every position calculation
		// above), only the listeners move up one level. All coordinates
		// passed to applySpotlight/handleMouseMove are already parent-
		// relative, so nothing else needs to change.
		parent.addEventListener("mouseenter", handleMouseEnter);
		parent.addEventListener("mousemove", handleMouseMove);
		parent.addEventListener("mouseleave", handleMouseLeave);

		return () =>
		{
			stopTravelAnimation();
			parent.removeEventListener("mouseenter", handleMouseEnter);
			parent.removeEventListener("mousemove", handleMouseMove);
			parent.removeEventListener("mouseleave", handleMouseLeave);
			resizeObserver.disconnect();
			legendContentObserver?.disconnect();
			if (clone.parentNode) clone.parentNode.removeChild(clone);
			if (legendOverlay?.parentNode) legendOverlay.parentNode.removeChild(legendOverlay);
			controlsRef.current =
			{
			   start: () =>
				{},
			   stop: () =>
				{},
			   applySpotlight: () =>
				{},
			   startFromCursor: () =>
				{},
			   show: () =>
				{},
			   hide: () =>
				{},
			   setBorderShape: () =>
				{},
			   syncCollapseBtn: () =>
				{}
			};
		};
	}, [element]);

	return useCallback((el) =>
	{
		setElement(el);
	}, []);
}

import { useState, useEffect, useRef, useLayoutEffect } from "react";
import "./App.css";
import { ENDPOINTS, PAGES } from "./data";
import { isPhone } from "./utils/device.js";
import EndpointsView from "./views/EndpointsView.jsx";
import PagesView from "./views/PagesView.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import SecurityReference from "./components/SecurityReference.jsx";
import { setRefNavHandler } from "./utils/refNav.js";

const TABS = ["endpoints", "pages"];
const isMac = /mac/i.test(navigator.platform);

export default function App()
{
	const [tab, setTab] = useState("endpoints");
	const [prevTab, setPrevTab] = useState(null);
	const [animKey, setAnimKey] = useState(0);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [activeEpId, setActiveEpId] = useState(null);
	const [activePageId, setActivePageId] = useState(null);
	const [secOpen, setSecOpen] = useState(false);
	const [activeStratId, setActiveStratId] = useState(null);

	const topbarRef = useRef(null);
	const mainRef = useRef(null);
	const [topbarHidden, setTopbarHidden] = useState(false);

	const hoveringRef = useRef(false);
	const hideTimerRef = useRef(null);
	const scheduleHideRef = useRef(() =>
	{});

	const IDLE_HIDE_MS = 2500;

	// Keep --topbar-h in sync with the header's real height (it grows when
	// the shortcuts hint wraps to a second line), so .main's padding-top
	// never falls out of sync and content doesn't jump under/over it.
	useLayoutEffect(() =>
	{
		const el = topbarRef.current;
		if (!el) return;
		const setVar = () =>
		{
			document.documentElement.style.setProperty("--topbar-h", `${el.offsetHeight}px`);
		};
		setVar();
		const ro = new ResizeObserver(setVar);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// Auto-hide the header on scroll: down hides it, up (or being near the
	// top) shows it. Runs off a rAF-batched, passive scroll listener on
	// .main (the actual scroll container — the page itself never scrolls),
	// and only the transform changes, so there's no layout thrash.
	useEffect(() =>
	{
		const el = mainRef.current;
		if (!el) return;

		let lastY = el.scrollTop;
		let ticking = false;

		const IGNORE_DELTA = 6; // swallow tiny/trackpad jitter
		const TOP_ZONE = 48; // always show once scrolled back this close to the top

		const clearHideTimer = () =>
		{
			if (hideTimerRef.current)
			{
				clearTimeout(hideTimerRef.current);
				hideTimerRef.current = null;
			}
		};

		// Restart the idle countdown; while hovering, keep it visible and
		// don't schedule anything (onLeave will re-schedule when hover ends).
		const scheduleHide = () =>
		{
			clearHideTimer();
			if (hoveringRef.current) return;
			hideTimerRef.current = setTimeout(() =>
			{
				if (!hoveringRef.current) setTopbarHidden(true);
			}, IDLE_HIDE_MS);
		};
		scheduleHideRef.current = scheduleHide;

		const update = () =>
		{
			const y = el.scrollTop;
			const dy = y - lastY;

			if (y <= TOP_ZONE)
			{
				setTopbarHidden(false);
				clearHideTimer();
			}
			else if (Math.abs(dy) > IGNORE_DELTA)
			{
				const hiding = dy > 0;
				setTopbarHidden(hiding);
				if (hiding)
				{
					clearHideTimer();
				}
				else
				{
					scheduleHide();
				}
			}

			lastY = y;
			ticking = false;
		};

		const onScroll = () =>
		{
			if (!ticking)
			{
				ticking = true;
				requestAnimationFrame(update);
			}
		};

		el.addEventListener("scroll", onScroll, { passive: true });
		return () =>
		{
			el.removeEventListener("scroll", onScroll);
			clearHideTimer();
		};
	}, []);

	const switchTab = (t) =>
	{
		if (t === tab) return;
		setPrevTab(tab);
		setTab(t);
		setAnimKey((k) => k + 1);
		setTopbarHidden(false);
		scheduleHideRef.current();
	};

	const navigateTo = (nextTab, epId = null, pageId = null) =>
	{
		if (nextTab !== tab) switchTab(nextTab);
		setActiveEpId(epId);
		setActivePageId(pageId);
		setTopbarHidden(false);
		scheduleHideRef.current();
		if (epId) setTimeout(() => setActiveEpId(null), 1200);
		if (pageId) setTimeout(() => setActivePageId(null), 1200);
	};

	// Route a RefText pill click: an endpoint id switches tabs and expands
	// the card via the existing navigateTo path; anything else is treated
	// as an auth-strategy id and just opens/highlights it inside the
	// always-mounted SecurityReference card (no tab switch needed).
	useEffect(() =>
	{
		setRefNavHandler((id) =>
		{
			if (ENDPOINTS.some((e) => e.id === id))
			{
				navigateTo("endpoints", id);
			}
			else
			{
				setActiveStratId(id);
				setTimeout(() => setActiveStratId(null), 1200);
			}
		});
		return () => setRefNavHandler(null);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tab]);

	useEffect(() =>
	{
		if (isPhone) return;
		const handler = (e) =>
		{
			// ⌘K / Ctrl+K — open command palette
			if ((e.metaKey || e.ctrlKey) && e.key === "k")
			{
				e.preventDefault();
				setPaletteOpen((o) => !o);
			}

			// ⌥1 / ⌥2 — switch tabs (uses e.code so Alt+digit works on Mac too)
			if (e.altKey && !e.ctrlKey && !e.metaKey)
			{
				if (e.code === "Digit1")
				{
					e.preventDefault(); switchTab("endpoints");
				}
				if (e.code === "Digit2")
				{
					e.preventDefault(); switchTab("pages");
				}
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tab]);

	const isEps = tab === "endpoints";
	const tabViewClass = `tab-view tab-view--${prevTab === "endpoints" ? "from-left" : "from-right"}`;

	return (
		<div className="layout">
			<header
				ref={topbarRef}
				className={"topbar" + (topbarHidden ? " topbar--hidden" : "")}
				onMouseEnter={() =>
				{
					hoveringRef.current = true;
				}}
				onMouseLeave={() =>
				{
					hoveringRef.current = false;
					scheduleHideRef.current();
				}}
			>
				<div className="topbar-brand">
					<span className="wordmark">
						Vigil
						<span className="wordmark-sparkle wordmark-sparkle--1" aria-hidden="true" />
						<span className="wordmark-sparkle wordmark-sparkle--2" aria-hidden="true" />
						<span className="wordmark-sparkle wordmark-sparkle--3" aria-hidden="true" />
					</span>
					<span className="tagline">Technical Spec</span>
				</div>

				<nav className="topbar-tabs">
					{TABS.map((t, i) => (
						<button
							key={t}
							className={"tab-btn" + (tab === t ? " active" : "")}
							onClick={() => switchTab(t)}
						>
							{t.charAt(0).toUpperCase() + t.slice(1)}
							<span className="tab-btn-count">
								{t === "endpoints" ? ENDPOINTS.length : PAGES.length}
							</span>
							{tab !== t && !isPhone && (
								<kbd className="tab-btn-shortcut">{isMac ? "⌥" : "Alt+"}{i + 1}</kbd>
							)}
						</button>
					))}
				</nav>

				{!isPhone && (
					<span className="topbar-shortcuts">
						<kbd>Esc</kbd> collapse one level <kbd>Shift</kbd>+<kbd>Esc</kbd> collapse all <kbd>Ctrl</kbd>+<kbd>1</kbd>-<kbd>9</kbd> collapse item
					</span>
				)}

				<button className="pal-trigger" onClick={() => setPaletteOpen(true)}>
					<span className="pal-trigger-icon">⌕</span>
					<span className="pal-trigger-text">Jump to…</span>
					{!isPhone && (
						<kbd className="pal-trigger-kbd">{isMac ? "⌘K" : "Ctrl+K"}</kbd>
					)}
				</button>
			</header>

			<div ref={mainRef} className="main">
				<SecurityReference
					open={secOpen}
					onToggle={() => setSecOpen((o) => !o)}
					activeStratId={activeStratId}
				/>
				<div key={animKey} className={tabViewClass}>
					{isEps
						? <EndpointsView highlightId={activeEpId} />
						: <PagesView highlightPageId={activePageId} highlightEndpointId={activeEpId} />
					}
				</div>
			</div>

			<CommandPalette
				open={paletteOpen}
				onClose={() => setPaletteOpen(false)}
				onNavigate={navigateTo}
			/>
		</div>
	);
}

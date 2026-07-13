import { useState, useEffect } from "react";
import "./App.css";
import { ENDPOINTS, PAGES } from "./data";
import { isPhone } from "./utils/device.js";
import EndpointsView from "./views/EndpointsView.jsx";
import PagesView from "./views/PagesView.jsx";
import CommandPalette from "./components/CommandPalette.jsx";

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

	const switchTab = (t) =>
	{
		if (t === tab) return;
		setPrevTab(tab);
		setTab(t);
		setAnimKey((k) => k + 1);
	};

	const navigateTo = (nextTab, epId = null, pageId = null) =>
	{
		if (nextTab !== tab) switchTab(nextTab);
		setActiveEpId(epId);
		setActivePageId(pageId);
		if (epId) setTimeout(() => setActiveEpId(null), 1200);
		if (pageId) setTimeout(() => setActivePageId(null), 1200);
	};

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
			<header className="topbar">
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

				<button className="pal-trigger" onClick={() => setPaletteOpen(true)}>
					<span className="pal-trigger-icon">⌕</span>
					<span className="pal-trigger-text">Jump to…</span>
					{!isPhone && (
						<kbd className="pal-trigger-kbd">{isMac ? "⌘K" : "Ctrl+K"}</kbd>
					)}
				</button>
			</header>

			<div className="main">
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

import { useState } from "react";
import "./App.css";
import { ENDPOINTS, PAGES } from "./data";
import useToggleSet from "./hooks/useToggleSet.js";
import groupBy from "./utils/groupBy.js";
import EndpointsView from "./views/EndpointsView.jsx";
import PagesView from "./views/PagesView.jsx";
import SidebarMetaHeader from "./components/ui/SidebarMetaHeader.jsx";
import SidebarGroupHeader from "./components/ui/SidebarGroupHeader.jsx";
import SidebarItem from "./components/ui/SidebarItem.jsx";

/**
 * App is the main component that handles tab navigation and sidebar.
 */
export default function App()
{
	const [tab, setTab] = useState("endpoints");
	const [prevTab, setPrevTab] = useState(null);
	const [animKey, setAnimKey] = useState(0);

	// All three state values update in one synchronous batch so the new view
	// and the CSS animation class both arrive on the same commit.  The old
	// `displayTab` / rAF delay caused the NEW div to mount with the OLD view
	// (displayTab hadn't changed yet), so the animation played on the wrong
	// content and the new view appeared without any animation at all.
	// useBorderSpotlight now defers its heavy DOM setup to the next rAF
	// internally, so there is no need to delay the mount here.
	const switchTab = (t) =>
	{
		if (t === tab) return;
		setPrevTab(tab);
		setTab(t);
		setAnimKey((k) => k + 1);
	};

	const [search, setSearch] = useState("");
	const [activeEpId, setActiveEpId] = useState(null);
	const [activePageId, setActivePageId] = useState(null);
	const [openSidebarGroups, toggleSidebarGroup, ensureSidebarGroup] =
		useToggleSet();
	const [
		openSidebarMetaGroups,
		toggleSidebarMetaGroup,
		ensureSidebarMetaGroup,
	] = useToggleSet(["External Facing", "Internal Facing"]);

	const navigateTo = (nextTab, epId = null, pageId = null) =>
	{
		if (nextTab !== tab) switchTab(nextTab);
		setActiveEpId(epId);
		setActivePageId(pageId);
		if (epId)
		{
			const ep = ENDPOINTS.find((e) => e.id === epId);
			if (ep?.group) ensureSidebarGroup(ep.group);
			if (ep) ensureSidebarMetaGroup(ep.internal ? "Internal Facing" : "External Facing");
		}
		if (pageId)
		{
			const page = PAGES.find((p) => p.id === pageId);
			if (page?.group) ensureSidebarGroup(page.group);
		}
	};

	const isEps = tab === "endpoints";
	const activeId = isEps ? activeEpId : activePageId;
	const q = search.toLowerCase();

	const sidebarItems = isEps
		? ENDPOINTS.filter((ep) => !q || ep.route.toLowerCase().includes(q))
		: PAGES.filter(
			(p) =>
				!q ||
					p.name.toLowerCase().includes(q) ||
					p.path.toLowerCase().includes(q),
		);

	const sidebarMetaGroups = isEps
		? [
			["External Facing", groupBy(sidebarItems.filter((ep) => !ep.internal))],
			["Internal Facing", groupBy(sidebarItems.filter((ep) => ep.internal))],
		]
		: [["", groupBy(sidebarItems)]];

	// Used by both the sidebar and main-content tab-view wrappers below —
	// same value either way, so compute it once rather than twice.
	const tabViewClass = `tab-view tab-view--${prevTab === "endpoints" ? "from-left" : "from-right"}`;

	return (
		<div className="layout">
			{/* SIDEBAR */}
			<div className="sidebar-no-auto-css">
				<div className="sidebar-head">
					<div className="wordmark">Vigil</div>
					<div className="tagline">Technical Spec</div>
				</div>

				<div className="tab-row">
					{["endpoints", "pages"].map((t) =>
					{
						const tabBtnClass = `tab-btn${tab === t ? " active" : ""}`;
						return (
							<button
								key={t}
								className={tabBtnClass}
								onClick={() => switchTab(t)}
							>
								{t.charAt(0).toUpperCase() + t.slice(1)}
							</button>
						);
					})}
				</div>

				<div className="sidebar-search">
					<input
						className="search-input"
						placeholder={isEps ? "filter routes…" : "filter pages…"}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>

				<div className="sidebar-list">
					<div
						key={animKey}
						className={tabViewClass}
					>
						{sidebarMetaGroups.map(([meta, subGroups]) => (
							<div key={meta}>
								{meta && (
									<SidebarMetaHeader
										label={meta}
										open={openSidebarMetaGroups.has(meta)}
								 onToggle={() => toggleSidebarMetaGroup(meta)}
									/>
								)}
								{(!meta || openSidebarMetaGroups.has(meta)) &&
									[...subGroups].map(([group, items]) =>
									{
										const groupCollapsibleClass = `collapsible${openSidebarGroups.has(group) ? " collapsible--open" : ""}`;
										return (
											<div key={group}>
												<SidebarGroupHeader
													label={group}
													count={items.length}
											 open={openSidebarGroups.has(group)}
													onToggle={() => toggleSidebarGroup(group)}
												/>
												<div
													className={groupCollapsibleClass}
												>
													<div className="collapsible-inner">
														{items.map((item) => (
															<SidebarItem
																key={item.id}
																item={item}
																isActive={activeId === item.id}
																isEndpoint={isEps}
																onClick={() =>
																	isEps
																		? navigateTo("endpoints", item.id)
																		: navigateTo("pages", null, item.id)
													 }
															/>
														))}
													</div>
												</div>
											</div>
										);
									})}
							</div>
						))}
					</div>
				</div>
				<div className="sidebar-footer">
					<span>{ENDPOINTS.length} endpoints</span>
					<span>{PAGES.length} pages</span>
				</div>
			</div>

			{/* MAIN CONTENT */}
			<div className="main">
				<div
					key={animKey}
					className={tabViewClass}
				>
					{isEps ? (
						<EndpointsView highlightId={activeEpId} />
					) : (
						<PagesView
							highlightPageId={activePageId}
							highlightEndpointId={activeEpId}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

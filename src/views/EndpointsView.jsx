import { useState, useEffect } from "react";
import { ENDPOINTS } from "../data";
import { isPhone } from "../utils/device.js";
import useOpenState from "../hooks/useOpenState.js";
import { HotkeyScope } from "../hooks/HotkeyScope";
import MetaGroupSection from "../components/MetaGroupSection.jsx";
import SecurityLayer from "../components/SecurityLayer.jsx";

/**
 * EndpointsView displays all endpoints grouped by visibility and logical groups.
 */
export default function EndpointsView({ highlightId })
{
	// Registry for all open/closed state — endpoint cards, payload sections,
	// used-by toggles, and nested page cards inside used-by lists.
	const [
	   openKeys,
	   isOpenState,
	   toggleOpenState,
	   ,
	   collapseMatching
	] = useOpenState();

	const initialGroup = highlightId
		? ENDPOINTS.find((e) => e.id === highlightId)?.group
		: null;
	const [openGroups, , toggleGroup, ensureGroup, collapseGroups] = useOpenState(
		initialGroup ? [initialGroup] : []
	);
	const [
	   openMetaGroups,
	   ,
	   toggleMetaGroup,
	   ensureMetaGroup,
	   collapseMetaGroups
	] = useOpenState([
		"External Facing",
		"Internal Facing",
	]);
	const [secOpen, setSecOpen] = useState(true);

	// --- Global collapse shortcuts ---------------------------------------
	// Esc            - "step" collapse: closes every currently-open item at
	//                   the deepest open level, then walks up one level per
	//                   press (payload frames -> card attrs -> cards ->
	//                   groups -> meta groups -> security layer).
	// Shift+Esc      - collapses absolutely everything in one press.
	//
	// Depth model: meta groups and the security layer sit at depth 0, groups
	// at depth 1, and every openKeys entry at depth (1 + colon count) — since
	// every child key in this codebase is built as `parentKey + ":" + suffix`,
	// colon count already encodes nesting depth, so no separate bookkeeping
	// is needed to know how deep a given key lives. Because we always act on
	// *every* item sharing the current max depth (not just one), this also
	// covers multiple things open at the same level across different groups
	// or meta groups in a single press.
	function collectOpenItems()
	{
		const items = [];
		if (secOpen) items.push({ type: "sec", depth: 0 });
		for (const key of openMetaGroups) items.push({ type: "meta", key, depth: 0 });
		for (const key of openGroups) items.push({ type: "group", key, depth: 1 });
		for (const key of openKeys)
		{
			const depth = 1 + (key.split(":").length - 1);
			items.push({ type: "key", key, depth });
		}
		return items;
	}

	function collapseStep()
	{
		const items = collectOpenItems();
		if (items.length === 0) return;
		const maxDepth = Math.max(...items.map((i) => i.depth));
		const atMax = items.filter((i) => i.depth === maxDepth);

		if (atMax.some((i) => i.type === "sec")) setSecOpen(false);
		const metaKeys = new Set(atMax.filter((i) => i.type === "meta").map((i) => i.key));
		if (metaKeys.size) collapseMetaGroups((k) => metaKeys.has(k));
		const groupKeys = new Set(atMax.filter((i) => i.type === "group").map((i) => i.key));
		if (groupKeys.size) collapseGroups((k) => groupKeys.has(k));
		const plainKeys = new Set(atMax.filter((i) => i.type === "key").map((i) => i.key));
		if (plainKeys.size) collapseMatching((k) => plainKeys.has(k));
	}

	function collapseAll()
	{
		setSecOpen(false);
		collapseMetaGroups(() => true);
		collapseGroups(() => true);
		collapseMatching(() => true);
	}

	useEffect(() =>
	{
		if (isPhone) return;
		function handleKeyDown(e)
		{
			if (e.key !== "Escape") return;
			const tag = document.activeElement?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;
			e.preventDefault();
			if (e.shiftKey) collapseAll();
			else collapseStep();
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [openKeys, openGroups, openMetaGroups, secOpen]);

	const external = ENDPOINTS.filter((ep) => !ep.internal);
	const internal = ENDPOINTS.filter((ep) => ep.internal);

	const metaGroups =
	[
		["External Facing", external],
		["Internal Facing", internal],
	];

	useEffect(() =>
	{
		if (!highlightId) return;
		const ep = ENDPOINTS.find((e) => e.id === highlightId);
		if (ep?.group) ensureGroup(ep.group);
		if (ep) ensureMetaGroup(ep.internal ? "Internal Facing" : "External Facing");

		const t = setTimeout(() =>
		{
			toggleOpenState("ep:" + highlightId);
			// Wait for the collapsible's max-height transition to finish before
			// measuring — mid-animation the card height is wrong (max-height: 9999px
			// animating down to actual content height).
			const el = document.getElementById(highlightId);
			const scroller = document.querySelector(".main");
			if (!el || !scroller) return;
			const collapsible = el.querySelector(".collapsible");
			const doScroll = () =>
			{
				const pad        = 32;
				const rect       = el.getBoundingClientRect();
				const scrollRect = scroller.getBoundingClientRect();
				const elTop      = rect.top    - scrollRect.top;
				const elBottom   = rect.bottom - scrollRect.top;
				const viewHeight = scroller.clientHeight;
				if (elTop < pad)
					scroller.scrollBy({ top: elTop - pad, behavior: "smooth" });
				else if (elBottom > viewHeight - pad)
					scroller.scrollBy({
					   top: elBottom - viewHeight + pad,
					   behavior: "smooth"
					});
			};
			if (collapsible)
			{
				// max-height animates to 9999px so transitionend fires at the end
				// of the full duration regardless of actual content height.
				// Instead, poll via rAF until scrollHeight stops growing.
				let lastH = 0;
				const poll = () =>
				{
					const h = collapsible.scrollHeight;
					if (h === lastH)
					{
						doScroll(); return;
					}
					lastH = h;
					requestAnimationFrame(poll);
				};
				requestAnimationFrame(poll);
			}
			else doScroll();
		}, 0);
		return () => clearTimeout(t);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [highlightId]);

	return (
		<div>
			<div className="panel-title">Endpoints</div>
			<div className="panel-sub">
				{ENDPOINTS.length} total across all services
				{!isPhone && (
					<span className="panel-sub-shortcuts">
						<kbd>Esc</kbd> collapse one level · <kbd>Shift</kbd>+<kbd>Esc</kbd> collapse all · <kbd>1</kbd>-<kbd>9</kbd> collapse item
					</span>
				)}
			</div>

			<HotkeyScope>
				{/* Infrastructure Security Layer, applies to ALL endpoints */}
				<SecurityLayer open={secOpen} onToggle={() => setSecOpen((o) => !o)} />

				{metaGroups.map(([meta, eps]) =>
				{
					const isMetaOpen = openMetaGroups.has(meta);
					return (
						<MetaGroupSection
							key={meta}
							meta={meta}
							eps={eps}
							isOpen={isMetaOpen}
							onToggle={() => toggleMetaGroup(meta)}
							openGroups={openGroups}
							toggleGroup={toggleGroup}
							isOpenState={isOpenState}
							toggleOpenState={toggleOpenState}
							openKeys={openKeys}
							collapseMatching={collapseMatching}
							highlightId={highlightId}
						/>
					);
				})}
			</HotkeyScope>
		</div>
	);
}

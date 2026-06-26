import { useCallback, useMemo } from "react";
import useBorderSpotlight from "../hooks/useBorderSpotlight.js";
import GroupHeader from "./ui/GroupHeader.jsx";
import { EndpointCard } from "./EndpointComponents.jsx";

/**
 * GroupSection - A group section with border spotlight for the Endpoints view.
 *
 * Each EndpointCard's openKey is "ep:" + ep.id — unique per endpoint globally,
 * so belongsToGroup can match by id substring across all nesting depths
 * (payload sections, used-by toggles, nested page cards).
 *
 * Collapse-all button: wipes every open registry key that belongs to any
 * endpoint in this group, collapsing payloads, used-by sections, and nested
 * page cards in one state update. Only shown once at least 2 of those keys
 * are actually open — with 0 or 1 expanded there's nothing meaningful to
 * collapse "all" of.
 */
export default function GroupSection({
	group,
	groupEps,
	openGroups,
	toggleGroup,
	isOpenState,
	toggleOpenState,
	openKeys,
	collapseMatching,
	highlightId,
})
{
	const isCollapsed = !openGroups.has(group);
	const ref = useBorderSpotlight(isCollapsed);

	// A key belongs to this group if it contains any endpoint id from the group.
	// epIds/belongsToGroup are memoized so they only get a new identity when
	// groupEps itself actually changes — otherwise a plain function here would
	// be a new reference every render, and including it as a useMemo/useCallback
	// dependency below would defeat the memoization entirely.
	const epIds = useMemo(() => groupEps.map((ep) => ep.id), [groupEps]);
	const belongsToGroup = useCallback(
		(key) => epIds.some((id) => key.includes(id)),
		[epIds],
	);

	const openCount = useMemo(
		() => [...openKeys].filter(belongsToGroup).length,
		[openKeys, belongsToGroup],
	);

	function handleCollapseAll()
	{
		collapseMatching(belongsToGroup);
	}

	// Single source of truth for "click to toggle": fires for clicks on the
	// legend (header), the wrapper's own padding (the area that used to be
	// the fieldset's padding before it moved to `.group-section-wrap`), or
	// directly on the bare fieldset (the spotlight border itself is a
	// pointer-events:none clone, so a click there falls through to this
	// fieldset underneath it). Deliberately a WHITELIST rather than
	// excluding `.collapsible`: nested content can have its own
	// headers/toggles that live outside their own `.collapsible` wrapper
	// (e.g. a page card's header), and those would wrongly bubble into a
	// group toggle under a blacklist approach.
	function handleFieldsetClick(e)
	{
		if (e.target.closest(".group-hd-collapse-btn")) return;
		if (
			e.target === e.currentTarget ||
			e.target.classList.contains("group-section") ||
			e.target.closest(".group-hd")
		)
		{
			// When collapsing the group, also collapse all open sections
			// inside it — same action as the "Collapse all" button — so
			// re-opening the group starts clean rather than restoring
			// whatever was left expanded before.
			if (!isCollapsed) handleCollapseAll();
			toggleGroup(group);
		}
	}

	return (
		<div className="group-section-wrap" onClick={handleFieldsetClick}>
			<fieldset ref={ref} className="group-section" key={group}>
				<GroupHeader
					label={group}
					count={groupEps.length}
					collapsed={isCollapsed}
					onCollapseAll={handleCollapseAll}
					collapseAllActive={!isCollapsed && openCount >= 2}
				/>
				<div className={"collapsible" + (!isCollapsed ? " collapsible--open" : "")}>
					<div className="collapsible-inner">
						{groupEps.map((ep) => (
							<EndpointCard
								key={ep.id}
								ep={ep}
								openKey={"ep:" + ep.id}
								isOpenState={isOpenState}
								toggleOpenState={toggleOpenState}
								highlighted={highlightId === ep.id}
								openKeys={openKeys}
								collapseMatching={collapseMatching}
							/>
						))}
					</div>
				</div>
			</fieldset>
		</div>
	);
}

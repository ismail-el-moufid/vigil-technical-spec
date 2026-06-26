import { useCallback, useMemo } from "react";
import useBorderSpotlight from "../hooks/useBorderSpotlight.js";
import GroupHeader from "./ui/GroupHeader.jsx";
import { PageCard } from "./EndpointComponents.jsx";

/**
 * PagesGroupSection - A group section with border spotlight for pages view.
 *
 * Collapse-all button: clears the single-select `open` page if it belongs
 * to this group, then calls collapseMatching to wipe every open registry
 * key that contains any of this group's page ids — endpoints, payloads,
 * used-by sections, and nested page cards all collapse in one go. Only
 * shown once at least 2 collapsibles (the open page plus registry keys)
 * are actually expanded — with 0 or 1 there's nothing meaningful to
 * collapse "all" of.
 */
export default function PagesGroupSection({
	group,
	pages,
	openGroups,
	toggleGroup,
	open,
	setOpen,
	isOpenState,
	toggleOpenState,
	openKeys,
	collapseMatching,
	highlightEndpointId,
})
{
	const isCollapsed = !openGroups.has(group);
	const ref = useBorderSpotlight(isCollapsed);

	// A key "belongs to this group" if it contains any page id from this group.
	// Because all registry keys start with or include the originating page id,
	// this catches endpoint cards, payload sections, usedby toggles, and nested
	// used-by page cards at any depth. pageIds/belongsToGroup are memoized so
	// they only get a new identity when `pages` itself actually changes —
	// otherwise a plain function here would be a new reference every render,
	// and including it as a dependency below would defeat the memoization.
	const pageIds = useMemo(() => pages.map((p) => p.id), [pages]);
	const belongsToGroup = useCallback(
		(key) => pageIds.some((id) => key.includes(id)),
		[pageIds],
	);

	const openCount = useMemo(
		() =>
			(pageIds.includes(open) ? 1 : 0) +
			[...openKeys].filter(belongsToGroup).length,
		[openKeys, open, pageIds, belongsToGroup],
	);

	function handleCollapseAll()
	{
		if (pageIds.includes(open)) setOpen(null);
		collapseMatching(belongsToGroup);
	}

	// See GroupSection.jsx for why this is a whitelist (legend, wrapper
	// padding, or bare fieldset only) rather than a blacklist on
	// `.collapsible` — nested page cards have their own headers that live
	// outside their own `.collapsible`, and a blacklist would let those
	// wrongly bubble into a group toggle.
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
			<fieldset ref={ref} className="group-section">
				<GroupHeader
					label={group}
					count={pages.length}
					collapsed={isCollapsed}
					onCollapseAll={handleCollapseAll}
					collapseAllActive={!isCollapsed && openCount >= 2}
				/>
				{!isCollapsed &&
				pages.map((page) =>
				{
					const isPageOpen = open === page.id;
					return (
						<PageCard
							key={page.id}
							page={page}
							isOpen={isPageOpen}
							onToggle={() => setOpen(isPageOpen ? null : page.id)}
							keyPrefix={"page:" + page.id}
							isOpenState={isOpenState}
							toggleOpenState={toggleOpenState}
							highlightEndpointId={highlightEndpointId}
							openKeys={openKeys}
							collapseMatching={collapseMatching}
						/>
					);
				})}
			</fieldset>
		</div>
	);
}

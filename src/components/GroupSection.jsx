import { useCallback, useMemo, useRef, useState } from "react";
import useBorderSpotlight from "../hooks/useBorderSpotlight.js";
import { useCollapseHotkey } from "../hooks/useCollapseHotkey";
import GroupHeader from "./ui/GroupHeader.jsx";

/**
 * GroupSection - Generic group section with border spotlight.
 *
 * `items` is an array of objects with `.id` — used to compute belongsToGroup.
 * `children` is the rendered content inside the collapsible.
 *
 * Optional pages-specific props:
 *   extraOpenCount  - added to openCount (e.g. 1 when the single-select page is open)
 *   onCollapseExtra - called during collapseAll (e.g. setOpen(null))
 *
 * Children are lazy-mounted: nothing renders inside the collapsible until the
 * group is first expanded. Once mounted they stay in the DOM so subsequent
 * collapse/expand transitions animate normally. This keeps the fieldset DOM
 * trivially small on mount, which makes useBorderSpotlight's cloneNode(true)
 * cheap and prevents the view-switch lag that occurs when all groups mount
 * simultaneously.
 */
export default function GroupSection({
	group,
	items,
	openGroups,
	toggleGroup,
	openKeys,
	collapseMatching,
	extraOpenCount = 0,
	onCollapseExtra,
	children,
})
{
	const isCollapsed = !openGroups.has(group);
	const ref = useBorderSpotlight(isCollapsed);
	const hdRef = useRef(null);

	// Once true, stays true — children enter the DOM on first expand and
	// never leave, so the collapsible animation works on all subsequent toggles.
	const [hasOpened, setHasOpened] = useState(!isCollapsed);
	if (!hasOpened && !isCollapsed) setHasOpened(true);

	const ids = useMemo(() => items.map((item) => item.id), [items]);
	const belongsToGroup = useCallback(
		(key) => ids.some((id) => key.includes(id)),
		[ids],
	);

	const openCount = useMemo(
		() => extraOpenCount + [...openKeys].filter(belongsToGroup).length,
		[openKeys, belongsToGroup, extraOpenCount],
	);

	const collapseAllActive = !isCollapsed && openCount >= 2;

	function handleCollapseAll()
	{
		onCollapseExtra?.();
		collapseMatching(belongsToGroup);
	}

	// Hotkey collapse mirrors click-to-toggle: closing a group also collapses
	// everything nested inside it first, same as handleFieldsetClick below.
	function handleHotkeyCollapse()
	{
		handleCollapseAll();
		toggleGroup(group);
	}
	const hotkeyNumber = useCollapseHotkey(!isCollapsed, handleHotkeyCollapse);

	// Single source of truth for "click to toggle": fires for clicks on the
	// legend (header), the wrapper's own padding, or directly on the bare
	// fieldset. Deliberately a WHITELIST rather than excluding `.collapsible`:
	// nested content can have its own headers/toggles that live outside their
	// own `.collapsible` wrapper, and those would wrongly bubble into a group
	// toggle under a blacklist approach.
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
		<div className={"group-section-wrap" + (isCollapsed ? " group-section-wrap--collapsed" : "")} onClick={handleFieldsetClick}>
			<fieldset ref={ref} className="group-section" key={group}>
				<GroupHeader
					label={group}
					count={items.length}
					collapsed={isCollapsed}
					onCollapseAll={handleCollapseAll}
					collapseAllActive={collapseAllActive}
					hdRef={hdRef}
					hotkeyNumber={hotkeyNumber}
				/>
				<div className={"collapsible" + (!isCollapsed ? " collapsible--open" : "")}>
					<div className="collapsible-inner">
						{hasOpened && children}
					</div>
				</div>
			</fieldset>
		</div>
	);
}

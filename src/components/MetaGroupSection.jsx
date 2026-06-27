import { useCallback, useMemo } from "react";
import useBorderSpotlight from "../hooks/useBorderSpotlight.js";
import groupBy from "../utils/groupBy.js";
import GroupHeader from "./ui/GroupHeader.jsx";
import GroupSection from "./GroupSection.jsx";
import { EndpointCard } from "./EndpointComponents.jsx";

/**
 * MetaGroupSection - A meta group section with border spotlight.
 * Pure pass-through: forwards registry props down to GroupSection.
 */
export default function MetaGroupSection({
	meta,
	eps,
	isOpen,
	onToggle,
	openGroups,
	toggleGroup,
	isOpenState,
	toggleOpenState,
	openKeys,
	collapseMatching,
	highlightId,
})
{
	const ref = useBorderSpotlight(!isOpen);
	const subGroups = groupBy(eps);

	// A key belongs to this meta group if it contains any endpoint id from eps.
	const epIds = useMemo(() => eps.map((ep) => ep.id), [eps]);
	const belongsToMeta = useCallback(
		(key) => epIds.some((id) => key.includes(id)),
		[epIds],
	);

	// The groups (GroupSection) inside this meta group, derived from eps.
	const groupNames = useMemo(
		() => [...new Set(eps.map((ep) => ep.group))],
		[eps],
	);

	// Count open keys (endpoint sub-sections) + open groups belonging to this meta.
	const openKeyCount = useMemo(
		() => [...openKeys].filter(belongsToMeta).length,
		[openKeys, belongsToMeta],
	);
	const openGroupCount = useMemo(
		() => groupNames.filter((g) => openGroups.has(g)).length,
		[groupNames, openGroups],
	);
	const openCount = openKeyCount + openGroupCount;

	function handleCollapseAll()
	{
		// Collapse all open keys (endpoint cards, payload sections, etc.)
		collapseMatching(belongsToMeta);
		// Also collapse any open groups within this meta group.
		groupNames.forEach((g) =>
		{
			if (openGroups.has(g)) toggleGroup(g);
		});
	}

	// Whitelist: legend (header), the wrapper's own padding, or the bare
	// fieldset (border) only — see GroupSection.jsx for why a blacklist on
	// `.collapsible` isn't safe here.
	function handleFieldsetClick(e)
	{
		if (e.target.closest(".group-hd-collapse-btn")) return;
		if (
			e.target === e.currentTarget ||
			e.target.classList.contains("meta-group") ||
			e.target.closest(".meta-group-hd")
		)
		{
			if (isOpen) handleCollapseAll();
			onToggle();
		}
	}

	return (
		<div className="meta-group-wrap" onClick={handleFieldsetClick}>
			<fieldset ref={ref} className="meta-group">
				<GroupHeader
					variant="meta"
					label={meta}
					count={eps.length}
					collapsed={!isOpen}
					onCollapseAll={handleCollapseAll}
					collapseAllActive={isOpen && openCount >= 2}
				/>
				<div className={"collapsible" + (isOpen ? " collapsible--open" : "")}>
					<div className="collapsible-inner">
						{[...subGroups].map(([group, groupEps]) => (
							<GroupSection
								key={group}
								group={group}
								items={groupEps}
								openGroups={openGroups}
								toggleGroup={toggleGroup}
								openKeys={openKeys}
								collapseMatching={collapseMatching}
							>
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
							</GroupSection>
						))}
					</div>
				</div>
			</fieldset>
		</div>
	);
}

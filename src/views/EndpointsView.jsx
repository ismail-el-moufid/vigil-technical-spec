import { useState, useEffect } from "react";
import { ENDPOINTS } from "../data";
import useToggleSet from "../hooks/useToggleSet.js";
import useOpenState from "../hooks/useOpenState.js";
import MetaGroupSection from "../components/MetaGroupSection.jsx";
import SecurityLayer from "../components/SecurityLayer.jsx";
import StatChip from "../components/ui/StatChip.jsx";

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
	   collapseMatching
	] = useOpenState();

	const initialGroup = highlightId
		? ENDPOINTS.find((e) => e.id === highlightId)?.group
		: null;
	const [openGroups, toggleGroup, ensureGroup] = useToggleSet(
		initialGroup ? [initialGroup] : []
	);
	const [openMetaGroups, toggleMetaGroup, ensureMetaGroup] = useToggleSet([
		"External Facing",
		"Internal Facing",
	]);
	const [secOpen, setSecOpen] = useState(true);

	const external = ENDPOINTS.filter((ep) => !ep.internal);
	const internal = ENDPOINTS.filter((ep) => ep.internal);

	const metaGroups =
	[
		["External Facing", external],
		["Internal Facing", internal],
	];

	useEffect(() =>
	{
		if (highlightId)
		{
			// Open the highlighted endpoint card in the registry
			const epKey = "ep:" + highlightId;
			if (!isOpenState(epKey)) toggleOpenState(epKey);

			const ep = ENDPOINTS.find((e) => e.id === highlightId);
			if (ep?.group) ensureGroup(ep.group);
			if (ep) ensureMetaGroup(ep.internal ? "Internal Facing" : "External Facing");
		}
	}, [highlightId, ensureGroup, ensureMetaGroup, isOpenState, toggleOpenState]);

	return (
		<div>
			<div className="panel-title">Endpoints</div>
			<div className="panel-sub">
				{ENDPOINTS.length} total across all services
			</div>

			<div className="stat-row">
				<StatChip
					num={ENDPOINTS.length}
					label="Total"
					colorClass="color--get"
				/>
				<StatChip
					num={external.length}
					label="External"
					colorClass="color--ext"
				/>
				<StatChip
					num={internal.length}
					label="Internal"
					colorClass="color--int"
				/>
			</div>

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
		</div>
	);
}

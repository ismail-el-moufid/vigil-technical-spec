import { useState, useEffect } from "react";
import { ENDPOINTS } from "../data";
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
	   ,
	   collapseMatching
	] = useOpenState();

	const initialGroup = highlightId
		? ENDPOINTS.find((e) => e.id === highlightId)?.group
		: null;
	const [openGroups, , toggleGroup, ensureGroup] = useOpenState(
		initialGroup ? [initialGroup] : []
	);
	const [openMetaGroups, , toggleMetaGroup, ensureMetaGroup] = useOpenState([
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

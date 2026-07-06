/**
 * GroupHeader — unified collapsible header for both regular groups and meta
 * groups (visibility sections).
 *
 * `variant="group"` (default) renders the standard group header class set.
 * `variant="meta"` renders the meta-group class set and adds the color dot.
 *
 * No click-to-toggle handlers live here. The containing wrapper div (see
 * GroupSection / MetaGroupSection) owns a single WHITELIST click handler
 * covering this legend, the wrapper's own padding, and the synthetic
 * spotlight border — instead of three separate handlers that could drift.
 * `.group-hd-collapse-btn` is explicitly excluded from that whitelist so
 * the collapse-all button never accidentally fires the toggle too.
 */
import CollapseToggle from "./CollapseToggle.jsx";

export default function GroupHeader({
	label,
	count,
	collapsed,
	onCollapseAll,
	collapseAllActive,
	hdRef,
	variant = "group",
	hotkeyNumber,
})
{
	const isMeta = variant === "meta";

	return (
		<legend
			ref={hdRef}
			className={isMeta
				? "meta-group-hd meta-group-hd--" + label.toLowerCase()
				: "group-hd"}
		>
			{isMeta && <span className={label.toLowerCase()} />}
			<span className={isMeta ? "meta-group-label-wrap" : "group-hd-label-wrap"}>
				<span className={isMeta ? "meta-group-label" : "group-hd-label"}>{label}</span>
				<span className={isMeta ? "meta-group-count" : "group-hd-count"}>{count}</span>
			</span>
			<CollapseToggle
				collapsed={collapsed}
				hotkeyNumber={hotkeyNumber}
				className={isMeta ? "meta-group-toggle" : "group-hd-toggle"}
			/>
			<button
				type="button"
				className="group-hd-collapse-btn"
				onClick={onCollapseAll}
				disabled={!collapseAllActive}
				title="Collapse all"
			>
				Collapse all
			</button>
		</legend>
	);
}

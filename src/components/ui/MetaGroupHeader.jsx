/**
 * MetaGroupHeader displays a collapsible meta group header for visibility sections.
 *
 * No onClick here — the containing wrapper div (see MetaGroupSection) owns a
 * single click handler covering this legend, the wrapper's own padding, AND
 * the synthetic spotlight border, the same pattern used by
 * GroupHeader/GroupSection.
 */

export default function MetaGroupHeader({
	label,
	count,
	collapsed,
	onCollapseAll,
	collapseAllActive,
})
{
	return (
		<legend className={"meta-group-hd meta-group-hd--" + label.toLowerCase()}>
			<span className={label.toLowerCase()} />
			<span className="meta-group-label-wrap">
				<span className="meta-group-label">{label}</span>
				<span className="meta-group-count">{count}</span>
			</span>
			<span className="meta-group-toggle">
				{collapsed ? "→" : "↓"}
			</span>
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

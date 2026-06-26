/**
 * StatChip displays a statistic with a number and label.
 */
export default function StatChip({ colorClass, num, label, labelClass })
{
	const numClass = `stat-chip-num ${colorClass || ""}`;
	const labelClassName = `stat-chip-label ${labelClass || ""}`;
	return (
		<div className="stat-chip">
			<span className={numClass}>{num}</span>
			<span className={labelClassName}>{label}</span>
		</div>
	);
}

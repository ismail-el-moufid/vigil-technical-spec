import { SCHEMA } from "../data/schema.js";

function ColumnRow({ col })
{
	return (
		<div className="schema-col-row">
			<span className="schema-col-name">{col.name}</span>
			<span className="schema-col-type">{col.type}</span>
			<span className="schema-col-flags">
				{col.nullable === true
					? <span className="schema-flag schema-flag--null">NULL</span>
					: col.pk
						? null
						: <span className="schema-flag schema-flag--notnull">NOT NULL</span>
				}
				{col.unique && <span className="schema-flag schema-flag--unique">UNIQUE</span>}
				{col.pk     && <span className="schema-flag schema-flag--pk">PK</span>}
				{col.fk && (
					<span className="schema-flag schema-flag--fk">
						FK → {col.fk.table}.{col.fk.column}
					</span>
				)}
			</span>
			{col.notes && (
				<span className="schema-col-notes">{col.notes}</span>
			)}
		</div>
	);
}

function parseActions(tables, actionsStr)
{
	if (!actionsStr || actionsStr === "None" || tables.length === 0) return {};
	const parts = actionsStr.split(/[,+]/).map((s) => s.trim()).filter(Boolean);
	if (parts.length === tables.length)
		return Object.fromEntries(tables.map((t, i) => [t, parts[i]]));
	if (parts.length === 1)
		return Object.fromEntries(tables.map((t) => [t, parts[0]]));
	return {};
}

// Single-open. Only the active panel is in the DOM; key={openName} causes
// React to remount it on switch, re-triggering the CSS entry animation so
// the new panel fades in cleanly rather than sliding up from below the old one.
export default function TablesRow({
	ep,
	openKey,
	isOpenState,
	toggleOpenState,
	collapseMatching
})
{
	if (!ep.tables || ep.tables.length === 0) return null;

	const actionMap = parseActions(ep.tables, ep.tables_actions);
	const openName  = ep.tables.find((name) => isOpenState(openKey + ":table:" + name)) ?? null;

	function handleTableClick(pillKey)
	{
		const clickedName    = pillKey.slice((openKey + ":table:").length);
		const switchingToNew = openName !== null && openName !== clickedName;
		if (switchingToNew) collapseMatching((k) => k.startsWith(openKey + ":table:"));
		toggleOpenState(pillKey);
	}

	return (
		<>
			<span className="meta-label meta-label--auth">Tables</span>
			<span className="meta-value meta-value--auth schema-tables-value">
				{ep.tables.map((name) =>
				{
					const isOpen  = openName === name;
					const pillKey = openKey + ":table:" + name;
					return (
						<button
							key={name}
							className={"auth-strat-pill schema-table-pill" + (isOpen ? " auth-strat-pill--open" : "")}
							onClick={() => handleTableClick(pillKey)}
						>
							{name}
							{actionMap[name] && <span className="schema-table-action">{actionMap[name]}</span>}
							<span className="auth-strat-pill-chevron">{isOpen ? "▲" : "▼"}</span>
						</button>
					);
				})}
			</span>

			{/* Wrapper always occupies the full-width grid slot.               */}
			{/* key={openName} remounts the inner div on switch → fresh         */}
			{/* CSS entry animation, no "new panel below old" movement.         */}
			<div style={{ gridColumn: "1 / -1" }}>
				{openName && (
					<div key={openName} className="schema-panel schema-panel--animate">
						{SCHEMA[openName] ? (
							<>
								<div className="schema-panel-label">
									{SCHEMA[openName].db} · {SCHEMA[openName].columns.length} columns
									{SCHEMA[openName].notes && (
										<span className="schema-table-note"> · {SCHEMA[openName].notes}</span>
									)}
								</div>
								{SCHEMA[openName].columns.map((col) => (
									<ColumnRow key={col.name} col={col} />
								))}
							</>
						) : (
							<div className="schema-panel-label">No schema defined for "{openName}"</div>
						)}
					</div>
				)}
			</div>
		</>
	);
}

import { SCHEMA } from "../data/schema.js";
import RefText from "./ui/RefText.jsx";

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
				<span className="schema-col-notes"><RefText value={col.notes} /></span>
			)}
		</div>
	);
}

// tables_actions is now a per-table object ({ tableName: "action text" }),
// not a positional comma/plus-separated string — so there's no ambiguity
// about which action belongs to which table, and no risk of the mapping
// silently breaking when an action needs more than one word (e.g. "Read +
// Insert" on a single table, or a multi-clause description spanning several
// tables). Tolerates a missing entry for a given table (renders no action
// tag for it) rather than throwing.
function actionsFor(tablesActions)
{
	if (!tablesActions || typeof tablesActions !== "object") return {};
	return tablesActions;
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

	const actionMap = actionsFor(ep.tables_actions);
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

import { ENDPOINTS, AUTH_STRATEGIES } from "../data";

const byId = new Map();

for (const ep of ENDPOINTS)
{
	byId.set(ep.id, { label: `${ep.method} ${ep.route}`, kind: "endpoint", data: ep });
}

for (const key of Object.keys(AUTH_STRATEGIES))
{
	const s = AUTH_STRATEGIES[key];
	byId.set(s.id, { label: s.tag, kind: "strategy", data: s });
}

// Reads a path like "items[1]" or "constraints.criteria[2]" off a resolved
// entry's underlying data object. Supports plain dot access and numeric
// bracket indices, nothing fancier — this only ever walks known, hand-built
// spec shapes (arrays of strings/objects), not arbitrary user input.
function getPath(obj, path)
{
	const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
	return parts.reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/**
 * Resolves a ref for RefText. `ref` is either a bare id (string) — the
 * legacy/common case, giving just a label to link to and jump toward — or
 * `{ id, field }`, which additionally pulls the actual referenced fact off
 * the underlying data by `field` and returns it as `fact` so RefText can
 * render that fact's real text inline, not just its identity.
 */
export function resolveRef(ref)
{
	const id = typeof ref === "string" ? ref : ref.id;
	const field = typeof ref === "string" ? null : ref.field;
	const entry = byId.get(id);

	if (!entry) return { id, label: id, kind: "unknown", fact: null };

	let fact = null;
	if (field)
	{
		const raw = getPath(entry.data, field);
		fact = typeof raw === "string" ? raw : (raw && typeof raw.text === "string" ? raw.text : null);
	}

	return { id, label: entry.label, kind: entry.kind, fact };
}

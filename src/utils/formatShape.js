// Pretty-prints the loose shorthand shape strings used for request/response
// (e.g. "{ id, preset, service: a | b, custom?: x }") with indentation and
// line breaks, WITHOUT rewriting the shorthand into strict JSON syntax.
// Structured objects and arrays are serialized before reaching React children.
// Respects nested {}/[]/'' so values like "status: acknowledged | resolved"
// or "my_ack: { status, acked_at } | null" stay intact.
export default function formatShape(str)
{
	if (typeof str !== "string") return JSON.stringify(str, null, "\t") ?? String(str);
	const trimmed = str.trim();
	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return trimmed;

	const splitTopLevel = (inner) =>
	{
		const parts = [];
		let depth = 0, inQuote = null, current = "";
		for (let i = 0; i < inner.length; i++)
		{
			const c = inner[i];
			if (inQuote)
			{
				current += c;
				if (c === inQuote) inQuote = null;
				continue;
			}
			if (c === "'" || c === '"')
			{
				inQuote = c; current += c; continue;
			}
			if (c === "{" || c === "[") depth++;
			if (c === "}" || c === "]") depth--;
			if (c === "," && depth === 0)
			{
				parts.push(current.trim()); current = ""; continue;
			}
			current += c;
		}
		if (current.trim()) parts.push(current.trim());
		return parts;
	};

	const topLevelColonIdx = (f) =>
	{
		let depth = 0, inQuote = null;
		for (let i = 0; i < f.length; i++)
		{
			const c = f[i];
			if (inQuote)
			{
				if (c === inQuote) inQuote = null; continue;
			}
			if (c === "'" || c === '"')
			{
				inQuote = c; continue;
			}
			if (c === "{" || c === "[") depth++;
			if (c === "}" || c === "]") depth--;
			if (c === ":" && depth === 0) return i;
		}
		return -1;
	};

	const findMatchingClose = (s) =>
	{
		let depth = 0, inQuote = null;
		for (let i = 0; i < s.length; i++)
		{
			const c = s[i];
			if (inQuote)
			{
				if (c === inQuote) inQuote = null; continue;
			}
			if (c === "'" || c === '"')
			{
				inQuote = c; continue;
			}
			if (c === "{" || c === "[") depth++;
			if (c === "}" || c === "]")
			{
				depth--; if (depth === 0) return i;
			}
		}
		return -1;
	};

	const renderBlock = (text, indent) =>
	{
		const t = text.trim();
		const pad = "\t".repeat(indent);
		const padIn = "\t".repeat(indent + 1);
		const open = t[0];
		const close = open === "{" ? "}" : "]";

		const closeIdx = findMatchingClose(t);
		const inner = t.slice(1, closeIdx).trim();
		const trailing = t.slice(closeIdx + 1).trim();

		const body = !inner
			? open + close
			: open + "\n" + splitTopLevel(inner).map((f) => padIn + renderField(f, indent + 1)).join(",\n") + "\n" + pad + close;

		return trailing ? body + " " + trailing : body;
	};

	const renderField = (f, indent) =>
	{
		const colonIdx = topLevelColonIdx(f);
		if (colonIdx === -1)
		{
			const ft = f.trim();
			if (ft.startsWith("{") || ft.startsWith("[")) return renderBlock(ft, indent);
			return ft;
		}
		const key = f.slice(0, colonIdx).trim();
		const val = f.slice(colonIdx + 1).trim();
		if (val.startsWith("{") || val.startsWith("["))
		{
			return key + ": " + renderBlock(val, indent);
		}
		return key + ": " + val;
	};

	try
	{
		return renderBlock(trimmed, 0);
	}
	catch
	{
		return trimmed;
	}
}

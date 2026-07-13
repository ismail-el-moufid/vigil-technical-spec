import { useState, useEffect, useRef, useMemo } from "react";
import { ENDPOINTS, PAGES } from "../data";
import Badge from "./ui/Badge.jsx";
import { isPhone } from "../utils/device.js";

function highlight(text, query)
{
	if (!query) return text;
	const idx = text.toLowerCase().indexOf(query.toLowerCase());
	if (idx === -1) return text;
	return (
		<>
			{text.slice(0, idx)}
			<mark className="pal-mark">{text.slice(idx, idx + query.length)}</mark>
			{text.slice(idx + query.length)}
		</>
	);
}

export default function CommandPalette({ open, onClose, onNavigate })
{
	const [query, setQuery] = useState("");
	// cursor is an index into results; clamp it during render so it is always valid
	const [cursor, setCursor] = useState(0);
	const inputRef = useRef(null);
	const listRef = useRef(null);

	// Focus the input when the palette opens — DOM side-effect only, no setState
	useEffect(() =>
	{
		if (open) inputRef.current?.focus();
	}, [open]);

	const results = useMemo(() =>
	{
		const q = query.trim().toLowerCase();
		const eps = ENDPOINTS
			.filter(ep => !q || ep.route.toLowerCase().includes(q) || ep.group?.toLowerCase().includes(q))
			.map(ep => ({
			   kind: "endpoint",
			   id: ep.id,
			   label: ep.route,
			   sub: ep.group,
			   method: ep.method,
			   internal: ep.internal
			}));
		const pages = PAGES
			.filter(p => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
			.map(p => ({ kind: "page", id: p.id, label: p.name, sub: p.path }));
		return [...eps, ...pages].slice(0, 12);
	}, [query]);

	// Derive a safe cursor: clamp to valid range during render, no effect needed
	const safeCursor = results.length === 0 ? 0 : Math.min(cursor, results.length - 1);

	// Scroll active item into view — DOM side-effect only, no setState
	useEffect(() =>
	{
		const el = listRef.current?.querySelector(`[data-idx="${safeCursor}"]`);
		el?.scrollIntoView({ block: "nearest" });
	}, [safeCursor]);

	function handleKey(e)
	{
		if (e.key === "ArrowDown")
		{
			e.preventDefault();
			setCursor(c => Math.min(c + 1, results.length - 1));
		}
		else if (e.key === "ArrowUp")
		{
			e.preventDefault();
			setCursor(c => Math.max(c - 1, 0));
		}
		else if (e.key === "Enter")
		{
			const r = results[safeCursor];
			if (r) commit(r);
		}
		else if (e.key === "Escape")
		{
			onClose();
		}
	}

	function handleQueryChange(e)
	{
		setQuery(e.target.value);
		setCursor(0);  // reset cursor on query change — in an event handler, always fine
	}

	function commit(r)
	{
		onNavigate(r.kind === "endpoint" ? "endpoints" : "pages", r.kind === "endpoint" ? r.id : null, r.kind === "page" ? r.id : null);
		setQuery("");  // reset query on commit — in an event handler, always fine
		setCursor(0);
		onClose();
	}

	if (!open) return null;

	return (
		<div className="pal-backdrop" onMouseDown={(e) =>
		{
			if (e.target === e.currentTarget) onClose();
		}}>
			<div className="pal-box">
				<div className="pal-input-row">
					<span className="pal-search-icon">⌕</span>
					<input
						ref={inputRef}
						className="pal-input"
						placeholder="Jump to endpoint or page…"
						value={query}
						onChange={handleQueryChange}
						onKeyDown={handleKey}
					/>
					{!isPhone && <kbd className="pal-esc-hint">esc</kbd>}
				</div>
				{results.length > 0 && (
					<div className="pal-list" ref={listRef}>
						{results.map((r, i) => (
							<div
								key={r.kind + r.id}
								data-idx={i}
								className={"pal-item" + (i === safeCursor ? " pal-item--active" : "")}
								onMouseEnter={() => setCursor(i)}
								onMouseDown={() => commit(r)}
							>
								{r.kind === "endpoint"
									? <>
										<Badge method={r.method} />
										<span className="pal-item-label">{highlight(r.label, query)}</span>
										<span className={"pal-item-tag " + (r.internal ? "color--int" : "color--ext")}>
											{r.internal ? "INT" : "EXT"}
										</span>
									</>
									: <>
										<span className="pal-page-icon">⬡</span>
										<span className="pal-item-label">{highlight(r.label, query)}</span>
										<span className="pal-item-sub">{r.sub}</span>
									</>
								}
							</div>
						))}
					</div>
				)}
				{results.length === 0 && query && (
					<div className="pal-empty">No results for <em>{query}</em></div>
				)}
				{!isPhone && (
					<div className="pal-footer">
						<span><kbd>↑↓</kbd> navigate</span>
						<span><kbd>↵</kbd> jump</span>
						<span><kbd>esc</kbd> close</span>
					</div>
				)}
			</div>
		</div>
	);
}

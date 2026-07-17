import { useEffect, useState } from "react";
import {
	FILTER_CHAIN,
	STARTUP_SEQUENCE,
	RATE_LIMITING_INFO,
	ROLE_ENFORCEMENT_INFO,
	AUTH_STRATEGIES,
} from "../data";
import RefText from "./ui/RefText.jsx";
import CollapseToggle from "./ui/CollapseToggle.jsx";
import { useCollapseHotkey } from "../hooks/useCollapseHotkey";

const STRATEGY_LIST = Object.values(AUTH_STRATEGIES);

/**
 * A single collapsible row shared by Rate Limiting, Role Enforcement, and
 * the Auth Strategy Catalog — same tag/label head, same collapsible item
 * list. `id` is only set for strategies, since those are the only entries a
 * RefText ref can jump to; rate/role rows are collapsed the same way but
 * aren't ref targets themselves.
 */
function CollapsibleEntry({ id, tag, tagType, label, items, open, onToggle, highlighted, renderItem })
{
	return (
		<div
			id={id}
			className={"gw-strategy-entry" + (highlighted ? " highlight-ring" : "")}
		>
			<div className="gw-strategy-head" onClick={onToggle}>
				<span className={"constraint-tag constraint-tag--" + tagType}>{tag}</span>
				<span className="constraint-text">{label}</span>
				<CollapseToggle collapsed={!open} className="ep-toggle" />
			</div>
			<div className={"collapsible" + (open ? " collapsible--open" : "")}>
				<div className="collapsible-inner">
					{items.map((item, i) => (
						<div className="gw-row-item" key={i}>
							<span className="gw-row-dot">·</span>
							<span className="constraint-text">
								{renderItem ? renderItem(item) : <RefText value={item} />}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

/**
 * SecurityReference merges the former InfraLayer + SecurityLayer cards into
 * one: startup sequence, filter chain, rate limiting, role enforcement, and
 * the full auth-strategy catalog. Mounted once at the App level (not per
 * tab) since all of this applies to every endpoint regardless of which tab
 * is active. Collapsed by default (and each Rate Limiting / Role
 * Enforcement / Auth Strategy row within it, once opened, starts collapsed
 * too) — this is reference material, not something that needs to compete
 * for space with the active tab on load.
 */
export default function SecurityReference({ open, onToggle, activeStratId })
{
	const hotkeyNumber = useCollapseHotkey(open, onToggle);
	const collapsibleClass = `collapsible${open ? " collapsible--open" : ""}`;
	const [openEntries, setOpenEntries] = useState(() => new Set());
	const [highlighted, setHighlighted] = useState(null);

	const toggleEntry = (id) => setOpenEntries((prev) =>
	{
		const next = new Set(prev);
		next.has(id) ? next.delete(id) : next.add(id);
		return next;
	});

	// External jump-to-strategy (from a RefText ref anywhere in the app):
	// open the whole card, open that one entry, scroll to it, flash it.
	useEffect(() =>
	{
		if (!activeStratId) return;
		const openTimer = setTimeout(() =>
		{
			if (!open) onToggle();
			setOpenEntries((prev) => new Set(prev).add(activeStratId));
		}, 0);
		const t = setTimeout(() =>
		{
			const el = document.getElementById(activeStratId);
			const scroller = document.querySelector(".main");
			if (el && scroller)
			{
				const pad = 32;
				const rect = el.getBoundingClientRect();
				const scrollRect = scroller.getBoundingClientRect();
				const elTop = rect.top - scrollRect.top;
				scroller.scrollBy({ top: elTop - pad, behavior: "smooth" });
			}
			setHighlighted(activeStratId);
			setTimeout(() => setHighlighted(null), 1200);
		}, 60);
		return () =>
		{
			clearTimeout(openTimer);
			clearTimeout(t);
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeStratId]);

	return (
		<div className={"security-layer" + (open ? " security-layer--open" : "")}>
			<div className="ep-card-header security-header" onClick={onToggle}>
				<span className="security-title">Security</span>
				<span className="ep-route security-subtitle">Startup · Spring Security · Bucket4j</span>
				<span className="security-expand-hint">{open ? "Collapse" : "Expand"}</span>
				<CollapseToggle collapsed={!open} hotkeyNumber={hotkeyNumber} className="ep-toggle security-toggle" />
			</div>
			<div className={collapsibleClass}>
				<div className="collapsible-inner ep-body">
					<div className="ep-meta-grid security-meta-grid">
						<span className="meta-label">Startup</span>
						<span className="meta-value meta-value--mono">
							{STARTUP_SEQUENCE.map((n) => n.label).join(" → ")}
						</span>
						<span className="meta-label">Filter Chain</span>
						<span className="meta-value meta-value--mono">
							{FILTER_CHAIN.map((n) => n.label).join(" → ")}
						</span>
					</div>
					<div className="startup-detail-list">
						{STARTUP_SEQUENCE.map((n) => (
							<div className="gw-row-item" key={n.tag}>
								<span className="gw-row-dot">·</span>
								<span className="constraint-text">{n.label}: <RefText value={n.sub} /></span>
							</div>
						))}
					</div>

					<div className="ep-section-head">Rate Limiting</div>
					{RATE_LIMITING_INFO.map((r) =>
					{
						const id = `rate:${r.tag}`;
						return (
							<CollapsibleEntry
								key={id}
								tag={r.tag}
								tagType={r.tagType}
								label={r.label}
								items={r.items}
								open={openEntries.has(id)}
								onToggle={() => toggleEntry(id)}
							/>
						);
					})}

					<div className="ep-section-head">Role Enforcement</div>
					<div className="constraint-text security-note">
						<RefText value={ROLE_ENFORCEMENT_INFO.note} />
					</div>
					{ROLE_ENFORCEMENT_INFO.roles.map((r) =>
					{
						const id = `role:${r.tag}`;
						return (
							<CollapsibleEntry
								key={id}
								tag={r.tag}
								tagType={r.tagType}
								label={r.label}
								items={r.items}
								open={openEntries.has(id)}
								onToggle={() => toggleEntry(id)}
								renderItem={(item) => item}
							/>
						);
					})}

					<div className="ep-section-head">Auth Strategy Catalog</div>
					{STRATEGY_LIST.map((s) => (
						<CollapsibleEntry
							key={s.id}
							id={s.id}
							tag={s.tag}
							tagType={s.tagType}
							label={s.label}
							items={s.items}
							open={openEntries.has(s.id)}
							onToggle={() => toggleEntry(s.id)}
							highlighted={highlighted === s.id}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

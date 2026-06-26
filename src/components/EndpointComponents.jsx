import { useState, useMemo, useCallback } from "react";
import { ENDPOINTS, PAGES, AUTH_STRATEGIES, ROLE_ENFORCEMENT_INFO } from "../data";
import Badge from "./ui/Badge.jsx";
import RolePill from "./ui/RolePill.jsx";
import useMaskSpotlight from "../hooks/useMaskSpotlight.js";

const CONSTRAINT_CONFIG =
[
	{ key: "realtime", tag: "RT", type: "realtime", skip: (v) => v === "None" },
	{ key: "fallback", tag: "FALL", type: "fallback", skip: (v) => v === "None" },
	{ key: "dedup", tag: "DEDUP", type: "dedup", skip: (v) => v === "None" },
];

// Pretty-prints the loose shorthand shape strings used for request/response
// (e.g. "{ id, preset, service: a | b, custom?: x }") with indentation and
// line breaks, WITHOUT rewriting the shorthand into strict JSON syntax.
// Respects nested {}/[]/'' so values like "status: acknowledged | resolved"
// or "my_ack: { status, acked_at } | null" stay intact.
function formatShape(str)
{
	if (typeof str !== "string") return str;
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

function AuthStrategyRow({ ep })
{
	const [open, setOpen] = useState(null);
	const strats = (ep.authStrategy || [])
		.map((k) => AUTH_STRATEGIES[k])
		.filter(Boolean);
	if (!strats.length) return null;

	const activeStrat = strats.find((s) => s.id === open);

	return (
		<>
			<span className="meta-label meta-label--auth">Auth Strategy</span>
			<span className="meta-value meta-value--auth">
				{strats.map((s) => (
					<button
						key={s.id}
						className={"auth-strat-pill constraint-tag--" + s.tagType + (open === s.id ? " auth-strat-pill--open" : "")}
						onClick={() => setOpen((o) => (o === s.id ? null : s.id))}
					>
						{s.tag}{" "}
						<span className="auth-strat-pill-chevron">
							{open === s.id ? "▲" : "▼"}
						</span>
					</button>
				))}
			</span>
			{activeStrat && (
				<>
					<span />
					<div className="auth-strat-inline">
						<div className="auth-strat-inline-label">{activeStrat.label}</div>
						{activeStrat.items.map((item, i) => (
							<div className="gw-row-item" key={i}>
								<span className="gw-row-dot">·</span>
								<span className="constraint-text">{item}</span>
							</div>
						))}
					</div>
				</>
			)}
		</>
	);
}

// "ADMIN" / "ANY_AUTH" (the values endpoints store) -> the matching role entry
// in ROLE_ENFORCEMENT_INFO, by normalizing "ANY AUTH" -> "ANY_AUTH". Pulling
// the tag text + tagType from there means the color/label only ever lives
// in one place — gateway.js — same fix as requiredRole itself.
const ROLE_INFO_BY_KEY = Object.fromEntries(
	ROLE_ENFORCEMENT_INFO.roles.map((r) => [r.tag.replace(/\s+/g, "_"), r]),
);

function RequiredRoleRow({ ep })
{
	const info = ep.requiredRole && ROLE_INFO_BY_KEY[ep.requiredRole];
	if (!info) return null;

	return (
		<>
			<span className="meta-label meta-label--auth">Required Role</span>
			<span className="meta-value meta-value--auth">
				<span className={"constraint-tag constraint-tag--" + info.tagType}>
					{info.tag}
				</span>
			</span>
		</>
	);
}

// ConstraintSection receives isOpenState/toggleOpenState and a usedByKey
// (built by the parent EndpointCard as openKey + ":usedby").
// Keys used inside:
//   usedBy toggle  : usedByKey
//   nested PageCard: usedByKey + ":page:" + p.id  (also used as that card's keyPrefix)
//
// Collapse-all button: every key nested under this used-by section (the
// toggle itself, nested page cards, and anything those page cards open in
// turn) is built by string concatenation starting from usedByKey, so a
// simple startsWith prefix match reaches all of them regardless of depth.
// Only shown once the section is open AND at least 2 of those keys are
// actually open — with 0 or 1 there's nothing meaningful to collapse "all" of.
function ConstraintSection({
	ep,
	showUsedBy = true,
	isOpenState,
	toggleOpenState,
	usedByKey,
	openKeys,
	collapseMatching
})
{
	const { constraints } = ep;
	const pages = PAGES.filter((p) => p.endpointIds.includes(ep.id));

	const usedByOpen = isOpenState(usedByKey);
	// No border on the section box itself — matches every other
	// ep-section-head box (Payload, Query Params, Constraints), none of
	// which draw one either. Only the individual nested PageCards get
	// their own border (when not suppressed — see PageCard's excludeEpId
	// check), since those are the actual list items.
	const usedByRef = useMaskSpotlight(usedByOpen, { border: false });

	const belongsToUsedBy = (key) => key.startsWith(usedByKey);
	const usedByOpenCount = [...openKeys].filter(belongsToUsedBy).length;

	function handleCollapseAllUsedBy(e)
	{
		e.stopPropagation();
		collapseMatching(belongsToUsedBy);
	}

	const rows =
	[
		...CONSTRAINT_CONFIG.filter(({ key, skip }) => !skip(constraints[key])).map(
			({ key, tag, type }) => ({ tag, type, text: constraints[key], key }),
		),
		...constraints.criteria.map((c, i) => ({
			tag: "CRITER",
			type: "crit",
			text: c,
			key: "crit" + i,
		})),
		...constraints.security.map((c, i) => ({       // <-- add this block
			tag: "SEC",
			type: "sec",
			text: c,
			key: "sec" + i,
		})),
	];

	return (
		<div>
			{showUsedBy && pages.length > 0 && (
				<div ref={usedByRef} className="used-by-section spot">
					<div
						className="ep-section-head used-by-head"
						onClick={() => toggleOpenState(usedByKey)}
					>
						Used by pages ({pages.length})
						<button
							type="button"
							className="group-hd-collapse-btn ep-section-collapse-btn"
							onClick={handleCollapseAllUsedBy}
							disabled={!(usedByOpen && usedByOpenCount >= 2)}
							title="Collapse all"
						>
							Collapse all
						</button>
					</div>
					<div className={"collapsible" + (usedByOpen ? " collapsible--open" : "")}>
						<div className="collapsible-inner used-by-section-body">
							{pages.map((p) =>
							{
								const pageKey = usedByKey + ":page:" + p.id;
								return (
									<PageCard
										key={p.id}
										page={p}
										isOpen={isOpenState(pageKey)}
										onToggle={() => toggleOpenState(pageKey)}
										keyPrefix={pageKey}
										isOpenState={isOpenState}
										toggleOpenState={toggleOpenState}
										excludeEpId={ep.id}
										openKeys={openKeys}
										collapseMatching={collapseMatching}
									/>
								);
							})}
						</div>
					</div>
				</div>
			)}
			{rows.length > 0 && (
				<div>
					<div className="ep-section-head">Constraints</div>
					{rows.map((r) => (
						<div className="constraint-row" key={r.key}>
							<span className={"constraint-tag constraint-tag--" + r.type}>
								{r.tag}
							</span>
							<span className="constraint-text">{r.text}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ShapeFrame is its own component so useMaskSpotlight can be called per frame
// (hooks cannot be called inside .map()). border:false because the frame lives
// inside the PayloadSection spotlight — no need for a second border layer.
function ShapeFrame({ frame, shape, frameKey, isOpenState, toggleOpenState })
{
	const frameOpen = isOpenState(frameKey);
	const ref = useMaskSpotlight(frameOpen, { border: false });
	return (
		<div ref={ref} className="shape-frame spot">
			<div
				className="ep-section-head shape-frame-head"
				onClick={() => toggleOpenState(frameKey)}
			>
				{frame}
			</div>
			<div className={"collapsible" + (frameOpen ? " collapsible--open" : "")}>
				<div className="collapsible-inner shape-frame-body">
					<pre className="shape-pre">{formatShape(shape)}</pre>
				</div>
			</div>
		</div>
	);
}

// PayloadSection uses the registry (openKey/isOpenState/toggleOpenState)
// so a group-level "collapse all" can reach it without lifting state manually.
// When value is an object (multi-frame), each frame is individually collapsible
// via its own registry key, collapsed by default.
function PayloadSection({ label, value, openKey, isOpenState, toggleOpenState })
{
	const open = isOpenState(openKey);
	const ref = useMaskSpotlight(open, { border: false });
	const frameCount = typeof value === "string" ? 1 : Object.keys(value).length;

	return (
		<div ref={ref} className="payload-section spot">
			<div
				className="ep-section-head payload-section-head"
				onClick={() => toggleOpenState(openKey)}
			>
				{label} ({frameCount})
			</div>
			<div className={"collapsible" + (open ? " collapsible--open" : "")}>
				<div className="collapsible-inner payload-section-body">
					{typeof value === "string"
						? <pre className="shape-pre">{formatShape(value)}</pre>
						: Object.entries(value).map(([frame, shape]) =>
						{
							const frameKey = openKey + ":frame:" + frame;
							return (
								<ShapeFrame
									key={frame}
									frame={frame}
									shape={shape}
									frameKey={frameKey}
									isOpenState={isOpenState}
									toggleOpenState={toggleOpenState}
								/>
							);
						})}
				</div>
			</div>
		</div>
	);
}

// Renders URI query params as pills — deliberately NOT routed through
// PayloadSection's code-block/frame rendering, so a query string can never
// be visually mistaken for a request body or a WS frame.
function QueryParamsSection({ params })
{
	if (!params || params.length === 0) return null;

	return (
		<div className="query-params-section">
			<div className="ep-section-head">Query Params ({params.length})</div>
			<div className="query-params-row">
				{params.map((p) => (
					<span
						key={p.name}
						className={"query-param-pill" + (p.required ? " query-param-pill--required" : "")}
					>
						<span className="query-param-name">
							{p.required ? p.name : "?" + p.name}
						</span>
						<span className="query-param-type">{p.type}</span>
					</span>
				))}
			</div>
		</div>
	);
}

// EndpointCard uses the registry:
//   openKey         - this card's own open/close key in the registry
//   isOpenState     - registry isOpen function
//   toggleOpenState - registry toggle function
// Payload and usedBy child keys are derived from openKey at render time.
function EndpointCard({
	ep,
	openKey,
	isOpenState,
	toggleOpenState,
	highlighted,
	showUsedBy = true,
	openKeys,
	collapseMatching,
})
{
	const expanded = isOpenState(openKey);
	// showUsedBy is false exactly when this card is nested inside a
	// PageCard's "Endpoints used" list (see PageCard below) rather than
	// shown at the top level of the Endpoints view — and that list item
	// shouldn't draw its own top/bottom border on top of the page card's.
	const ref = useMaskSpotlight(expanded, { border: !expanded && showUsedBy });

	// "Collapse attributes" wipes every open registry key that is a child of
	// this card (payload sections, used-by, nested page cards) without closing
	// the card itself. A child key always starts with openKey + ":" so the
	// card's own key (no trailing colon) is naturally excluded.
	const belongsToCard = useCallback(
		(key) => key.startsWith(openKey + ":"),
		[openKey],
	);
	const attrOpenCount = useMemo(
		() => openKeys ? [...openKeys].filter(belongsToCard).length : 0,
		[openKeys, belongsToCard],
	);
	function handleCollapseAttrs(e)
	{
		e.stopPropagation();
		collapseMatching(belongsToCard);
	}

	return (
		<div
			ref={ref}
			id={ep.id}
			className={"ep-card spot" + (expanded ? " ep-card--open" : "") + (highlighted ? " highlight-ring" : "")}
		>
			<div className="ep-card-header" onClick={() => toggleOpenState(openKey)}>
				<Badge method={ep.method} />
				<span className="ep-route">{ep.route}</span>
				<button
					type="button"
					className="group-hd-collapse-btn ep-card-collapse-btn"
					onClick={handleCollapseAttrs}
					disabled={!expanded || attrOpenCount === 0}
					title="Collapse attributes"
				>
					Collapse attributes
				</button>
			</div>
			<div className={"collapsible" + (expanded ? " collapsible--open" : "")}>
				<div className="collapsible-inner ep-body">
					<div className="ep-meta-grid">
						<span className="meta-label">Service</span>
						<span className="meta-value meta-value--service">{ep.service}</span>
						<span className="meta-label">Owner</span>
						<span
							className={"meta-value role--" + ep.owner.toLowerCase().replace(/\s+/g, "-")}
						>
							{ep.owner}
						</span>
						{ep.tables.length > 0 && (
							<>
								<span className="meta-label">Tables</span>
								<span className="meta-value meta-value--tables">
									{ep.tables.join(", ")}: {ep.tables_actions}
								</span>
							</>
						)}
						{ep.constraints.rateLimit &&
							ep.constraints.rateLimit !== "N/A" &&
							ep.constraints.rateLimit !== "Not rate limited" && (
							<>
								<span className="meta-label">Rate limit</span>
								<span className="meta-value meta-value--tables">
									{ep.constraints.rateLimit}
								</span>
							</>
						)}
						<AuthStrategyRow ep={ep} />
						<RequiredRoleRow ep={ep} />
					</div>
					{ep.method === "WS"
						? ep.request && (
							<PayloadSection
								label="Request"
								value={ep.request}
								openKey={openKey + ":payload:Request"}
								isOpenState={isOpenState}
								toggleOpenState={toggleOpenState}
							/>
						)
						: ep.request && (
							<>
								<QueryParamsSection params={ep.request.query} />
								{ep.request.body && (
									<PayloadSection
										label="Body"
										value={ep.request.body}
										openKey={openKey + ":payload:Body"}
										isOpenState={isOpenState}
										toggleOpenState={toggleOpenState}
									/>
								)}
							</>
						)}
					{ep.response && (
						<PayloadSection
							label="Response"
							value={ep.response}
							openKey={openKey + ":payload:Response"}
							isOpenState={isOpenState}
							toggleOpenState={toggleOpenState}
						/>
					)}
					<ConstraintSection
						ep={ep}
						showUsedBy={showUsedBy}
						isOpenState={isOpenState}
						toggleOpenState={toggleOpenState}
						usedByKey={openKey + ":usedby"}
						openKeys={openKeys}
						collapseMatching={collapseMatching}
					/>
				</div>
			</div>
		</div>
	);
}

// PageCard receives keyPrefix to build unique keys for its EndpointCard children.
// The card's own isOpen/onToggle are passed directly (single-select in top-level
// Pages view, or registry-backed in nested used-by contexts).
//
// Collapse-all button (Endpoints used): every key any of this page's
// EndpointCards can open (the card itself, its payload sections, its own
// nested used-by) is built starting with keyPrefix + ":ep:" + ep.id, so a
// startsWith prefix match on keyPrefix + ":ep:" reaches all of them. No
// "section open" gate needed here (unlike the used-by case) — this list is
// only ever rendered while the page card itself is already open. Only
// shown once at least 2 of those keys are open.
function PageCard({
	page,
	isOpen,
	onToggle,
	keyPrefix,
	isOpenState,
	toggleOpenState,
	highlightEndpointId,
	excludeEpId,
	openKeys,
	collapseMatching,
})
{
	const eps = ENDPOINTS.filter(
		(e) => page.endpointIds.includes(e.id) && e.id !== excludeEpId,
	);
	const roles = page.role.split(" + ");
	// excludeEpId is only set when this card is nested inside an
	// EndpointCard's "Used by pages" list (see ConstraintSection's
	// used-by-section) rather than shown at the top level of the Pages
	// view — and that list item shouldn't draw its own top/bottom border
	// on top of the used-by section's.
	const ref = useMaskSpotlight(isOpen, { border: !excludeEpId });

	const epsPrefix = keyPrefix + ":ep:";
	const belongsToEps = (key) => key.startsWith(epsPrefix);
	const epsOpenCount = openKeys
		? [...openKeys].filter(belongsToEps).length
		: 0;

	function handleCollapseAllEps(e)
	{
		e.stopPropagation();
		collapseMatching(belongsToEps);
	}

	return (
		<div ref={ref} className={"page-card spot" + (isOpen ? " page-card--open" : "")}>
			<div className="page-card-header" onClick={onToggle}>
				<div className="page-card-header-flex">
					<span className="page-name">{page.name}</span>
					<span className="page-path">{page.path}</span>
				</div>
				<span className="text-mono-small">{eps.length} ep</span>
			</div>
			<div className={"collapsible" + (isOpen ? " collapsible--open" : "")}>
				<div className="collapsible-inner page-body">
					<div>
						{roles.map((r) => (
							<RolePill key={r} role={r} />
						))}
					</div>
					<p className="page-desc">{page.desc}</p>
					{eps.length === 0 ? (
						<div className="static-page-msg">
							{excludeEpId
								? "No other endpoints used."
								: "Static page - no API endpoints."}
						</div>
					) : (
						<div>
							<div className="ep-section-head">
								{excludeEpId ? "Other endpoints used" : "Endpoints used"}
								<button
									type="button"
									className="group-hd-collapse-btn ep-section-collapse-btn"
									onClick={handleCollapseAllEps}
									disabled={epsOpenCount < 2}
									title="Collapse all"
								>
									Collapse all
								</button>
							</div>
							{eps.map((ep) =>
							{
								const epKey = keyPrefix + ":ep:" + ep.id;
								const isHighlighted = highlightEndpointId === ep.id;
								return (
									<EndpointCard
										key={ep.id}
										ep={ep}
										openKey={epKey}
										isOpenState={isOpenState}
										toggleOpenState={toggleOpenState}
										highlighted={isHighlighted}
										showUsedBy={false}
										openKeys={openKeys}
										collapseMatching={collapseMatching}
									/>
								);
							})}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

export { EndpointCard, PageCard, ConstraintSection, AuthStrategyRow };

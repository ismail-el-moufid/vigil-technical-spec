import { FILTER_CHAIN, STARTUP_SEQUENCE } from "../data";
import { useCollapseHotkey } from "../hooks/useCollapseHotkey";
import CollapseToggle from "./ui/CollapseToggle.jsx";

/**
 * InfraLayer displays startup/setup and gateway infrastructure info that
 * applies to ALL endpoints (boot sequence, filter chain). Uses the same
 * card design as EndpointCard for consistency.
 */
export default function InfraLayer({ open, onToggle })
{
	// onToggle flips infraOpen, so calling it while open closes it — the same
	// behavior the header click already relies on.
	const hotkeyNumber = useCollapseHotkey(open, onToggle);
	const collapsibleClass = `collapsible${open ? " collapsible--open" : ""}`;
	return (
		<div className="infra-layer">
			<div className="ep-card-header" onClick={onToggle}>
				<span className="badge badge--infra">INFRA</span>
				<span className="ep-route">Startup · Spring Security · Bucket4j</span>
				<CollapseToggle collapsed={!open} hotkeyNumber={hotkeyNumber} className="ep-toggle" />
			</div>
			<div className={collapsibleClass}>
				<div className="collapsible-inner ep-body">
					<div className="ep-meta-grid infra-meta-grid">
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
								<span className="constraint-text">{n.label}: {n.sub}</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

import { FILTER_CHAIN, AUTH_STRATEGIES } from "../data";

/**
 * SecurityLayer displays infrastructure security info that applies to ALL endpoints.
 * Uses the same card design as EndpointCard for consistency.
 */
export default function SecurityLayer({ open, onToggle })
{
	const collapsibleClass = `collapsible${open ? " collapsible--open" : ""}`;
	return (
		<div className="ep-card security-layer">
			<div className="ep-card-header" onClick={onToggle}>
				<span className="badge badge--sec">SECURITY</span>
				<span className="ep-route">Spring Security · Bucket4j</span>
			</div>
			<div className={collapsibleClass}>
				<div className="collapsible-inner ep-body">
					<div className="ep-meta-grid security-meta-grid">
						<span className="meta-label">Filter Chain</span>
						<span className="meta-value meta-value--mono">
							{FILTER_CHAIN.map((n) => n.label).join(" → ")}
						</span>
						<span className="meta-label">Auth Methods</span>
						<span className="meta-value">
							{Object.values(AUTH_STRATEGIES).map((s) => s.tag).join(", ")}
						</span>
					</div>
					<div className="security-note">
						Infrastructure layer - per-endpoint auth strategies are shown in each endpoint below.
					</div>
				</div>
			</div>
		</div>
	);
}

// ─── PAGES ────────────────────────────────────────────────────────────────
// Every authenticated page renders a persistent header (profile icon, sign
// out) except Settings, which exposes account controls directly instead —
// that's why ep-auth-logout shows up on every page below except page-settings,
// the same distribution ep-alerts-ws already follows for the header's live
// alert bell (Settings included there, since that one isn't redundant there).

export const PAGES =
[
	{
		name: "Setup",
		path: "/setup",
		desc: "First-boot admin account creation, shown only before any user exists. Enforcement lives server-side",
		role: "Frontend Lead",
		group: "Auth",
		endpointIds: ["ep-auth-setup"],
		id: "page-setup",
	},
	{
		name: "Login",
		path: "/login",
		desc: "Email and password authentication. Route guard enforced on every page load.",
		role: "Frontend Lead",
		group: "Auth",
		endpointIds:
		[
			"ep-auth-login",
			"ep-auth-refresh",
		],
		id: "page-login",
	},
	{
		name: "Overview",
		path: "/overview",
		desc: "Live dashboard. Gauges, request lifecycle chart, recent logs, compact AI chat widget.",
		role: "Frontend Lead",
		group: "Dashboard",
		endpointIds:
		[
			"ep-telemetry-metrics",
			"ep-telemetry-traces",
			"ep-telemetry-logs",
			"ep-alerts-ws",
			"ep-telemetry-logs-live",
			"ep-telemetry-traces-live",
			"ep-telemetry-metrics-live",
			"ep-llm-analyze",
			"ep-auth-logout",
		],
		id: "page-overview",
	},
	{
		name: "Logs",
		path: "/logs",
		desc: "Infinite scroll log viewer with text search, severity filters, sorting, and CSV export.",
		role: "Frontend Lead + Telemetry Engineer",
		group: "Telemetry",
		endpointIds:
		[
			"ep-alerts-ws",
			"ep-telemetry-logs",
			"ep-telemetry-logs-live",
			"ep-auth-logout",
		],
		id: "page-logs",
	},
	{
		name: "Traces",
		path: "/traces",
		desc: "Infinite scroll trace viewer with period and service filters, sorting, and CSV export.",
		role: "Frontend Lead + Telemetry Engineer",
		group: "Telemetry",
		endpointIds:
		[
			"ep-alerts-ws",
			"ep-telemetry-traces",
			"ep-telemetry-traces-live",
			"ep-auth-logout",
		],
		id: "page-traces",
	},
	{
		name: "Metrics",
		path: "/metrics",
		desc: "Interactive charts with live updates, infinite scroll, filters, and CSV export.",
		role: "Frontend Lead + Telemetry Engineer",
		group: "Telemetry",
		endpointIds:
		[
			"ep-alerts-ws",
			"ep-telemetry-metrics",
			"ep-telemetry-metrics-live",
			"ep-auth-logout",
		],
		id: "page-metrics",
	},
	{
		name: "Alerts",
		path: "/alerts",
		desc: "Alert history feed with infinite scroll, filters, and rules tab. Alert Telemetry Evaluation pipeline terminates here.",
		role: "Frontend Lead + Backend Lead",
		group: "Alerts",
		endpointIds:
		[
			"ep-alerts-ws",
			"ep-alerts-list",
			"ep-alert-rules-list",
			"ep-alert-rules-create",
			"ep-alert-rules-update",
			"ep-alert-rules-delete",
			"ep-telemetry-attributes",
			"ep-auth-logout",
		],
		id: "page-alerts",
	},
	{
		name: "AI Insights",
		path: "/ai-insights",
		desc: "Full-page streaming chat. Frontend maintains full conversation history between turns.",
		role: "Frontend Lead + AI Engineer",
		group: "AI",
		endpointIds: ["ep-alerts-ws", "ep-llm-analyze", "ep-auth-logout"],
		id: "page-ai",
	},
	{
		name: "Settings",
		path: "/settings",
		desc: "User CRUD, role management, webhook management, and read-only display of the startup-generated API key and ingestion key (sourced from Spring Boot @ConfigurationProperties, listed in Endpoints used below). Config export is client-side: fetches alert rules and webhooks via existing GETs and downloads as JSON. Import iterates existing POST endpoints with the imported payload. Session management section lists all active sessions for the current user (device, IP, last active) with per-session revoke; the calling session is flagged as current.",
		role: "Frontend Lead + Backend Lead",
		group: "Settings",
		endpointIds:
		[
			"ep-alerts-ws",
			"ep-config-keys",
			"ep-users-list",
			"ep-users-create",
			"ep-users-me-get",
			"ep-users-me",
			"ep-users-update",
			"ep-users-delete",
			"ep-webhooks-list",
			"ep-webhooks-create",
			"ep-webhooks-delete",
			"ep-auth-sessions-list",
			"ep-auth-sessions-revoke",
		],
		id: "page-settings",
	},
	{
		name: "Status",
		path: "/status",
		desc: "Infrastructure health page. Calls /api/telemetry/metrics twice: once without filter for service health panels, once with ?vigil.internal=true for infrastructure gauges. Dual-call is intentional — two distinct data sets feed two distinct UI sections.",
		role: "Frontend Lead + Telemetry Engineer + Platform Engineer",
		group: "Status",
		endpointIds: ["ep-alerts-ws", "ep-telemetry-metrics", "ep-auth-logout"],
		id: "page-status",
	},
	{
		name: "Privacy Policy + ToS",
		path: "/privacy + /terms",
		desc: "Fully static pages. Linked in persistent footer.",
		role: "Frontend Lead",
		group: "Static",
		endpointIds: [],
		id: "page-static",
	},
];

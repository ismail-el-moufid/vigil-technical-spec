// Current routes are grounded in services/web/src/App.tsx. Roadmap-only pages
// remain explicitly labelled; endpointIds are not evidence of a mounted route.
// DASHBOARD includes the shared drawer's attempted ask request, not proof that
// its frontend/backend request contract works (see page-alerts and page-ai).
const DASHBOARD = ["ep-alerts-ws", "ep-alert-notifications-list", "ep-alert-notification-update", "ep-auth-logout", "ep-alert-ask"];
const ONBOARDING = ["ep-config-keys", "ep-config-tls-addresses", "ep-config-tls-ca", "ep-telemetry-traces-live", "ep-telemetry-logs-live", "ep-telemetry-metrics-live", "ep-auth-refresh", "ep-users-me-get", "ep-auth-logout"];

export const PAGES =
[
	{
		name: "Root redirect", path: "/",
		desc: "Implemented protected redirect to /overview. ProtectedRoute waits for authentication restoration, renders SetupCheckError on restoration failure, and redirects unauthenticated requests to /auth/login. Source: services/web/src/App.tsx and auth/ProtectedRoute.tsx.",
		role: "Frontend Lead", group: "Dashboard", endpointIds: [], id: "page-root",
	},
	{
		name: "Setup", path: "/auth/setup",
		desc: "Implemented public first-admin form. AuthEntryGuard uses the raw GET /api/setup boolean to choose setup or /auth/login. POST creates human/API-key admins, then AuthProvider fetches /users/me and the form opens /service-onboarding. Backend gap: POST rejects any existing user while GET tests only admin count; setup creation is not serialized.",
		role: "Frontend Lead", group: "Auth", endpointIds: ["ep-setup-status", "ep-auth-setup", "ep-users-me-get"], id: "page-setup",
	},
	{
		name: "Onboarding", path: "/service-onboarding",
		desc: "Implemented admin-only first-service wizard outside DashboardLayout. Shares ServiceOnboardingWizard with /add-service. Account creation is already complete; Skip for now returns to /overview. No persisted onboarding-completion or service-registration API exists.",
		role: "Frontend Lead + Telemetry Engineer", group: "Auth",
		requirements: [
			"Implemented steps: choose recommended/new or existing instrumentation; choose language and SDK/agent instructions when needed; enter service name; configure HTTPS address; review connection; generate OTLP config; local-CA download/exporter-trust steps only for local TLS; launch service; verify telemetry. Language, name, verified address, key availability and CA-path checks gate progression.",
			"Address defaults to https://localhost, not window.location.origin. Custom input is normalized to HTTPS and sent to POST /api/config/tls/addresses. Pending 202 is displayed with retry guidance; verified 409 is accepted. Use localhost is a client-side local-mode shortcut, not a server verification request. Public TLS skips CA steps.",
			"Keys load through React Query on entry. Only ingestion_key enters generated OTLP config (HTTPS address + /otlp, http/protobuf, Bearer ingestion header). Missing/loading/failed keys block later steps and thus verification; monitoring is not independent of key loading in the current wizard. The default portless localhost address must be adjusted when using Compose's default published HTTPS port 8443; a local-mode shortcut is not proof the exporter can reach that address.",
			"Verification opens logs/live, traces/live and metrics/live only at step 11 with service/token URLSearchParams. Any message marks its signal received; open alone does not. The UI shows per-signal state and any one signal is enough to reveal success/actions. Streams stay open to receive remaining signals until step change/unmount.",
			"Current success links are bare /traces, /logs and /metrics, not service-filtered links. Add another service on first onboarding navigates to /add-service; in that page the shared wizard resets instrumentation, language, name, address, TLS and paths, retaining cached keys.",
			"Current retry: EventSource automatic reconnect plus manual restart of all three streams. No payload validation, exact-service client check, stale-callback guard, debounce, coordinated backoff or scheduled JWT-expiry refresh is implemented in useTelemetryVerification. Planned hardening: add these safeguards and filtered success links; do not claim the previous acceptance checks have passed.",
			"Reload restores authentication through AuthProvider but reconstructs the wizard from step 1 (page state is not persisted). PermissionRoute redirects viewers to /overview (no access-denied page). OnboardingLayout does not mount the dashboard alert WebSocket/bell.",
		],
		endpointIds: ONBOARDING, id: "page-onboarding",
	},
	{
		name: "Add service", path: "/add-service",
		desc: "Implemented admin-only dashboard route reusing the onboarding wizard. Cancel returns to /overview; Add another service resets the wizard locally. Dashboard header/notification socket and alert AI drawer remain mounted here.",
		role: "Frontend Lead + Telemetry Engineer", group: "Telemetry", endpointIds: [...new Set([...ONBOARDING, ...DASHBOARD])], id: "page-add-service",
	},
	{
		name: "Login", path: "/auth/login",
		desc: "Implemented email/password form. On sign-in and session restoration AuthProvider fetches /users/me before setting authenticated state; already authenticated public-route visitors go to /overview. No /login alias is mounted.",
		role: "Frontend Lead", group: "Auth", endpointIds: ["ep-auth-login", "ep-auth-refresh", "ep-users-me-get", "ep-setup-status"], id: "page-login",
	},
	{
		name: "Overview", path: "/overview",
		desc: "Implemented dashboard: critical/warning/unacknowledged/healthy KPIs from alerts and traces, request-performance chart, service summaries, alert actions and recent logs. Uses alert history (up to 500), logs (100) and spans (500), plus live logs/traces and shared alert/LLM broadcasts. Time/search/service filters, CSV logs and client-generated PDF report. Not an infrastructure metrics-gauge page; no compact general-chat widget.",
		role: "Frontend Lead", group: "Dashboard",
		endpointIds: [...DASHBOARD, "ep-alerts-list", "ep-alert-history-update", "ep-telemetry-traces", "ep-telemetry-logs", "ep-telemetry-logs-live", "ep-telemetry-traces-live"], id: "page-overview",
	},
	{
		name: "Logs", path: "/logs",
		desc: "Implemented infinite-scroll logs, period/service/severity/search filters, sorting, CSV, expandable details and opt-in live mode (initially paused). service query initializes the filter. Live/pending buffers hold up to 200 records; errors close the stream and pause live mode. Dashboard notification bell and alert-scoped AI drawer are shared layout features.",
		role: "Frontend Lead + Telemetry Engineer", group: "Telemetry", endpointIds: [...DASHBOARD, "ep-telemetry-logs", "ep-telemetry-logs-live"], id: "page-logs",
	},
	{
		name: "Traces", path: "/traces",
		desc: "Implemented trace table with period/service filters, load-more, CSV, opt-in live mode and expandable span details. service query initializes the filter; trace_id/span_id URL parameters select already-loaded rows. No frontend sorting control is wired, although the backend supports sort. Live errors close rather than auto-retry; the live hook keeps at most 200 spans and does not apply the selected historical period. Historical pagination uses the last timestamp alone, so equal-timestamp page boundaries need coverage. Sources: pages/Traces/TracesPage.tsx, hooks/useTraces.ts and hooks/useLiveTraces.ts under services/web/src.",
		role: "Frontend Lead + Telemetry Engineer", group: "Telemetry", endpointIds: [...DASHBOARD, "ep-telemetry-traces", "ep-telemetry-traces-live"], id: "page-traces",
	},
	{
		name: "Metrics", path: "/metrics",
		desc: "Implemented selectable charts from /metrics/series and a separately paginated raw-points table, with period/service filters, load-more, CSV and opt-in live SSE. service query initializes filter. First two metric names are charted by default; live mode polls series every 60s while raw points arrive by SSE. This does not use the earlier planned metric_name/interval/aggregation mode. Chart selection is local and does not filter the raw table or CSV; CSV uses period/service. The UI caption says averaged per time bucket, but backend series semantics depend on metric kind, not a universal average. Raw live mode keeps up to 200 points, closes on SSE error and displays failed until manually toggled; chart polling remains enabled while live is selected even after raw SSE failure. Live points are not constrained to the selected historical period; charts/table need not represent the same window or snapshot. Historical load-more uses timestamp-only bookmarks. Sources: services/web/src/pages/Metrics/MetricsPage.tsx and hooks/useMetrics.ts, useMetricSeries.ts, useLiveMetrics.ts.",
		role: "Frontend Lead + Telemetry Engineer", group: "Telemetry", endpointIds: [...DASHBOARD, "ep-telemetry-metrics", "ep-telemetry-metrics-series", "ep-telemetry-metrics-live"], id: "page-metrics",
	},
	{
		name: "Alerts", path: "/alerts",
		desc: "Implemented shared history with period/service filters, infinite scroll, ownership-aware acknowledge/resolve/reopen and separate personal seen state. Alert and llm socket messages update history; Notification messages update the recipient cache/bell. ?alert=<uuid> deep-links by loading older pages and scrolling to the alert. Rules live on a separate admin /alert-rules route, not a tab. AI drawer asks about a selected alert, but alertAskApi.ts always sends history while AlertAskRequestDto accepts only question and application.properties rejects unknown properties: the checked-in request contract produces 400 rather than a working end-to-end conversation.",
		role: "Frontend Lead + Backend Lead", group: "Alerts", endpointIds: [...DASHBOARD, "ep-alerts-list", "ep-alert-history-update"], id: "page-alerts",
	},
	{
		name: "Alert rules", path: "/alert-rules",
		desc: "Implemented admin-only rules list/create/edit/delete page, with default-rule restrictions and signal-specific forms. Backend GET rules also allows viewers, but PermissionRoute blocks the UI route for them. Metrics-name options currently come from attribute keys, not metrics.name (known integration gap).",
		role: "Frontend Lead + Backend Lead", group: "Alerts", endpointIds: [...DASHBOARD, "ep-alert-rules-list", "ep-alert-rules-create", "ep-alert-rules-update", "ep-alert-rules-delete", "ep-telemetry-attributes"], id: "page-alert-rules",
	},
	{
		name: "AI Insights (planned page)", path: "/ai-insights",
		desc: "Planned only: no /ai-insights route or full-page general conversation exists in App.tsx. Current AI is an alert-scoped drawer mounted by DashboardLayout, with streaming answers from POST /api/alerts/{id}/ask. Drawer keeps local history and sends it on every ask; the question-only backend DTO plus fail-on-unknown-properties=true rejects that request. Backend SSE support is implemented, but this UI integration is not functional as checked in.",
		role: "Frontend Lead + AI Engineer", group: "AI", endpointIds: ["ep-alert-ask"], id: "page-ai",
	},
	{
		name: "Settings", path: "/settings",
		desc: "Implemented nested settings layout; index redirects to /settings/account. Account and sessions are accessible to both roles; users, API keys and webhooks are admin-only. Shared dashboard header includes logout and notifications even on settings. DashboardLayout also mounts the alert-scoped AI drawer and one alert WebSocket: users can retry a disconnected socket from the sidebar. Opening the socket invalidates alert-history and personal-notification queries, not a durable missed-event replay. Config import/export is not implemented. Sources: services/web/src/components/Dashboard/DashboardLayout.tsx and hooks/useAlertsWebSocket.ts.",
		role: "Frontend Lead + Backend Lead", group: "Settings", endpointIds: DASHBOARD, id: "page-settings",
	},
	{
		name: "Account settings", path: "/settings/account",
		desc: "Implemented self email/password forms using PATCH /users/me and current AuthProvider user, for admin/viewer. Backend allows empty patches and does not require current-password confirmation or revoke existing sessions on password change.",
		role: "Frontend Lead", group: "Settings", endpointIds: [...DASHBOARD, "ep-users-me-get", "ep-users-me"], id: "page-settings-account",
	},
	{
		name: "Session settings", path: "/settings/sessions",
		desc: "Implemented active-session list with device/IP/last-used/current indicator and per-session revoke using the refresh cookie. Backend clears cookies when revoking the current session, but useSessions only invalidates the list and does not immediately clear AuthProvider state (known gap). Other-session revoke leaves caller signed in.",
		role: "Frontend Lead", group: "Settings", endpointIds: [...DASHBOARD, "ep-auth-sessions-list", "ep-auth-sessions-revoke"], id: "page-settings-sessions",
	},
	{
		name: "User settings", path: "/settings/users",
		desc: "Implemented admin-only user directory and create/edit/delete dialogs with role management and confirmation. Backend directory includes the API-key backing account; last-admin count includes that account.",
		role: "Frontend Lead + Backend Lead", group: "Settings", endpointIds: [...DASHBOARD, "ep-users-list", "ep-users-create", "ep-users-update", "ep-users-delete"], id: "page-settings-users",
	},
	{
		name: "API key settings", path: "/settings/api-keys",
		desc: "Implemented admin-only read-only display/copy of current API and ingestion keys from /config/keys. API key persists via credential file. Compose already supplies the same bootstrap ingestion key to API and Collector through separate Vault KV documents/rendered files; the active Collector reads a bearer-key file, not runtime/config.yaml. No UI rotation or automatic coordinated consumer reload is implemented. Source: security/vault/scripts/init-vault.sh and security/vault/agent/{api.hcl,collector.hcl,collector-config.tpl}.",
		role: "Frontend Lead + Backend Lead", group: "Settings", endpointIds: [...DASHBOARD, "ep-config-keys"], id: "page-settings-api-keys",
	},
	{
		name: "Webhook settings", path: "/settings/webhooks",
		desc: "Implemented admin-only list/create/delete webhook targets with confirmation. No edit/delivery-test/status UI or configuration import/export is implemented.",
		role: "Frontend Lead + Backend Lead", group: "Settings", endpointIds: [...DASHBOARD, "ep-webhooks-list", "ep-webhooks-create", "ep-webhooks-delete"], id: "page-settings-webhooks",
	},
	{
		name: "Status (planned page)", path: "/status",
		desc: "Planned only: App.tsx has no /status route, so the earlier service/infra dual-metrics-call dashboard is not implemented. Backend raw/series metrics still accept vigil.internal filtering.",
		role: "Frontend Lead + Telemetry Engineer + Platform Engineer", group: "Status", endpointIds: [], id: "page-status",
	},
	{
		name: "Not found", path: "*",
		desc: "Implemented catch-all inside ProtectedRoute and DashboardLayout, not a public 404. Signed-in unknown paths render NotFoundPage with dashboard chrome; signed-out visitors are redirected to /auth/login. This includes unmounted /status, /ai-insights and legacy /login paths. AlertNotificationsPage.tsx exists but App.tsx does not mount a dedicated notifications route; the dashboard bell is the implemented entry point.",
		role: "Frontend Lead", group: "Static", endpointIds: DASHBOARD, id: "page-not-found",
	},
	{
		name: "Privacy Policy + ToS", path: "/legal#privacy + /legal#terms",
		desc: "Implemented public /legal route combines static privacy and terms sections with hash navigation, linked by auth pages. Separate /privacy and /terms routes are not mounted.",
		role: "Frontend Lead", group: "Static", endpointIds: [], id: "page-static",
	},
];

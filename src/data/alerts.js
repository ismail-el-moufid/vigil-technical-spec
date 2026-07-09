export const ALERT_ENDPOINTS =
[
	{
		route: "/api/alerts/ws",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "WS",
		request:
		{
			query: [{ name: "token", type: "string", required: true }],
			ack: "{ type: 'ack', alert_id: '<uuid>', status: acknowledged | resolved }",
		},
		response:
		{
			alert: "{ type: 'alert', data: { id: '<uuid>', rule_id: '<uuid>', service: '<string>', triggered_at: '<iso8601>', llm_analysis: '<string>' } }",
			llm: "{ type: 'llm', data: { id: '<uuid>', status: '<string>', llm_analysis: '<string>' } }",
			status: "{ type: 'status', data: { alert_id: '<uuid>', user_email: '<email>', status: acknowledged | resolved, acked_at: '<iso8601>' } } — user_email here is a display join against users.email at broadcast time, not the alert_acks storage key (see SCHEMA.alert_acks: keyed on user_id)",
			error: "{ type: 'error', message: '<string>' }",
			rateLimited: "{ type: 'error', message: 'rate limited', retry_after_seconds: number }",
		},
		group: "Alerts",
		tables: ["alert_acks"],
		tables_actions: { alert_acks: "Upsert" },
		constraints: {
			criteria:
			[
				"Web Major Real-time features",
				"single connection handles both push and acknowledgment",
				"Token validated at the HTTP Upgrade via a HandshakeInterceptor (see AUTH_STRATEGIES.WS_AUTH_HANDSHAKE) — connection is rejected outright if the token is invalid or missing, so there's no post-connect auth window, no auth frame, and no auth-timeout error frame",
				"ack frame calls the same service method as PUT /api/alerts/{id} then broadcasts 'status' frame to ALL connected sessions",
				"PUT /api/alerts/{id} REST endpoint retained for API-key clients; it also broadcasts via the in-memory WebSocketSession registry",
				"Acks are per-user: each user's read/ack state on an alert is tracked independently in alert_acks, not as a single shared status on the alert",
			],
			security:
			[
				"Any authenticated user may view and ack any alert — no per-service ownership scoping",
				"ack alert_id is validated to exist before insert/update on alert_acks; unknown id returns 'error' frame, no row written",
				"Upsert key is (alert_id, user_id) — user_id comes from the authenticated principal resolved off the handshake token, never a client-supplied field — so alert_acks rows survive a caller later changing their own email",
			],
			rateLimit: "10 req/min per session. Each ack = one request. Over-limit acks receive a 'rateLimited' error frame; connection stays open.",
			realtime:
				"In-memory WebSocketSession registry (per-instance, not distributed). Status changes broadcast to all authenticated sessions immediately. OTLP pipeline broadcasts into the same registry.",
			fallback:
				"On disconnect, client reconnects and re-authenticates; missed frames not replayed — client re-fetches via GET /api/alerts on reconnect",
			dedup: "None",
		},
		authStrategy: ["WS_AUTH_HANDSHAKE"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-alerts-ws",
	},
	{
		route: "/api/alerts",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "GET",
		request:
		{
			query:
			[
				{ name: "period",  type: "string", required: false },
				{ name: "service", type: "string", required: false },
				{ name: "count",type: "number", required: false },
				{
					name: "before",
					type: "string (ISO8601 — triggered_at of the oldest alert already loaded; omit for first page)",
					required: false
				},
			],
			body: null,
		},
		response:
		{
			200: "{ data: [{ id: '<uuid>', rule_id: '<uuid>', service: '<string>', triggered_at: '<iso8601>', llm_analysis: '<string>', my_ack: { status: acknowledged | resolved, acked_at: '<iso8601>' } | null }], hasMore: boolean }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_history", "alert_acks"],
		tables_actions: { alert_history: "Read", alert_acks: "Read" },
		constraints: {
			criteria:
			[
				"Infinite scroll via keyset (cursor) pagination on triggered_at, not offset — avoids row skip/duplicate drift as new alerts continuously insert ahead of the page",
				"count defaults to 20 when omitted; hasMore derived server-side: returned.length === count",
				"400 returned if count is present but non-numeric or outside 1-100, or before is present but not a valid ISO8601 timestamp",
			],
			security: [
				"Any authenticated user may view any alert — no per-service ownership scoping"
			],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-alerts-list",
	},
	{
		route: "/api/alerts/rules",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "GET",
		request:
		{
			query:
			[
				{ name: "count",  type: "number", required: false },
				{ name: "offset", type: "number", required: false },
			],
			body: null,
		},
		response:
		{
			200: "{ data: [{ id: '<uuid>', service: '<string>', metric_name: '<string>', threshold: '<number>', severity: '<string>', enabled: boolean, is_default: boolean }], hasMore: boolean }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_rules"],
		tables_actions: { alert_rules: "Read" },
		constraints: {
			criteria: [
				"count defaults to 20 when omitted; hasMore derived server-side: returned.length === count",
				"400 returned if count or offset are present but non-numeric or negative",
			],
			security: [
				"Any authenticated user may view any alert rule — no per-service ownership scoping"
			],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-alert-rules-list",
	},
	{
		route: "/api/alerts/rules",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body:
			[
				{ name: "service",  type: "string",  required: true },
				{ name: "metric_name", type: "string",  required: true },
				{ name: "threshold",type: "number",  required: true },
				{ name: "severity", type: "string",  required: true },
				{ name: "enabled",  type: "boolean", required: true },
			],
		},
		response:
		{
			201: "{ id: '<uuid>', service: '<string>', metric_name: '<string>', threshold: '<number>', severity: '<string>', enabled: boolean, is_default: boolean }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_rules"],
		tables_actions: { alert_rules: "Insert" },
		constraints: {
			criteria:
			[
				"is_default is never client-settable; always false on rules created via this endpoint",
				"Rule triggers when the current value of metric_name (matched against the ingested logs/metrics/traces payload for service) is >= threshold — fixed direction, no comparison-operator choice",
				"Frontend may pre-fill this form from an existing rule's values (clone) — purely a frontend UX detail, no API shape change",
				"403 is returned when an authenticated caller lacks the ADMIN role — see Required Role",
			],
			security: [
				"Caller must hold ADMIN role (see Required Role); among admins there is no per-service ownership scoping — any admin may create a rule for any service"
			],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-alert-rules-create",
	},
	{
		route: "/api/alerts/rules/{id}",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "PATCH",
		request:
		{
			query: [],
			body:
			[
				{ name: "enabled",  type: "boolean", required: false },
				{ name: "service",  type: "string",  required: false },
				{ name: "metric_name", type: "string",  required: false },
				{ name: "threshold",type: "number",  required: false },
				{ name: "severity", type: "string",  required: false },
			],
		},
		response:
		{
			200: "{ id: '<uuid>', service: '<string>', metric_name: '<string>', threshold: '<number>', severity: '<string>', enabled: boolean, is_default: boolean }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required', code: 'ADMIN_REQUIRED' } | { error: 'cannot modify service, metric_name, threshold, or severity on a default rule', code: 'DEFAULT_RULE_PROTECTED' }",
			404: "{ error: 'rule not found' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_rules"],
		tables_actions: { alert_rules: "Update" },
		constraints: {
			criteria: [
				"If is_default: true on the target row, only 'enabled' may be changed — any other field in the request body returns 403",
				"Both 403 causes share the status code but carry distinct 'code' values (ADMIN_REQUIRED vs DEFAULT_RULE_PROTECTED) — clients should branch on 'code', not on the 'error' message text",
			],
			security: [
				"Caller must hold ADMIN role (see Required Role); among admins there is no per-service ownership scoping — any admin may update any rule"
			],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-alert-rules-update",
	},
	{
		route: "/api/alerts/rules/{id}",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "DELETE",
		request: { query: [], body: null },
		response:
		{
			204: "Empty response",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required', code: 'ADMIN_REQUIRED' } | { error: 'cannot delete a default rule', code: 'DEFAULT_RULE_PROTECTED' }",
			404: "{ error: 'rule not found' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_rules"],
		tables_actions: { alert_rules: "Delete" },
		constraints: {
			criteria: [
				"If is_default: true on the target row, request is rejected with 403 — default rules cannot be deleted, only disabled via PATCH { enabled: false }",
				"Both 403 causes share the status code but carry distinct 'code' values (ADMIN_REQUIRED vs DEFAULT_RULE_PROTECTED) — clients should branch on 'code', not on the 'error' message text",
			],
			security: [
				"Caller must hold ADMIN role (see Required Role); among admins there is no per-service ownership scoping — any admin may delete any rule"
			],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-alert-rules-delete",
	},
	{
		route: "/api/alerts/{id}",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "PUT",
		request:
		{
			query: [],
			body:
			[
				{ name: "status", type: "acknowledged | resolved", required: true },
			],
		},
		response:
		{
			200: "{ alert_id: '<uuid>', user_email: '<email>', status: acknowledged | resolved, acked_at: '<iso8601>' } — user_email is a display join against users.email at response time, not the alert_acks storage key",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			404: "{ error: 'alert not found' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_acks"],
		tables_actions: { alert_acks: "Upsert" },
		constraints: {
			criteria: [
				"Same service method as WebSocket ack",
				"Upserts on (alert_id, user_id) — re-acking updates the caller's own record, does not create duplicates, and survives the caller later changing their own email",
				"This REST path and the WS ack frame have independent rate-limit buckets (10 req/min per-IP here vs 10 req/min per-session on the socket). Not a practical double-budget: the frontend only ever acks over the open WS connection (see ep-alerts-ws); this REST endpoint exists for API-key clients that aren't holding a socket open, so in normal use only one bucket is ever exercised per caller",
			],
			security: [
				"Any authenticated user may ack any alert — no per-service ownership scoping; ack is scoped to the caller's own user_id (resolved from the auth token, never client-supplied), cannot ack on behalf of another user"
			],
			rateLimit: "10 req/min",
			realtime: "Broadcasts 'status' frame to all sessions via the same in-memory WebSocketSession registry",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-alert-ack",
	},
];

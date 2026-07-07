export const ALERT_ENDPOINTS =
[
	{
		route: "/api/alerts/ws",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "WS",
		request:
		{
			auth: "{ type: 'auth', token: '<jwt or api_key>' }",
			ack: "{ type: 'ack', alert_id: '<uuid>', status: acknowledged | resolved }",
		},
		response:
		{
			alert:       "{ type: 'alert', data: { id: '<uuid>', rule_id: '<uuid>', service: '<string>', triggered_at: '<iso8601>', llm_analysis: '<string>' } }",
			llm:         "{ type: 'llm', data: { id: '<uuid>', status: '<string>', llm_analysis: '<string>' } }",
			status:      "{ type: 'status', data: { alert_id: '<uuid>', user_email: '<email>', status: acknowledged | resolved, acked_at: '<iso8601>' } }",
			error:       "{ type: 'error', message: '<string>' }",
			rateLimited: "{ type: 'error', message: 'rate limited', retry_after_seconds: number }",
			authTimeout: "{ type: 'error', message: 'auth timeout' } — sent before connection is force-closed",
		},
		group: "Alerts",
		tables: ["alert_acks"],
		tables_actions: "Upsert",
		constraints: {
			criteria:
			[
				"Web Major Real-time features",
				"single connection handles both push and acknowledgment",
				"Auth message required within 5 seconds of connect (same pattern as /api/llm/analyze); on timeout, server sends 'error' frame then force-closes the connection",
				"ack frame calls the same service method as PUT /api/alerts/{id} then broadcasts 'status' frame to ALL connected sessions",
				"PUT /api/alerts/{id} REST endpoint retained for API-key clients; it also broadcasts via the in-memory WebSocketSession registry",
				"Acks are per-user: each user's read/ack state on an alert is tracked independently in alert_acks, not as a single shared status on the alert",
			],
			security:
			[
				"Any authenticated user may view and ack any alert — no per-service ownership scoping",
				"ack alert_id is validated to exist before insert/update on alert_acks; unknown id returns 'error' frame, no row written",
			],
			rateLimit: "10 req/min per session. Each ack = one request. Over-limit acks receive a 'rateLimited' error frame; connection stays open.",
			realtime:
				"In-memory WebSocketSession registry (per-instance, not distributed). Status changes broadcast to all authenticated sessions immediately. OTLP pipeline broadcasts into the same registry.",
			fallback:
				"On disconnect, client reconnects and re-authenticates; missed frames not replayed — client re-fetches via GET /api/alerts on reconnect",
			dedup: "None",
		},
		authStrategy: ["WS_AUTH_FRAME"],
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
				{ name: "period",  required: false, type: "string" },
				{ name: "service", required: false, type: "string" },
				{ name: "count",   required: false, type: "number" },
				{ name: "offset",  required: false, type: "number" },
			],
			body: null,
		},
		response:
		{
			200: "{ data: [{ id: '<uuid>', rule_id: '<uuid>', service: '<string>', triggered_at: '<iso8601>', llm_analysis: '<string>', my_ack: { status: acknowledged | resolved, acked_at: '<iso8601>' } | null }], hasMore: boolean }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_history", "alert_acks"],
		tables_actions: "Read",
		constraints: {
			criteria:
			[
				"Infinite scroll via offset pagination",
				"hasMore derived server-side: returned.length === count",
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
				{ name: "count",  required: false, type: "number" },
				{ name: "offset", required: false, type: "number" },
			],
			body: null,
		},
		response:
		{
			200: "{ data: [{ id: '<uuid>', service: '<string>', threshold: '<number>', severity: '<string>', enabled: boolean, is_default: boolean }], hasMore: boolean }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_rules"],
		tables_actions: "Read",
		constraints: {
			criteria: ["hasMore derived server-side: returned.length === count"],
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
				{ name: "service",   type: "string",  required: true },
				{ name: "threshold", type: "number",  required: true },
				{ name: "severity",  type: "string",  required: true },
				{ name: "enabled",   type: "boolean", required: true },
			],
		},
		response:
		{
			201: "{ id: '<uuid>', service: '<string>', threshold: '<number>', severity: '<string>', enabled: boolean, is_default: boolean }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_rules"],
		tables_actions: "Insert",
		constraints: {
			criteria:
			[
				"is_default is never client-settable; always false on rules created via this endpoint",
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
		method: "PUT",
		request:
		{
			query: [],
			body:
			[
				{ name: "enabled",   type: "boolean", required: false },
				{ name: "service",   type: "string",  required: false },
				{ name: "threshold", type: "number",  required: false },
				{ name: "severity",  type: "string",  required: false },
			],
		},
		response:
		{
			200: "{ id: '<uuid>', service: '<string>', threshold: '<number>', severity: '<string>', enabled: boolean, is_default: boolean }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' } | { error: 'cannot modify service, threshold, or severity on a default rule' }",
			404: "{ error: 'rule not found' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_rules"],
		tables_actions: "Update",
		constraints: {
			criteria: [
			   "If is_default: true on the target row, only 'enabled' may be changed — any other field in the request body returns 403",
			   "403 has two distinct causes that share one status code: caller lacks ADMIN role (role check, see Required Role) vs caller is ADMIN but targets a protected field on a default rule (business rule) — disambiguate by the error message, not the status code",
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
			403: "{ error: 'admin role required' } | { error: 'cannot delete a default rule' }",
			404: "{ error: 'rule not found' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_rules"],
		tables_actions: "Delete",
		constraints: {
			criteria: [
			   "If is_default: true on the target row, request is rejected with 403 — default rules cannot be deleted, only disabled via PUT { enabled: false }",
			   "403 has two distinct causes that share one status code: caller lacks ADMIN role (role check, see Required Role) vs caller is ADMIN but targets a default rule (business rule) — disambiguate by the error message, not the status code",
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
			200: "{ alert_id: '<uuid>', user_email: '<email>', status: acknowledged | resolved, acked_at: '<iso8601>' }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			404: "{ error: 'alert not found' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_acks"],
		tables_actions: "Upsert",
		constraints: {
			criteria: [
			   "Same service method as WebSocket ack",
			   "Upserts on (alert_id, user_email) — re-acking updates the caller's own record, does not create duplicates"
			],
			security: [
			   "Any authenticated user may ack any alert — no per-service ownership scoping; ack is scoped to the caller's own user_email, cannot ack on behalf of another user"
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

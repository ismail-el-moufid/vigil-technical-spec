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
			alert: "{ type: 'alert', data: { id: '<uuid>', rule_id: '<uuid> | null', service: '<string>', signal_type: logs | metrics | traces | null, metric_name: '<string>', aggregation: '<string> | null', window_seconds: '<number> | null', threshold: '<number> | null', severity: info | warning | critical, triggered_at: '<iso8601>', llm_analysis: '<string>' } } — metric_name/threshold/severity/signal_type/window_seconds/aggregation are columns on alert_history itself, copied from the matching alert_rules row at insert time (not a live join), so this frame's values stay fixed even if that rule is later edited or deleted; rule_id is null in two distinct cases, not one — (1) a silence-watchdog alert (fired when a service goes quiet for too long, with no alert_rules row ever behind it — metric_name is the fixed sentinel 'service_silent', severity is fixed 'critical', and signal_type/window_seconds/aggregation are all null since no single evaluator produced it), or (2) an ordinary rule-triggered alert whose originating alert_rules row has since been deleted — deleting a rule sets alert_history.rule_id to null (ON DELETE SET NULL) while leaving signal_type/window_seconds/aggregation populated, since those are snapshotted at insert time rather than live-joined. Clients must not treat rule_id === null as self-describing; branch on metric_name === 'service_silent' to distinguish case (1) from case (2)",
			llm: "{ type: 'llm', data: { id: '<uuid>', status: '<string>', llm_analysis: '<string>' } }",
			status: "{ type: 'status', data: { alert_id: '<uuid>', user_email: '<email>', status: acknowledged | resolved, acked_at: '<iso8601>' } } — user_email here is a display join against users.email at broadcast time, not the alert_acks storage key: alert_acks' actual primary key is (alert_id, user_id), keyed on the immutable users.id so a user changing their own email later can't orphan their ack history",
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
				"Token validated at the HTTP Upgrade via a HandshakeInterceptor — the token is passed as ?token= on the upgrade request (native WebSocket clients can't set an Authorization header any more than EventSource can) and the connection is rejected outright during the HTTP Upgrade if it's invalid or missing, so there's no post-connect auth window, no auth frame, and no auth-timeout error frame; on token expiry the client just reconnects with a fresh one, no mid-session re-auth frames",
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
			200: "{ data: [{ id: '<uuid>', rule_id: '<uuid> | null', service: '<string>', signal_type: logs | metrics | traces | null, metric_name: '<string>', aggregation: '<string> | null', window_seconds: '<number> | null', threshold: '<number> | null', severity: info | warning | critical, triggered_at: '<iso8601>', llm_analysis: '<string>', my_ack: { status: acknowledged | resolved, acked_at: '<iso8601>' } | null }], hasMore: boolean } — metric_name/threshold/severity/signal_type/window_seconds/aggregation are read straight off the alert_history row (they're columns on that table, copied from the matching alert_rules row at insert time), so no runtime join to alert_rules is needed to render them here; signal_type/window_seconds/aggregation are null for silence-watchdog alerts, same reasoning as ep-alerts-ws's alert frame",
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
			200: "{ data: [{ id: '<uuid>', service: '<string>', signal_type: logs | metrics | traces, metric_name: '<string>', aggregation: '<string> | null', window_seconds: '<number>', threshold: '<number>', severity: '<string>', enabled: boolean, is_default: boolean }], hasMore: boolean }",
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
				{
					text: "400 returned if count is present but non-numeric or outside 1-100, or offset is present but non-numeric or negative",
					refs: ["ep-alerts-list"],
				},
				{
					text: "Read grant is ADMIN_/_VIEWER while create/update/delete on this same table are ADMIN-only — confirmed intentional, not over-scoped: viewers need to see configured thresholds/severities on the Alerts page even though only admins may change them",
					refs: [
					   "ep-alert-rules-create",
					   "ep-alert-rules-update",
					   "ep-alert-rules-delete"
					],
				},
				{
					text: "Uses offset pagination, not the keyset/before pagination used on the telemetry endpoints and the alerts list — an accepted difference, not an oversight: alert_rules rows are created rarely (operator-configured thresholds) compared to continuously-inserted telemetry/alert rows, so the row-skip/duplicate drift keyset pagination exists to avoid is a negligible risk here",
					refs: [
					   "ep-telemetry-metrics",
					   "ep-telemetry-traces",
					   "ep-telemetry-logs",
					   "ep-alerts-list"
					],
				},
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
				{ name: "signal_type", type: "logs | metrics | traces", required: true },
				{
				   name: "metric_name",
				   type: {
				      text: "string — enum depends on signal_type: for logs, one of error_count | warning_count | critical_count | total_count; for traces, one of error_rate | span_count | avg_duration_ms | p50_duration_ms | p95_duration_ms | p99_duration_ms | max_duration_ms; for metrics, open vocabulary checked against the known attribute key list"
				   },
				   required: true
				},
				{
				   name: "aggregation",
				   type: "latest | avg | sum | min | max | count | p50 | p95 | p99 — required when signal_type = metrics, must be omitted when signal_type = logs | traces",
				   required: false
				},
				{ name: "window_seconds", type: "integer, minimum 10", required: true },
				{ name: "threshold",type: "number",  required: true },
				{ name: "severity", type: "info | warning | critical",  required: true },
				{ name: "enabled",  type: "boolean", required: true },
			],
		},
		response:
		{
			201: "{ id: '<uuid>', service: '<string>', signal_type: logs | metrics | traces, metric_name: '<string>', aggregation: '<string> | null', window_seconds: '<number>', threshold: '<number>', severity: '<string>', enabled: boolean, is_default: boolean }",
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
				"Rule triggers when the row's aggregate — computed per signal_type/metric_name/aggregation/window_seconds — is >= threshold at evaluation time — fixed direction, no comparison-operator choice. All three signal types now evaluate rules the same windowed-query way; the only difference between them is which ClickHouse table is queried and which metric_name/aggregation vocabulary applies",
				"400 returned if signal_type is present but not one of logs | metrics | traces",
				"400 returned if metric_name doesn't match the enum for the submitted signal_type: for logs, one of error_count | warning_count | critical_count | total_count; for traces, one of error_rate | span_count | avg_duration_ms | p50_duration_ms | p95_duration_ms | p99_duration_ms | max_duration_ms; for metrics, checked against the known attribute key list rather than a fixed enum, since metric names there are open-ended and OTel-exporter-defined",
				"400 returned if aggregation is missing or not one of latest | avg | sum | min | max | count | p50 | p95 | p99 when signal_type = metrics, or if aggregation is present at all when signal_type = logs | traces (aggregation is already encoded in metric_name's enum for those two signal types)",
				"400 returned if window_seconds is missing, non-numeric, non-integer, or less than 10",
				"Frontend may pre-fill this form from an existing rule's values (clone) — purely a frontend UX detail, no API shape change",
				"400 returned if severity is present but not one of info | warning | critical — same validation pattern as role on the users endpoints",
				"403 is returned when an authenticated caller lacks the ADMIN role — this endpoint's requiredRole is ADMIN, shown on the Role pill above",
				{
					text: "No dedup key: alert_rules carries no uniqueness constraint, and this endpoint does not check for an existing rule with matching service/signal_type/metric_name/aggregation before insert — a retried or double-submitted POST creates a second, functionally-identical row rather than erroring or upserting. Accepted scope decision for this project: unlike the users/webhooks create endpoints (DB-unique-constraint-backed 409) or the ingest endpoints (explicit hash-based dedup window), duplicate rule creation here is treated as user/client error, not guarded against server-side. An admin who creates a duplicate rule can remove it same as any other non-default rule",
					refs: ["ep-users-create", "ep-webhooks-create", "ep-alert-rules-delete"],
				},
			],
			security: [
				"Caller must hold ADMIN role (this endpoint's requiredRole, shown on the Role pill above); among admins there is no per-service ownership scoping — any admin may create a rule for any service"
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
				{
				   name: "metric_name",
				   type: {
				      text: "string — metric_name itself is editable; its valid values are constrained by the target row's immutable signal_type: for logs, one of error_count | warning_count | critical_count | total_count; for traces, one of error_rate | span_count | avg_duration_ms | p50_duration_ms | p95_duration_ms | p99_duration_ms | max_duration_ms; for metrics, checked against the known attribute key list rather than a fixed enum",
				      refs: ["ep-alert-rules-create"]
				   },
				   required: false
				},
				{
				   name: "aggregation",
				   type: "latest | avg | sum | min | max | count | p50 | p95 | p99 — only settable if the target row's signal_type = metrics",
				   required: false
				},
				{ name: "window_seconds", type: "integer, minimum 10", required: false },
				{ name: "threshold",type: "number",  required: false },
				{ name: "severity", type: "info | warning | critical",  required: false },
			],
		},
		response:
		{
			200: "{ id: '<uuid>', service: '<string>', signal_type: logs | metrics | traces, metric_name: '<string>', aggregation: '<string> | null', window_seconds: '<number>', threshold: '<number>', severity: '<string>', enabled: boolean, is_default: boolean }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required', code: 'ADMIN_REQUIRED' } | { error: 'cannot modify service, metric_name, aggregation, window_seconds, threshold, or severity on a default rule', code: 'DEFAULT_RULE_PROTECTED' }",
			404: "{ error: 'rule not found' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_rules"],
		tables_actions: { alert_rules: "Update" },
		constraints: {
			criteria: [
				"If is_default: true on the target row, only 'enabled' may be changed — any other field in the request body returns 403 (this already covers window_seconds/aggregation, both fall under 'any other field')",
				{
					text: "signal_type is immutable after creation, default rule or not — 400 returned if it's present in the request body at all, rather than silently ignoring it as an unrecognized field. A client that wants to change which evaluator owns a rule must delete and recreate it (subject to the is_default delete restriction)",
					refs: ["ep-alert-rules-delete"],
				},
				"400 returned if severity is present but not one of info | warning | critical",
				{
					text: "400 returned if metric_name is present but doesn't match the enum for the target row's (unchangeable) signal_type — same enums as on create",
					refs: ["ep-alert-rules-create"],
				},
				"400 returned if aggregation is present and the target row's signal_type is logs | traces (aggregation is only settable on metrics rules), or if aggregation is present but not one of the fixed enum when signal_type = metrics",
				"400 returned if window_seconds is present but non-numeric, non-integer, or less than 10",
				"Both 403 causes share the status code but carry distinct 'code' values (ADMIN_REQUIRED vs DEFAULT_RULE_PROTECTED) — clients should branch on 'code', not on the 'error' message text",
				"400 returned if the {id} path segment isn't a syntactically valid UUID — malformed path params are rejected the same way as malformed body fields above, not left to fall through to an unhandled 500 or a misleading 404",
			],
			security: [
				"Caller must hold ADMIN role (this endpoint's requiredRole, shown on the Role pill above); among admins there is no per-service ownership scoping — any admin may update any rule"
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
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required', code: 'ADMIN_REQUIRED' } | { error: 'cannot delete a default rule', code: 'DEFAULT_RULE_PROTECTED' }",
			404: "{ error: 'rule not found' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_rules", "alert_history"],
		tables_actions: {
			alert_rules: "Delete",
			alert_history: "Update (rule_id set to NULL on any referencing rows, via schema's ON DELETE SET NULL — not a separate application-level step)"
		},
		constraints: {
			criteria: [
				"If is_default: true on the target row, request is rejected with 403 — default rules cannot be deleted, only disabled via PATCH { enabled: false }",
				"Both 403 causes share the status code but carry distinct 'code' values (ADMIN_REQUIRED vs DEFAULT_RULE_PROTECTED) — clients should branch on 'code', not on the 'error' message text",
				"Deleting a non-default rule cascades into alert_history: every row whose rule_id referenced this rule has rule_id set to NULL (schema-level ON DELETE SET NULL). Those rows' snapshotted metric_name/threshold/severity/etc. are untouched — only rule_id changes. This produces the same null-rule_id shape as a silence-watchdog alert; consumers distinguish the two by metric_name, not rule_id — metric_name === 'service_silent' is the silence-watchdog case, any other metric_name with rule_id === null is this deleted-rule case",
				"400 returned if the {id} path segment isn't a syntactically valid UUID — malformed path params are rejected the same way as malformed query params or body fields elsewhere in this spec, not left to fall through to an unhandled 500 or a misleading 404",
			],
			security: [
				"Caller must hold ADMIN role (this endpoint's requiredRole, shown on the Role pill above); among admins there is no per-service ownership scoping — any admin may delete any rule"
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
				"This REST path and the WS ack frame have independent rate-limit buckets (10 req/min per-IP here vs 10 req/min per-session on the socket). Not a practical double-budget: the frontend only ever acks over its own already-open WebSocket connection — it holds a single long-lived socket per session for exactly this; this REST endpoint exists for API-key clients that aren't holding a socket open, so in normal use only one bucket is ever exercised per caller",
				"400 returned if the {id} path segment isn't a syntactically valid UUID, same as the existing 400 for a malformed status field — malformed path params get the same treatment as malformed body fields, not an unhandled 500 or a misleading 404",
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

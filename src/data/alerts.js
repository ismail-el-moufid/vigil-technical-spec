export const ALERT_ENDPOINTS =
[
	{
		"route": "/api/alerts/ws",
		"service": "Spring Boot + PostgreSQL",
		"owner": "Backend Lead",
		"method": "WS",
		"request": {
			"query": [
				{
					"name": "token",
					"type": "string",
					"required": true
				}
			],
			"ack": "{ type: 'ack', alert_id: '<uuid>', status: acknowledged | resolved | sent }",
			"notif": "{ type: 'notif', alert_id: '<uuid>', seen: <boolean> }"
		},
		"response": {
			"alert": "{ type: 'alert', data: { alert_history_id: '<uuid>', rule_id: '<uuid> | null', rule: { id: '<uuid>', service: '<string>', signal_type: logs | metrics | traces, metric_name: '<string>', aggregation: '<string> | null', window_seconds: <integer>, threshold: <number>, severity: info | warning | critical, enabled: <boolean>, is_default: <boolean> } | null, service: '<string>', signal_type: logs | metrics | traces | null, metric_name: '<string>', aggregation: '<string> | null', window_seconds: '<number> | null', threshold: '<number> | null', severity: info | warning | critical, triggered_at: '<iso8601>', llm_analysis: '<string> | null', status: sent | acknowledged | resolved, owner_id: '<uuid> | null', acked_at: '<iso8601> | null', acked_by: '<email> | null', resolved_at: '<iso8601> | null', resolved_by: '<email> | null', version: <integer> } }",
			"Notification": "{ type: 'Notification', data: { alert_history_id: '<uuid>', service: '<string>', triggered_at: '<iso8601>', signal_type: logs | metrics | traces | null, severity: info | warning | critical, seen: <boolean>, seen_at: '<iso8601> | null' } }",
			"llm": "{ type: 'llm', data: { id: '<uuid>', status: '<string>', llm_analysis: '<string>' } }",
			"error": "{ type: 'error', message: '<string>' }",
			"rateLimited": "{ type: 'error', message: 'rate limited; retry in <seconds> seconds' }"
		},
		"group": "Alerts",
		"tables": [
			"alert_history",
			"alert_notifications"
		],
		"tables_actions": {
			"alert_history": "Read + Update",
			"alert_notifications": "Read + Upsert"
		},
		"constraints": {
			"criteria": [
				"Single connection handles shared history actions, personal notification actions, and push delivery.",
				"Token validated at HTTP Upgrade by HandshakeInterceptor using ?token=. Load the current database user and current role; missing, invalid, expired or deleted-user credentials reject the upgrade. No post-connect auth frame or mid-session re-auth protocol is introduced.",
				"ack calls the same service method as PATCH /api/alerts/history/{id}?status=; notif calls the same service method as PUT /api/alerts/notifications/{historyId}?seen=. Re-check the current user and permissions for each client action. REST and socket updates produce the same corresponding broadcasts after commit.",
				"Shared history changes broadcast alert to all authenticated connected users. Notification is the case-sensitive wire value and goes only to recipient connected sessions.",
				"Validate UUID alert_id, existing history and status/seen. Ownership violations and optimistic-lock conflicts return an error frame without mutation or broadcast.",
				"History status is shared by every user, independently of each recipient notification seen state. New history starts sent with owner_id, acked_at, acked_by, resolved_at and resolved_by null, and version 0.",
				"Only the acknowledging owner may change a history row while owner_id is non-null; other authenticated callers receive 403, with no administrator bypass. Resolve caller identity from authentication, never from a supplied owner or actor email.",
				"Acknowledging unowned history claims owner_id for the caller. Re-acknowledging by the owner resets acked_at to now and snapshots the current email in acked_by; status becomes acknowledged and resolved_at/resolved_by are cleared. The owner can resolve or re-acknowledge an owned record, including a previously resolved record.",
				"Unowned history may be resolved directly without acknowledging first: set status resolved, resolved_at now and resolved_by to the caller email; leave owner_id and acknowledgment fields unchanged. Resolving owned history preserves acknowledgment/ownership fields. Returning to sent reopens history and clears owner_id and all acknowledgment/resolution fields; owned history may only be reopened by its owner.",
				"Persist history transitions with optimistic locking on the database version field; increment version on successful updates. Concurrent conflicting writes may return 409. No client version parameter or request body is required. Do not broadcast failed or rolled-back changes.",
				"Deleting an owner sets owner_id to null without deleting history or clearing status, action timestamps or recorded actor emails. Actor emails are snapshots, not read-time joins to users.email.",
				"Notifications are independent per-user seen state keyed by (user_id, alert_history_id); shared history status and ownership do not affect notification visibility. Resolve user_id from authentication, never client input.",
				"First marking seen sets seen_at to now; repeating seen=true preserves the existing seen_at. Marking seen=false clears seen_at. Updates can create a missing caller notification for existing history, including seen=false with seen_at=null.",
				"Unknown history returns 404 without creating a row. Malformed historyId or missing/invalid seen returns 400. Boolean seen accepts true | false only.",
				"Commit the notification update before broadcasting Notification only to all connected sessions of that recipient; never broadcast personal seen state to other users. No public POST notification endpoint exists."
			],
			"security": [
				"Any authenticated ADMIN or VIEWER may read shared history; owned changes require the acknowledging owner. Notification actions affect only the caller."
			],
			"rateLimit": "10 req/min per session. Each ack or notif action = one request. Over-limit actions receive a rateLimited error frame; connection stays open.",
			"realtime": "In-memory WebSocketSession registry (per-instance, not distributed). Shared alert updates go to all users; Notification updates go only to recipient sessions. OTLP-triggered alerts use the same registry.",
			"fallback": "Reconnect and re-authenticate; missed frames are not replayed. Re-fetch GET /api/alerts and GET /api/alerts/notifications.",
			"dedup": "None"
		},
		"authStrategy": [
			"WS_AUTH_HANDSHAKE"
		],
		"requiredRole": "ADMIN_/_VIEWER",
		"id": "ep-alerts-ws"
	},
	{
		"route": "/api/alerts",
		"service": "Spring Boot + PostgreSQL",
		"owner": "Backend Lead",
		"method": "GET",
		"request": {
			"query": [
				{
					"name": "period",
					"type": "string",
					"required": false
				},
				{
					"name": "service",
					"type": "string",
					"required": false
				},
				{
					"name": "count",
					"type": "number",
					"required": false
				},
				{
					"name": "before",
					"type": "string (ISO8601 — triggered_at of oldest history already loaded)",
					"required": false
				}
			],
			"body": null
		},
		"response": {
			"200": "{ data: [{ id: '<uuid>', rule_id: '<uuid> | null', rule: { id: '<uuid>', service: '<string>', signal_type: logs | metrics | traces, metric_name: '<string>', aggregation: '<string> | null', window_seconds: <integer>, threshold: <number>, severity: info | warning | critical, enabled: <boolean>, is_default: <boolean> } | null, service: '<string>', signal_type: logs | metrics | traces | null, metric_name: '<string>', aggregation: '<string> | null', window_seconds: '<number> | null', threshold: '<number> | null', severity: info | warning | critical, triggered_at: '<iso8601>', llm_analysis: '<string> | null', status: sent | acknowledged | resolved, owner_id: '<uuid> | null', acked_at: '<iso8601> | null', acked_by: '<email> | null', resolved_at: '<iso8601> | null', resolved_by: '<email> | null', version: <integer> }], has_more: boolean }",
			"400": "{ message: '<validation message>' }",
			"401": "{ message: 'unauthorized' }",
			"429": "{ message: 'rate limited; retry in <seconds> seconds' }",
			"500": "{ message: 'server error' }"
		},
		"group": "Alerts",
		"tables": [
			"alert_history",
			"alert_rules"
		],
		"tables_actions": {
			"alert_history": "Read",
			"alert_rules": "Read (rule object)"
		},
		"constraints": {
			"criteria": [
				"Infinite scroll uses keyset pagination on triggered_at, not offset. count defaults to 20; fetch count + 1 rows, return at most count, and set has_more only when the additional row exists.",
				"400 for non-numeric count or values outside 1-100, or invalid ISO8601 before.",
				"Expose shared status, owner_id, action timestamps, snapshotted actor emails and version. Fetch personal notification seen state separately.",
				"History metric_name/threshold/severity/signal_type/window_seconds/aggregation remain evaluation-time snapshots. rule is the current associated rule object, null for watchdog history or a deleted rule. metric_name=service_silent distinguishes watchdog history from deleted-rule history, not rule_id=null alone."
			],
			"security": [
				"Any authenticated user may view any shared history; no per-service ownership scoping for reads."
			],
			"rateLimit": "10 req/min",
			"realtime": "Shared history changes arrive as alert broadcasts on /api/alerts/ws.",
			"fallback": "None",
			"dedup": "None"
		},
		"authStrategy": [
			"JWT",
			"API_KEY"
		],
		"requiredRole": "ADMIN_/_VIEWER",
		"id": "ep-alerts-list"
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
			200: "{ data: [{ id: '<uuid>', service: '<string>', signal_type: logs | metrics | traces, metric_name: '<string>', aggregation: '<string> | null', window_seconds: '<number>', threshold: '<number>', severity: '<string>', enabled: boolean, is_default: boolean }], has_more: boolean }",
			400: "{ message: '<validation message>' }",
			401: "{ message: 'unauthorized' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
		},
		group: "Alerts",
		tables: ["alert_rules"],
		tables_actions: { alert_rules: "Read" },
		constraints: {
			criteria: [
				"count defaults to 20 when omitted; fetch count + 1 rows, return at most count; has_more is true only when the additional row exists",
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
				{ name: "service", type: "string", required: true },
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
			400: "{ message: '<validation message>' }",
			401: "{ message: 'unauthorized' }",
			403: "{ message: 'admin role required' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
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
					text: "No dedup key: alert_rules carries no uniqueness constraint, and this endpoint does not check for an existing rule with matching service/signal_type/metric_name/aggregation before insert — a retried or double-submitted POST creates a second, functionally-identical row rather than erroring or upserting. Accepted scope decision for this project: unlike the users/webhooks create endpoints (DB-unique-constraint-backed 409), duplicate rule creation here is treated as user/client error, not guarded against server-side. An admin who creates a duplicate rule can remove it same as any other non-default rule",
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
			400: "{ message: '<validation message>' }",
			401: "{ message: 'unauthorized' }",
			403: "{ message: 'admin role required' } | { message: 'cannot modify service, metric_name, aggregation, window_seconds, threshold, or severity on a default rule' }",
			404: "{ message: 'rule not found' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
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
				"Both 403 causes share the status code but return different JSON message values; there is no structured error code",
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
			400: "{ message: '<validation message>' }",
			401: "{ message: 'unauthorized' }",
			403: "{ message: 'admin role required' } | { message: 'cannot delete a default rule' }",
			404: "{ message: 'rule not found' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
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
				"Both 403 causes share the status code but return different JSON message values; there is no structured error code",
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
		"route": "/api/alerts/history/{id}",
		"service": "Spring Boot + PostgreSQL",
		"owner": "Backend Lead",
		"method": "PATCH",
		"request": {
			"query": [
				{
					"name": "status",
					"type": "sent | acknowledged | resolved",
					"required": true
				}
			],
			"body": null
		},
		"response": {
			"200": "{ id: '<uuid>', rule_id: '<uuid> | null', rule: { id: '<uuid>', service: '<string>', signal_type: logs | metrics | traces, metric_name: '<string>', aggregation: '<string> | null', window_seconds: <integer>, threshold: <number>, severity: info | warning | critical, enabled: <boolean>, is_default: <boolean> } | null, service: '<string>', signal_type: logs | metrics | traces | null, metric_name: '<string>', aggregation: '<string> | null', window_seconds: '<number> | null', threshold: '<number> | null', severity: info | warning | critical, triggered_at: '<iso8601>', llm_analysis: '<string> | null', status: sent | acknowledged | resolved, owner_id: '<uuid> | null', acked_at: '<iso8601> | null', acked_by: '<email> | null', resolved_at: '<iso8601> | null', resolved_by: '<email> | null', version: <integer> }",
			"400": "{ message: '<validation message>' }",
			"401": "{ message: 'unauthorized' }",
			"429": "{ message: 'rate limited; retry in <seconds> seconds' }",
			"500": "{ message: 'server error' }",
			"403": "{ message: 'only the acknowledging owner may change this history' }",
			"404": "{ message: 'alert not found' }",
			"409": "{ message: 'conflicting history update' }"
		},
		"group": "Alerts",
		"tables": [
			"alert_history",
			"alert_rules"
		],
		"tables_actions": {
			"alert_history": "Read + Update",
			"alert_rules": "Read (rule object)"
		},
		"constraints": {
			"criteria": [
				"History status is shared by every user, independently of each recipient notification seen state. New history starts sent with owner_id, acked_at, acked_by, resolved_at and resolved_by null, and version 0.",
				"Only the acknowledging owner may change a history row while owner_id is non-null; other authenticated callers receive 403, with no administrator bypass. Resolve caller identity from authentication, never from a supplied owner or actor email.",
				"Acknowledging unowned history claims owner_id for the caller. Re-acknowledging by the owner resets acked_at to now and snapshots the current email in acked_by; status becomes acknowledged and resolved_at/resolved_by are cleared. The owner can resolve or re-acknowledge an owned record, including a previously resolved record.",
				"Unowned history may be resolved directly without acknowledging first: set status resolved, resolved_at now and resolved_by to the caller email; leave owner_id and acknowledgment fields unchanged. Resolving owned history preserves acknowledgment/ownership fields. Returning to sent reopens history and clears owner_id and all acknowledgment/resolution fields; owned history may only be reopened by its owner.",
				"Persist history transitions with optimistic locking on the database version field; increment version on successful updates. Concurrent conflicting writes may return 409. No client version parameter or request body is required. Do not broadcast failed or rolled-back changes.",
				"Deleting an owner sets owner_id to null without deleting history or clearing status, action timestamps or recorded actor emails. Actor emails are snapshots, not read-time joins to users.email.",
				"Same service method as WebSocket ack. Return updated history including its associated rule object, null when absent, not a personal acknowledgment record.",
				"400 for malformed UUID id or missing/invalid status; status is a required query parameter, not a body field. REST and WebSocket retain their independent existing rate-limit buckets."
			],
			"security": [
				"Authenticated ADMIN or VIEWER; only acknowledging owner may change owned history. Unowned history may be acknowledged, directly resolved or reopened."
			],
			"rateLimit": "10 req/min",
			"realtime": "After commit broadcast updated shared-history alert to all connected users, identical to successful WebSocket ack actions.",
			"fallback": "None",
			"dedup": "None"
		},
		"authStrategy": [
			"JWT",
			"API_KEY"
		],
		"requiredRole": "ADMIN_/_VIEWER",
		"id": "ep-alert-history-update"
	},
	{
		"route": "/api/alerts/notifications",
		"service": "Spring Boot + PostgreSQL",
		"owner": "Backend Lead",
		"method": "GET",
		"request": {
			"query": [
				{
					"name": "count",
					"type": "number (default 20)",
					"required": false
				},
				{
					"name": "before",
					"type": "string (ISO8601 — triggered_at of oldest notification history already loaded)",
					"required": false
				}
			],
			"body": null
		},
		"response": {
			"200": "{ notifications: [{ alert_history_id: '<uuid>', service: '<string>', triggered_at: '<iso8601>', signal_type: logs | metrics | traces | null, severity: info | warning | critical, seen: <boolean>, seen_at: '<iso8601> | null' }], has_more: boolean }",
			"400": "{ message: '<validation message>' }",
			"401": "{ message: 'unauthorized' }",
			"429": "{ message: 'rate limited; retry in <seconds> seconds' }",
			"500": "{ message: 'server error' }"
		},
		"group": "Alerts",
		"tables": [
			"alert_notifications",
			"alert_history"
		],
		"tables_actions": {
			"alert_notifications": "Read (caller only)",
			"alert_history": "Read (notification metadata)"
		},
		"constraints": {
			"criteria": [
				"Return only authenticated user notifications, joined to history for service/trigger/signal/severity metadata. Shared history status and ownership never filter personal notification visibility.",
				"Order by history triggered_at descending; before uses that timestamp for keyset pagination. count defaults to 20 and accepts 1-100; malformed count/before returns 400. Fetch count + 1 rows, return at most count; has_more is true only when the additional row exists."
			],
			"security": [
				"Authenticated ADMIN or VIEWER; never expose another recipient notifications."
			],
			"rateLimit": "10 req/min",
			"realtime": "Recipient-only Notification broadcasts on /api/alerts/ws.",
			"fallback": "None",
			"dedup": "None"
		},
		"authStrategy": [
			"JWT",
			"API_KEY"
		],
		"requiredRole": "ADMIN_/_VIEWER",
		"id": "ep-alert-notifications-list"
	},
	{
		"route": "/api/alerts/notifications/{historyId}",
		"service": "Spring Boot + PostgreSQL",
		"owner": "Backend Lead",
		"method": "PUT",
		"request": {
			"query": [
				{
					"name": "seen",
					"type": "boolean (true | false)",
					"required": true
				}
			],
			"body": null
		},
		"response": {
			"200": "{ alert_id: '<uuid>', seen: <boolean>, seen_at: '<iso8601> | null' }",
			"400": "{ message: '<validation message>' }",
			"401": "{ message: 'unauthorized' }",
			"429": "{ message: 'rate limited; retry in <seconds> seconds' }",
			"500": "{ message: 'server error' }",
			"404": "{ message: 'alert not found' }"
		},
		"group": "Alerts",
		"tables": [
			"alert_notifications",
			"alert_history"
		],
		"tables_actions": {
			"alert_notifications": "Upsert (caller only)",
			"alert_history": "Read (existence and broadcast metadata)"
		},
		"constraints": {
			"criteria": [
				"Notifications are independent per-user seen state keyed by (user_id, alert_history_id); shared history status and ownership do not affect notification visibility. Resolve user_id from authentication, never client input.",
				"First marking seen sets seen_at to now; repeating seen=true preserves the existing seen_at. Marking seen=false clears seen_at. Updates can create a missing caller notification for existing history, including seen=false with seen_at=null.",
				"Unknown history returns 404 without creating a row. Malformed historyId or missing/invalid seen returns 400. Boolean seen accepts true | false only.",
				"Commit the notification update before broadcasting Notification only to all connected sessions of that recipient; never broadcast personal seen state to other users. No public POST notification endpoint exists.",
				"Same service method as WebSocket notif. Atomic upsert keyed by caller user_id and alert_history_id preserves first seen_at across concurrent seen=true requests."
			],
			"security": [
				"Authenticated ADMIN or VIEWER; modifies only caller notification independently of shared history status or ownership."
			],
			"rateLimit": "10 req/min",
			"realtime": "After commit send Notification only to recipient connected sessions, identical to successful WebSocket notif actions.",
			"fallback": "None",
			"dedup": "Composite key (user_id, alert_history_id); repeated seen=true preserves seen_at."
		},
		"authStrategy": [
			"JWT",
			"API_KEY"
		],
		"requiredRole": "ADMIN_/_VIEWER",
		"id": "ep-alert-notification-update"
	},
];

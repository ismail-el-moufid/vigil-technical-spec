const RATE = "JWT: 60/min per user + method + exact URI; ApiKey: shared 10/min per IP";
const ERRORS = {
	400: "{ message: '<validation message>' }",
	401: "{ message: '<authentication failure message>' }",
	429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
};
const RULE = "{ id: '<uuid>', service, signal_type: logs | metrics | traces, metric_name, aggregation: string | null, window_seconds: integer, threshold: number, severity: info | warning | critical, enabled: boolean }";
const HISTORY = `{ id: '<uuid>', rule_id: uuid | null, rule: ${RULE} | null, service, signal_type: logs | metrics | traces | null, metric_name, aggregation: string | null, window_seconds: integer | null, threshold: number | null, severity: info | warning | critical, triggered_at, llm_analysis: string | null, status: sent | acknowledged | resolved, owner_id: uuid | null, acked_at: timestamp | null, acked_by: email | null, resolved_at: timestamp | null, resolved_by: email | null, version: integer }`;
const NOTIFICATION = "{ alert_history_id: '<uuid>', service, triggered_at, metric_name, signal_type: logs | metrics | traces | null, severity: info | warning | critical, seen: boolean, seen_at: timestamp | null }";
const STATUS_DELTA = "{ alert_history_id: '<uuid>', status: sent | acknowledged | resolved, acked_at: timestamp | null, acked_by: email | null, resolved_at: timestamp | null, resolved_by: email | null }";
const HISTORY_CRITERIA = [
	"Shared history status is independent of personal recipient seen state. New history starts sent with no owner/action timestamps/actor emails and database version 0. Authenticated admins/viewers may view all history; ownership gates changes, not reads.",
	"Acknowledging unowned history claims the caller; re-acknowledging by the owner resets acked_at and snapshots the caller email, clears resolution fields and sets acknowledged. Owned acknowledged/resolved history cannot be reopened/re-acknowledged by others; resolving any owned history requires its owner, with no admin bypass.",
	"Unowned history can be resolved directly: set resolved_at/resolved_by, preserving acknowledgment/ownership. Returning to sent clears owner and all action timestamps/emails. Actor emails are snapshots, not read-time joins; deleting an owner sets the user reference null without deleting history or actor snapshots.",
	"AlertHistory uses @Version optimistic locking; conflicting flushes can return 409 { message: 'resource is being used by another user' }. No client version/body parameter is required. Implementation gap: AlertsService broadcasts status/notification changes inside its transaction, before commit; failed commits can already have emitted frames. After-commit delivery remains planned.",
	"PATCH DTO and action broadcasts are not full GET-history rows: PATCH omits rule_id, owner_id and version; its nested rule is the AlertRules entity. Action WS alert data only contains alert_history_id/status/acked_at/acked_by/resolved_at/resolved_by. Consumers must merge or refetch rather than replacing full records with deltas.",
];
const NOTIFICATION_CRITERIA = [
	"Notifications are per-user seen state keyed by (user_id, alert_history_id), independent of shared history ownership/status. Resolve user from authentication. Existing history with no caller notification creates a row; nonexistent history returns 404.",
	"seen=true preserves the original seen_at on sequential repeats; seen=false clears seen_at. Implemented as find/create + saveAndFlush, not an atomic database upsert. Concurrent creation can conflict on the composite key; concurrent first-seen requests have no explicit first-timestamp protection.",
	"REST and WS notif use the same service. Notification goes only to that recipient's connected sessions and includes metric_name. Implementation gap: broadcast is inside the transaction, not an after-commit hook. No public POST notification endpoint exists.",
];
const METRIC_NAMES = "logs: error_count | warning_count | critical_count | total_count; traces: error_rate | span_count | avg_duration_ms | p50_duration_ms | p95_duration_ms | p99_duration_ms | max_duration_ms; metrics: arbitrary nonblank metric name (DB membership validation is TODO)";
const AGGREGATIONS = "latest | avg | sum | min | max | count | p50 | p95 | p99";

export const ALERT_ENDPOINTS =
[
	{
		route: "/api/alerts/ws", service: "Spring Boot + PostgreSQL", owner: "Backend Lead", method: "WS",
		request: {
			query: [{ name: "token", type: "JWT access token (API key unsupported)", required: true }],
			ack: "{ type: 'ack', alert_id: '<uuid>', status: acknowledged | resolved | sent }",
			notif: "{ type: 'notif', alert_id: '<uuid>', seen: boolean }",
		},
		response: {
			alert: `{ type: 'alert', data: ${HISTORY.replace("id:", "alert_history_id:")} }`,
			alertUpdate: `{ type: 'alert', data: ${STATUS_DELTA} }`,
			Notification: `{ type: 'Notification', data: ${NOTIFICATION} }`,
			llm: "{ type: 'llm', data: { id: '<uuid>', status, llm_analysis } }",
			error: "{ type: 'error', message: '<string>' }",
			rateLimited: "{ type: 'error', message: 'rate limited. Try again in <seconds> seconds.' }",
		},
		group: "Alerts", tables: ["alert_history", "alert_notifications", "users"],
		tables_actions: { alert_history: "Read + Update", alert_notifications: "Read + Insert/Update", users: "Read (handshake/actions)" },
		constraints: {
			criteria: [
				"Implemented by MyHandShake/AlertSocketHandler/AlertSessionRegistry. Single connection receives trigger alerts, partial history changes, recipient-only case-sensitive Notification and llm frames. Invalid/missing/expired JWT or missing user rejects handshake with 401; interceptor writes no JSON body.",
				"ack/notif reload the current user and call the same AlertsService methods as REST. No per-push reauthentication, expiry timer or deleted-user session eviction is implemented. Invalid UUID/JSON/missing fields send error frames; unknown action currently says type must be ack. Missing history is invalid ack; uncaught ownership/optimistic-lock failures currently surface as socket error, not a structured status code.",
				...HISTORY_CRITERIA, ...NOTIFICATION_CRITERIA,
			],
			security: ["JWT handshake only. Shared alerts/llm push to all registered sessions; personal Notification frames only to matching userId."],
			rateLimit: "Opening GET uses the HTTP policy: JjwtAuthFilter authenticates the query JWT before RateLimiter, so a valid query token uses 60/min per user + GET + exact URI. Missing credentials use a per-IP 60/min bucket before handshake rejection; supplied ApiKey uses the shared 10/min IP budget but does not replace the handshake's required query JWT. each connection has a separate capacity-10 bucket refilled every 60s. Every incoming text frame consumes a token, including malformed input. Over-limit error keeps connection open.",
			realtime: "Per-instance in-memory registry; trigger alert is a full snapshot, manual status-change alert is a delta, and llm is a separate partial update.",
			fallback: "No replay. Frontend reconnect invalidates alert-history and notification queries; fetch GET /api/alerts and GET /api/alerts/notifications to recover.", dedup: "None",
		},
		authStrategy: ["WS_AUTH_HANDSHAKE"], requiredRole: "ADMIN_/_VIEWER", id: "ep-alerts-ws",
	},
	{
		route: "/api/alerts", service: "Spring Boot + PostgreSQL", owner: "Backend Lead", method: "GET",
		request: { query: [
			{ name: "period", type: "1h | 24h | 7d | 30d (omitted = all)", required: false },
			{ name: "service", type: "string (exact match)", required: false },
			{ name: "count", type: "integer 1-100 (default 20)", required: false },
			{ name: "before", type: "ISO8601 triggered_at cursor", required: false },
		], body: null },
		response: { 200: `{ data: [${HISTORY}], has_more: boolean }`, ...ERRORS },
		group: "Alerts", tables: ["alert_history", "alert_rules"], tables_actions: { alert_history: "Read", alert_rules: "Read (current associated rule)" },
		constraints: {
			criteria: [
				"count defaults to 20, accepts 1-100; fetch count + 1 rows, return at most count and set has_more only when the extra row exists. Infinite scroll uses an exclusive triggered_at keyset cursor, not offset; equal-timestamp rows have no ID tie-breaker and can be skipped across pages. Invalid period/count/before returns 400. Unlike telemetry pages, this DTO uses snake_case has_more.",
				"History metric_name/threshold/severity/signal_type/window_seconds/aggregation are trigger-time snapshots. rule is the current associated rule or null for deleted rules/watchdog history. metric_name=service_silent distinguishes watchdog history, not null rule_id alone. GET includes owner_id and version even though PATCH/action broadcasts omit them.",
				"No by-ID GET endpoint exists. Frontend deep links use ?alert=<uuid> and load history pages until the target is found; webhook links currently use ?id= instead (known mismatch).",
			], security: ["Any authenticated admin/viewer can read shared history; no per-service read ownership."], rateLimit: RATE, realtime: "Shared alert and llm WS frames", fallback: "None", dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-alerts-list",
	},
	{
		route: "/api/alerts/rules", service: "Spring Boot + PostgreSQL", owner: "Backend Lead", method: "GET",
		request: { query: [{ name: "count", type: "integer 1-100 (default 20)", required: false }, { name: "offset", type: "integer >= 0 (default 0)", required: false }], body: null },
		response: { 200: `{ data: [${RULE}], has_more: boolean }`, ...ERRORS },
		group: "Alerts", tables: ["alert_rules"], tables_actions: { alert_rules: "Read" },
		constraints: {
			criteria: ["Implemented offset pagination: fetch count + 1, return at most count, has_more indicates an additional row. count defaults to 20 and accepts 1-100; offset must be nonnegative. Backend permits viewers to read rules, but the current /alert-rules frontend route is admin-only."],
			security: ["Admin/viewer read; mutations are admin-only."], rateLimit: RATE, realtime: "None", fallback: "None", dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-alert-rules-list",
	},
	{
		route: "/api/alerts/rules", service: "Spring Boot + PostgreSQL", owner: "Backend Lead", method: "POST",
		request: { query: [], body: [
			{ name: "service", type: "nonblank string", required: true },
			{ name: "signal_type", type: "logs | metrics | traces", required: true },
			{ name: "metric_name", type: METRIC_NAMES, required: true },
			{ name: "aggregation", type: `${AGGREGATIONS} (required for metrics; null/omitted for logs/traces)`, required: false },
			{ name: "window_seconds", type: "integer, minimum 10", required: true },
			{ name: "threshold", type: "number", required: true },
			{ name: "severity", type: "info | warning | critical", required: true },
			{ name: "enabled", type: "boolean", required: true },
		] },
		response: { 201: RULE, ...ERRORS, 403: "{ message: 'access denied' }" },
		group: "Alerts", tables: ["alert_rules"], tables_actions: { alert_rules: "Insert" },
		constraints: {
			criteria: [
				"Unknown JSON fields are rejected. DTO validates required fields/window; AlertsService validates log/trace metric-name enums and metrics aggregation enum. For logs/traces aggregation=null is accepted, not rejected merely because a JSON key exists.",
				"Metrics names are open vocabulary: backend membership validation is TODO, not an implemented attributes check. Frontend currently offers attributes.key options, although the evaluator filters metrics.name; these are different namespaces.",
				"Windowed aggregate >= threshold triggers only when no existing history for that rule has status sent or acknowledged. A resolved alert permits a later trigger; there is no automatic rule recovery/resolution.",
				"No uniqueness/dedup guard on rule creation: retries can create duplicate rules. Backend threshold is only non-null; no additional range or comparison-operator contract is enforced.",
			], security: ["Any admin may create a rule for any service."], rateLimit: RATE, realtime: "None", fallback: "None", dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN", id: "ep-alert-rules-create",
	},
	{
		route: "/api/alerts/rules/{id}", service: "Spring Boot + PostgreSQL", owner: "Backend Lead", method: "PATCH",
		request: { query: [], body: [
			{ name: "enabled", type: "boolean", required: false }, { name: "service", type: "nonempty string", required: false },
			{ name: "metric_name", type: `${METRIC_NAMES}; PATCH metrics also accepts blank strings (validation gap)`, required: false }, { name: "aggregation", type: AGGREGATIONS, required: false },
			{ name: "window_seconds", type: "integer, minimum 10", required: false }, { name: "threshold", type: "number", required: false }, { name: "severity", type: "info | warning | critical", required: false },
		] },
		response: { 200: RULE, ...ERRORS, 403: "{ message: 'access denied' }", 404: "{ message: 'No alert rule with id: <id>' }" },
		group: "Alerts", tables: ["alert_rules"], tables_actions: { alert_rules: "Update" },
		constraints: {
			criteria: ["signal_type is absent from the patch DTO and unknown fields return 400; delete/recreate to change evaluator. Null fields are treated as omitted, so empty/null-only patches are no-ops and aggregation cannot be cleared by null.", "Validate metric_name/aggregation against the immutable signal_type when either is changed. Metrics DB-name validation remains TODO. Malformed UUID/enum/window returns 400. PATCH metric_name has no @NotBlank constraint: for metrics, empty/whitespace names pass the service's aggregation-only validation; logs/traces still require the closed enum. PATCH service uses @Pattern('.+'), not @NotBlank, so whitespace-only values can pass."],
			security: ["Any admin may update any rule; no per-service scope."], rateLimit: RATE, realtime: "None", fallback: "None", dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN", id: "ep-alert-rules-update",
	},
	{
		route: "/api/alerts/rules/{id}", service: "Spring Boot + PostgreSQL", owner: "Backend Lead", method: "DELETE",
		request: { query: [], body: null }, response: { 204: "Empty response", ...ERRORS, 403: "{ message: 'access denied' }", 404: "{ message: 'Invalid alert rule with id: <id>' }" },
		group: "Alerts", tables: ["alert_rules", "alert_history"], tables_actions: { alert_rules: "Delete", alert_history: "Set rule reference NULL; preserve snapshots" },
		constraints: { criteria: ["Deleting a rule preserves history and snapshots while setting its rule reference null. Malformed UUID returns 400."], security: ["Admin only."], rateLimit: RATE, realtime: "None", fallback: "None", dedup: "None" },
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN", id: "ep-alert-rules-delete",
	},
	{
		route: "/api/alerts/history/{id}", service: "Spring Boot + PostgreSQL", owner: "Backend Lead", method: "PATCH",
		request: { query: [{ name: "status", type: "sent | acknowledged | resolved", required: true }], body: null },
		response: {
			200: `{ id: '<uuid>', rule: ${RULE} | null, service, triggered_at, metric_name, signal_type, window_seconds, aggregation, threshold, severity, llm_analysis, status, acked_at, resolved_at, acked_by, resolved_by }`,
			...ERRORS, 403: "{ message: 'forbidden' } | { message: 'not the acknowledging user' }", 404: "{ message: 'No alert history with id: <id>' }", 409: "{ message: 'resource is being used by another user' }",
		},
		group: "Alerts", tables: ["alert_history", "alert_rules"], tables_actions: { alert_history: "Read + Update", alert_rules: "Read (rule entity)" },
		constraints: { criteria: HISTORY_CRITERIA, security: ["Admin/viewer; owned changes require the acknowledging owner."], rateLimit: RATE, realtime: `Inside the transaction sends { type: 'alert', data: ${STATUS_DELTA} } to all registered sessions. Not the full trigger snapshot.`, fallback: "Refetch GET history to recover full owner/version data", dedup: "None" },
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-alert-history-update",
	},
	{
		route: "/api/alerts/notifications", service: "Spring Boot + PostgreSQL", owner: "Backend Lead", method: "GET",
		request: { query: [{ name: "count", type: "integer 1-100 (default 20)", required: false }, { name: "before", type: "ISO8601 history triggered_at cursor", required: false }], body: null },
		response: { 200: `{ notifications: [${NOTIFICATION}], has_more: boolean }`, ...ERRORS },
		group: "Alerts", tables: ["alert_notifications", "alert_history"], tables_actions: { alert_notifications: "Read (caller only)", alert_history: "Read (service/trigger/metric/signal/severity)" },
		constraints: { criteria: ["Only the caller's notifications, ordered by history triggered_at descending. count defaults to 20 and accepts 1-100; fetch count + 1, return at most count, set has_more only when an extra row exists. Shared status/ownership does not hide notifications. The exclusive timestamp-only cursor has no ID tie-breaker, so equal-trigger-time notifications can be skipped across pages. metric_name is included alongside service/trigger/signal/severity."], security: ["Admin/viewer; never another recipient's state."], rateLimit: RATE, realtime: "Recipient-only Notification WS frames", fallback: "None", dedup: "None" },
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-alert-notifications-list",
	},
	{
		route: "/api/alerts/notifications/{historyId}", service: "Spring Boot + PostgreSQL", owner: "Backend Lead", method: "PUT",
		request: { query: [{ name: "seen", type: "boolean (Spring query-boolean conversion)", required: true }], body: null },
		response: { 200: "{ alert_id: '<uuid>', seen: boolean, seen_at: timestamp | null }", ...ERRORS, 404: "{ message: 'no alert history with id : <id>' }", 409: "{ message: 'resource already exists' }" },
		group: "Alerts", tables: ["alert_notifications", "alert_history"], tables_actions: { alert_notifications: "Read + Insert/Update (caller only)", alert_history: "Read (existence and broadcast metadata)" },
		constraints: { criteria: NOTIFICATION_CRITERIA, security: ["Admin/viewer; no supplied recipient ID."], rateLimit: RATE, realtime: "Recipient-only Notification inside the service transaction", fallback: "None", dedup: "Composite key uniqueness; sequential seen=true retains first seen_at, not concurrency-safe atomic upsert" },
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-alert-notification-update",
	},
];

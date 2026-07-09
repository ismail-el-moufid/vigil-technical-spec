// Internal-port endpoints omit requiredRole on purpose — access here is
// gated by network isolation (see authStrategy: INTERNAL_ONLY), not by a
// role check, so there's no role value to report. ROLE_ENFORCEMENT_INFO in
// gateway.js documents the ADMIN / ADMIN_/_VIEWER / NO_AUTH tiers that apply
// to reachable endpoints only.
//
// Routes live under /internal/ingest/v1/* rather than /internal/otlp/v1/* —
// the payload shape below is a flat, project-specific body, not the real
// OTLP wire format, so the route name no longer implies a protocol it
// doesn't speak. Whatever sits in front of this (a real OTel Collector with
// a custom exporter, or a thin pusher) is responsible for producing this
// exact shape.
//
// "service" below is Spring Boot's own name for all three ingest endpoints
// plus /internal/llm/forward's caller — this is the SAME Spring Boot
// deployable as the public API, exposing a second, network-isolated
// connector, not a separate microservice. That's what makes sharing the
// in-memory WebSocketSession registry with ep-alerts-ws (alerts.js) valid;
// a genuinely separate process couldn't reach that in-memory registry
// without a message bus, which isn't part of this design.

export const INTERNAL_ENDPOINTS =
[
	{
		route: "/internal/ingest/v1/logs",
		service: "Spring Boot (internal port) + ClickHouse + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body: "[{ service, timestamp, severity, message, attributes }] — a batch of one or more log entries in a single POST",
		},
		response:
		{
			204: "Empty response",
			500: "{ error: 'server error' }",
		},
		group: "Alert Telemetry Evaluation",
		internal: true,
		tables: ["logs", "alert_rules", "alert_history"],
		tables_actions: {
			logs: "Insert",
			alert_rules: "Read",
			alert_history: "Insert"
		},
		constraints: {
			criteria:
			[
				"Batch = the array of log entries in this single POST, all inserted together",
				"Evaluation runs once per POST: for each enabled alert_rules row matching this batch's service, compute the rule's metric_name over its configured time window by querying already-ingested logs rows in ClickHouse (e.g. error_count = count of severity='error' rows in the window ending at this batch's latest timestamp) — the computation draws on stored history, not solely on the rows in this one request, since a small batch must still be able to trigger a window-based rule; trigger if the computed value >= threshold",
				"Silence watchdog: cancel and reschedule per-service watchdog task on each batch",
				"On trigger: write alert_history, broadcast alert frame via the WebSocketSession registry (see ep-alerts-ws, same deployable — see file header note), forward to /internal/llm/forward",
				"On LLM completion: single write to alert row, rebroadcast llm frame via the same WebSocketSession registry, POST to all webhooks",
			],
			security: [],
			rateLimit: "N/A",
			realtime: "Triggers WS broadcast (alert frame) to the WebSocketSession registry on new alert",
			fallback: "Evaluation errors silent",
			dedup:
				"Hash (service + severity + message + time bucket), drop if duplicate in last 10 minutes — logs have no metric_name field, so the key uses the fields the payload actually carries",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-ingest-logs",
	},
	{
		route: "/internal/ingest/v1/metrics",
		service: "Spring Boot (internal port) + ClickHouse + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body: "[{ service, timestamp, name, value, attributes }] — a batch of one or more metric points in a single POST",
		},
		response:
		{
			204: "Empty response",
			500: "{ error: 'server error' }",
		},
		group: "Alert Telemetry Evaluation",
		internal: true,
		tables: ["metrics", "alert_rules", "alert_history"],
		tables_actions: {
			metrics: "Insert",
			alert_rules: "Read",
			alert_history: "Insert"
		},
		constraints: {
			criteria:
			[
				"Batch = the array of metric points in this single POST, all inserted together",
				"Evaluation runs once per POST: for each enabled alert_rules row matching this batch's service, match the rule's metric_name against each point's own 'name' field; if they match, trigger when that point's 'value' >= threshold. This is the one ingest endpoint where the rule's signal maps directly onto a field in the payload — no window computation over stored history is required here",
				"Silence watchdog: cancel and reschedule per-service watchdog task on each batch",
				"On trigger: write alert_history, broadcast alert frame via the WebSocketSession registry (see ep-alerts-ws, same deployable — see file header note), forward to /internal/llm/forward",
				"On LLM completion: single write to alert row, rebroadcast llm frame via the same WebSocketSession registry, POST to all webhooks",
			],
			security: [],
			rateLimit: "N/A",
			realtime: "Triggers WS broadcast (alert frame) to the WebSocketSession registry on new alert",
			fallback: "Evaluation errors silent",
			dedup:
				"Hash (metric_name + service + time bucket), drop if duplicate in last 10 minutes — metrics' 'name' field is used as metric_name here since it's the one payload that actually carries it",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-ingest-metrics",
	},
	{
		route: "/internal/ingest/v1/traces",
		service: "Spring Boot (internal port) + ClickHouse + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body: "[{ trace_id, span_id, parent_span_id, name, service, timestamp, duration_ms, status, attributes }] — a batch of one or more spans in a single POST",
		},
		response:
		{
			204: "Empty response",
			500: "{ error: 'server error' }",
		},
		group: "Alert Telemetry Evaluation",
		internal: true,
		tables: ["traces", "alert_rules", "alert_history"],
		tables_actions: {
			traces: "Insert",
			alert_rules: "Read",
			alert_history: "Insert"
		},
		constraints: {
			criteria:
			[
				"Batch = the array of spans in this single POST, all inserted together",
				"Evaluation runs once per POST: for each enabled alert_rules row matching this batch's service, compute the rule's metric_name over its configured time window by querying already-ingested traces rows in ClickHouse (e.g. duration_ms percentile, or an error rate = count of status='error' spans over count of all spans in the window) — the computation draws on stored history, not solely on the spans in this one request; trigger if the computed value >= threshold",
				"Silence watchdog: cancel and reschedule per-service watchdog task on each batch",
				"On trigger: write alert_history, broadcast alert frame via the WebSocketSession registry (see ep-alerts-ws, same deployable — see file header note), forward to /internal/llm/forward",
				"On LLM completion: single write to alert row, rebroadcast llm frame via the same WebSocketSession registry, POST to all webhooks",
			],
			security: [],
			rateLimit: "N/A",
			realtime: "Triggers WS broadcast (alert frame) to the WebSocketSession registry on new alert",
			fallback: "Evaluation errors silent",
			dedup:
				"Hash (service + name + status + time bucket), drop if duplicate in last 10 minutes — traces have no metric_name field, so the key uses the fields the payload actually carries",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-ingest-traces",
	},
	{
		route: "/internal/llm/forward",
		service: "FastAPI + Ollama",
		owner: "AI Engineer",
		method: "POST",
		request:
		{
			query: [],
			body: "{ alert_id, service, triggered_at, context: { logs[], metrics[], traces[] } }",
		},
		response:
		{
			chunk: "data: { token: '...' }",
			done:  "data: { done: true }",
		},
		group: "LLM Alert Summarization",
		internal: true,
		tables: [],
		tables_actions: {},
		constraints: {
			criteria:
			[
				"Called for every alert trigger regardless of signal type",
				"Spring Boot owns the WS and webhook lifecycle — FastAPI only runs inference",
			],
			security: [],
			rateLimit: "N/A",
			realtime:
				"Streams token frames back to Spring Boot caller. Spring Boot writes final analysis to alert row and rebroadcasts an llm frame via the WebSocketSession registry (see ep-alerts-ws).",
			fallback:
				"30s timeout. Spring Boot writes 'Analysis unavailable' to alert row, rebroadcasts, proceeds to webhooks.",
			dedup: "None",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-fastapi-analyze",
	},
];

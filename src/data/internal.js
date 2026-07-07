// Internal-port endpoints omit requiredRole on purpose — access here is
// gated by network isolation (see authStrategy: INTERNAL_ONLY), not by a
// role check, so there's no role value to report. ROLE_ENFORCEMENT_INFO in
// gateway.js documents the ADMIN / ADMIN_/_VIEWER / NO_AUTH tiers that apply
// to reachable endpoints only.

export const INTERNAL_ENDPOINTS =
[
	{
		route: "/internal/otlp/v1/logs",
		service:
			"Alert Engine (Spring Boot, internal port) + ClickHouse + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body: "{ service, timestamp, severity, message, attributes }",
		},
		response:
		{
			204: "Empty response",
			500: "{ error: 'server error' }",
		},
		group: "Alert Telemetry Evaluation",
		internal: true,
		tables: ["logs", "alert_rules", "alert_history"],
		tables_actions: "Read + Insert",
		constraints: {
			criteria:
			[
				"Silence watchdog: cancel and reschedule per-service watchdog task on each batch",
				"On trigger: write alert_history, broadcast via SSE, forward to /internal/llm/forward",
				"On LLM completion: single write to alert row, rebroadcast via SSE, POST to all webhooks",
			],
			security: [],
			rateLimit: "N/A",
			realtime: "Triggers SSE broadcast on new alert",
			fallback: "Evaluation errors silent",
			dedup:
				"Hash (condition + service + time bucket), drop if duplicate in last 10 minutes",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-otlp-logs",
	},
	{
		route: "/internal/otlp/v1/metrics",
		service:
			"Alert Engine (Spring Boot, internal port) + ClickHouse + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body: "{ service, timestamp, name, value, attributes }",
		},
		response:
		{
			204: "Empty response",
			500: "{ error: 'server error' }",
		},
		group: "Alert Telemetry Evaluation",
		internal: true,
		tables: ["metrics", "alert_rules", "alert_history"],
		tables_actions: "Read + Insert",
		constraints: {
			criteria:
			[
				"Silence watchdog: cancel and reschedule per-service watchdog task on each batch",
				"On trigger: write alert_history, broadcast via SSE, forward to /internal/llm/forward",
				"On LLM completion: single write to alert row, rebroadcast via SSE, POST to all webhooks",
			],
			security: [],
			rateLimit: "N/A",
			realtime: "Triggers SSE broadcast on new alert",
			fallback: "Evaluation errors silent",
			dedup:
				"Hash (condition + service + time bucket), drop if duplicate in last 10 minutes",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-otlp-metrics",
	},
	{
		route: "/internal/otlp/v1/traces",
		service:
			"Alert Engine (Spring Boot, internal port) + ClickHouse + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body: "{ trace_id, span_id, parent_span_id, name, service, timestamp, duration_ms, status, attributes }",
		},
		response:
		{
			204: "Empty response",
			500: "{ error: 'server error' }",
		},
		group: "Alert Telemetry Evaluation",
		internal: true,
		tables: ["traces", "alert_rules", "alert_history"],
		tables_actions: "Read + Insert",
		constraints: {
			criteria:
			[
				"Silence watchdog: cancel and reschedule per-service watchdog task on each batch",
				"On trigger: write alert_history, broadcast via SSE, forward to /internal/llm/forward",
				"On LLM completion: single write to alert row, rebroadcast via SSE, POST to all webhooks",
			],
			security: [],
			rateLimit: "N/A",
			realtime: "Triggers SSE broadcast on new alert",
			fallback: "Evaluation errors silent",
			dedup:
				"Hash (condition + service + time bucket), drop if duplicate in last 10 minutes",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-otlp-traces",
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
		tables_actions: "None",
		constraints: {
			criteria:
			[
				"Called for every alert trigger regardless of signal type",
				"Spring Boot owns the SSE and webhook lifecycle — FastAPI only runs inference",
			],
			security: [],
			rateLimit: "N/A",
			realtime:
				"Streams token frames back to Spring Boot caller. Spring Boot writes final analysis to alert row and rebroadcasts via /api/alerts/live.",
			fallback:
				"30s timeout. Spring Boot writes 'Analysis unavailable' to alert row, rebroadcasts, proceeds to webhooks.",
			dedup: "None",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-fastapi-analyze",
	},
];

// Internal-port endpoints omit requiredRole on purpose — access here is
// gated by network isolation (see authStrategy: INTERNAL_ONLY), not by a
// role check, so there's no role value to report. ROLE_ENFORCEMENT_INFO
// documents the ADMIN / ADMIN_/_VIEWER / NO_AUTH tiers that apply to
// reachable endpoints only.
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
// in-memory WebSocketSession registry with ep-alerts-ws valid; a genuinely
// separate process couldn't reach that in-memory registry without a
// message bus, which isn't part of this design.

// Silence watchdog: fire behavior. Reset (cancel + reschedule on each batch)
// is triggered by that endpoint's own traffic, so it's documented per-endpoint
// below same as before; the fire behavior is identical regardless of which
// signal type last reset it, so — since nothing in EndpointComponents.jsx
// resolves cross-references to anything other than another endpoint's id —
// it's written out in full in each of the three ingest endpoints' criteria
// below, the same way the reset line already was, rather than factored into
// a module-level export that wouldn't render anywhere.

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
			alert_history: "Insert + Update (llm_analysis on LLM completion)"
		},
		constraints: {
			criteria:
			[
				"Batch = the array of log entries in this single POST, all inserted together",
				"Evaluation runs once per POST: for each enabled alert_rules row with signal_type = 'logs' matching this batch's service (rows with signal_type = 'metrics' or 'traces' are skipped entirely — each alert_rules row declares exactly one signal_type, so exactly one of the three ingest evaluators owns a given rule), compute the aggregate named by metric_name over the row's own window_seconds by querying already-ingested logs rows in ClickHouse, ending at this batch's latest timestamp: error_count/warning_count/critical_count = count of rows with severity = 'error'/'warning'/'critical' respectively in the window, total_count = count of all rows in the window regardless of severity (metric_name is a closed enum for signal_type = logs: error_count | warning_count | critical_count | total_count) — the computation draws on stored history, not solely on the rows in this one request, since a small batch must still be able to trigger a window-based rule; trigger if the computed value >= threshold",
				"Silence watchdog: cancel and reschedule per-service watchdog task on each batch. One shared timer per service across logs/metrics/traces — a batch on any signal type resets it, not one independent timer per endpoint. Config: vigil.silence-timeout-seconds (Spring Boot @ConfigurationProperties, default 300) — how long a service can go without any batch before the watchdog fires. On fire: runs the exact same 'On trigger' and 'On LLM completion' steps below (write alert_history, forward the alert_id/service/triggered_at/context to FastAPI for analysis, broadcast an alert frame, then on LLM completion rebroadcast an llm frame and POST { alert_uid, title, message, state: 'alerting', link_to_upstream_details, service, metric_name, threshold, severity, triggered_at, signal_type, window_seconds, aggregation } to every registered webhook), just with fixed values in place of a matched alert_rules row: rule_id: null (no alert_rules row backs a silence alert), metric_name: 'service_silent', threshold: null, severity: 'critical' (fixed — a service going dark is always treated as top severity in this pass), signal_type: null, window_seconds: null, aggregation: null (all three are null because no single evaluator produced this alert). Reschedules on the next batch for that service, so a silence alert fires at most once per silence period, not repeatedly while the service stays quiet. Scope: like the WebSocketSession registry (see 'On trigger' below), this per-service timer is in-memory and per-instance, not distributed — a batch landing on a different instance than the one currently holding that service's timer does not reset it. Single-instance deployment is the accepted target for this project; a production multi-instance deployment would need this backed by shared state (e.g. a DB row with a next-fire-time) instead of an in-process scheduled task, or every instance would run its own independent watchdog and could each fire a silence alert for the same service near-simultaneously",
				"On trigger: write alert_history — metric_name/threshold/severity/signal_type/window_seconds/aggregation are copied from the matching alert_rules row's own values at insert time (not a live join), so this alert's historical record stays fixed even if that rule is later edited or deleted — broadcast alert frame via the in-memory WebSocketSession registry (populated by ep-alerts-ws's WS connections — this ingest endpoint and that one are the same Spring Boot deployable exposing two ports, an internal one and a public one, so both can reach the same in-process registry), forward to /internal/llm/forward",
				"On LLM completion: single write to alert row (Update: llm_analysis only — the Insert above already wrote rule_id/service/triggered_at/metric_name/threshold/severity/signal_type/window_seconds/aggregation), rebroadcast llm frame via the same WebSocketSession registry, POST { alert_uid: alert_history.id, title: '<severity> alert: <metric_name> on <service>', message: llm_analysis, state: 'alerting', link_to_upstream_details: '<vigil.frontend-base-url>/alerts?id=<alert_history.id>', service, metric_name, threshold, severity, triggered_at, signal_type, window_seconds, aggregation } to every registered webhook — fire-and-forget by design (accepted scope decision for this project): no retry, no backoff, no dead-letter, no delivery-status surfaced anywhere in the API",
			],
			security: [],
			rateLimit: "N/A",
			realtime: "Triggers WS broadcast (alert frame) to the WebSocketSession registry on new alert",
			fallback: "Evaluation errors silent",
			dedup:
				"Hash (service + severity + message + time bucket), drop if duplicate in last 10 minutes — logs have no metric_name field, so the key uses the fields the payload actually carries. Applied per entry within the batch: each element of the POSTed array is hashed and checked independently, so a batch can partially insert (some entries dropped as duplicates, others inserted) rather than being accepted or rejected as a whole",
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
			alert_history: "Insert + Update (llm_analysis on LLM completion)"
		},
		constraints: {
			criteria:
			[
				"Batch = the array of metric points in this single POST, all inserted together",
				"Evaluation runs once per POST: for each enabled alert_rules row with signal_type = 'metrics' matching this batch's service (rows with signal_type = 'logs' or 'traces' are skipped entirely — each alert_rules row declares exactly one signal_type, so exactly one of the three ingest evaluators owns a given rule), compute the row's aggregation over its own window_seconds by querying already-ingested metrics rows in ClickHouse — not solely the points in this one request, same as ep-ingest-logs/-traces — where name = metric_name, ending at this batch's latest timestamp: 'latest' takes the single most recent matching point's value (this is the exact equivalent of the old pre-windowing instantaneous check, so existing rule behavior remains expressible), avg/sum/min/max/count/p50/p95/p99 apply that statistic to 'value' across every matching point in the window; trigger if the computed value >= threshold. Evaluation now uses the same windowed ClickHouse-query mechanism as ep-ingest-logs and ep-ingest-traces — the only differences between the three evaluators are which ClickHouse table is queried and which metric_name/aggregation vocabulary applies for that signal_type",
				"Silence watchdog: cancel and reschedule per-service watchdog task on each batch. One shared timer per service across logs/metrics/traces — a batch on any signal type resets it, not one independent timer per endpoint. Config: vigil.silence-timeout-seconds (Spring Boot @ConfigurationProperties, default 300) — how long a service can go without any batch before the watchdog fires. On fire: runs the exact same 'On trigger' and 'On LLM completion' steps below (write alert_history, forward the alert_id/service/triggered_at/context to FastAPI for analysis, broadcast an alert frame, then on LLM completion rebroadcast an llm frame and POST { alert_uid, title, message, state: 'alerting', link_to_upstream_details, service, metric_name, threshold, severity, triggered_at, signal_type, window_seconds, aggregation } to every registered webhook), just with fixed values in place of a matched alert_rules row: rule_id: null (no alert_rules row backs a silence alert), metric_name: 'service_silent', threshold: null, severity: 'critical' (fixed — a service going dark is always treated as top severity in this pass), signal_type: null, window_seconds: null, aggregation: null (all three are null because no single evaluator produced this alert). Reschedules on the next batch for that service, so a silence alert fires at most once per silence period, not repeatedly while the service stays quiet. Scope: like the WebSocketSession registry (see 'On trigger' below), this per-service timer is in-memory and per-instance, not distributed — a batch landing on a different instance than the one currently holding that service's timer does not reset it. Single-instance deployment is the accepted target for this project; a production multi-instance deployment would need this backed by shared state (e.g. a DB row with a next-fire-time) instead of an in-process scheduled task, or every instance would run its own independent watchdog and could each fire a silence alert for the same service near-simultaneously",
				"On trigger: write alert_history — metric_name/threshold/severity/signal_type/window_seconds/aggregation are copied from the matching alert_rules row's own values at insert time (not a live join), so this alert's historical record stays fixed even if that rule is later edited or deleted — broadcast alert frame via the in-memory WebSocketSession registry (populated by ep-alerts-ws's WS connections — this ingest endpoint and that one are the same Spring Boot deployable exposing two ports, an internal one and a public one, so both can reach the same in-process registry), forward to /internal/llm/forward",
				"On LLM completion: single write to alert row (Update: llm_analysis only — the Insert above already wrote rule_id/service/triggered_at/metric_name/threshold/severity/signal_type/window_seconds/aggregation), rebroadcast llm frame via the same WebSocketSession registry, POST { alert_uid: alert_history.id, title: '<severity> alert: <metric_name> on <service>', message: llm_analysis, state: 'alerting', link_to_upstream_details: '<vigil.frontend-base-url>/alerts?id=<alert_history.id>', service, metric_name, threshold, severity, triggered_at, signal_type, window_seconds, aggregation } to every registered webhook — fire-and-forget by design (accepted scope decision for this project): no retry, no backoff, no dead-letter, no delivery-status surfaced anywhere in the API",
			],
			security: [],
			rateLimit: "N/A",
			realtime: "Triggers WS broadcast (alert frame) to the WebSocketSession registry on new alert",
			fallback: "Evaluation errors silent",
			dedup:
				"Hash (metric_name + service + time bucket), drop if duplicate in last 10 minutes — metrics' 'name' field is used as metric_name here since it's the one payload that actually carries it. Applied per point within the batch: each element of the POSTed array is hashed and checked independently, so a batch can partially insert (some points dropped as duplicates, others inserted) rather than being accepted or rejected as a whole",
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
			alert_history: "Insert + Update (llm_analysis on LLM completion)"
		},
		constraints: {
			criteria:
			[
				"Batch = the array of spans in this single POST, all inserted together",
				"Evaluation runs once per POST: for each enabled alert_rules row with signal_type = 'traces' matching this batch's service (rows with signal_type = 'logs' or 'metrics' are skipped entirely — each alert_rules row declares exactly one signal_type, so exactly one of the three ingest evaluators owns a given rule), compute the aggregate named by metric_name over the row's own window_seconds by querying already-ingested traces rows in ClickHouse, ending at this batch's latest timestamp: error_rate = count of status='error' spans / count of all spans in the window (a 0..1 fraction), span_count = count of all spans in the window, avg_duration_ms/p50_duration_ms/p95_duration_ms/p99_duration_ms/max_duration_ms = that statistic applied to duration_ms across all spans in the window (metric_name is a closed enum for signal_type = traces: error_rate | span_count | avg_duration_ms | p50_duration_ms | p95_duration_ms | p99_duration_ms | max_duration_ms) — the computation draws on stored history, not solely on the spans in this one request; trigger if the computed value >= threshold",
				"Silence watchdog: cancel and reschedule per-service watchdog task on each batch. One shared timer per service across logs/metrics/traces — a batch on any signal type resets it, not one independent timer per endpoint. Config: vigil.silence-timeout-seconds (Spring Boot @ConfigurationProperties, default 300) — how long a service can go without any batch before the watchdog fires. On fire: runs the exact same 'On trigger' and 'On LLM completion' steps below (write alert_history, forward the alert_id/service/triggered_at/context to FastAPI for analysis, broadcast an alert frame, then on LLM completion rebroadcast an llm frame and POST { alert_uid, title, message, state: 'alerting', link_to_upstream_details, service, metric_name, threshold, severity, triggered_at, signal_type, window_seconds, aggregation } to every registered webhook), just with fixed values in place of a matched alert_rules row: rule_id: null (no alert_rules row backs a silence alert), metric_name: 'service_silent', threshold: null, severity: 'critical' (fixed — a service going dark is always treated as top severity in this pass), signal_type: null, window_seconds: null, aggregation: null (all three are null because no single evaluator produced this alert). Reschedules on the next batch for that service, so a silence alert fires at most once per silence period, not repeatedly while the service stays quiet. Scope: like the WebSocketSession registry (see 'On trigger' below), this per-service timer is in-memory and per-instance, not distributed — a batch landing on a different instance than the one currently holding that service's timer does not reset it. Single-instance deployment is the accepted target for this project; a production multi-instance deployment would need this backed by shared state (e.g. a DB row with a next-fire-time) instead of an in-process scheduled task, or every instance would run its own independent watchdog and could each fire a silence alert for the same service near-simultaneously",
				"On trigger: write alert_history — metric_name/threshold/severity/signal_type/window_seconds/aggregation are copied from the matching alert_rules row's own values at insert time (not a live join), so this alert's historical record stays fixed even if that rule is later edited or deleted — broadcast alert frame via the in-memory WebSocketSession registry (populated by ep-alerts-ws's WS connections — this ingest endpoint and that one are the same Spring Boot deployable exposing two ports, an internal one and a public one, so both can reach the same in-process registry), forward to /internal/llm/forward",
				"On LLM completion: single write to alert row (Update: llm_analysis only — the Insert above already wrote rule_id/service/triggered_at/metric_name/threshold/severity/signal_type/window_seconds/aggregation), rebroadcast llm frame via the same WebSocketSession registry, POST { alert_uid: alert_history.id, title: '<severity> alert: <metric_name> on <service>', message: llm_analysis, state: 'alerting', link_to_upstream_details: '<vigil.frontend-base-url>/alerts?id=<alert_history.id>', service, metric_name, threshold, severity, triggered_at, signal_type, window_seconds, aggregation } to every registered webhook — fire-and-forget by design (accepted scope decision for this project): no retry, no backoff, no dead-letter, no delivery-status surfaced anywhere in the API",
			],
			security: [],
			rateLimit: "N/A",
			realtime: "Triggers WS broadcast (alert frame) to the WebSocketSession registry on new alert",
			fallback: "Evaluation errors silent",
			dedup:
				"Hash (service + name + status + time bucket), drop if duplicate in last 10 minutes — traces have no metric_name field, so the key uses the fields the payload actually carries. Applied per span within the batch: each element of the POSTed array is hashed and checked independently, so a batch can partially insert (some spans dropped as duplicates, others inserted) rather than being accepted or rejected as a whole",
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
				"Streams token frames back to Spring Boot caller. Spring Boot writes final analysis to alert row and rebroadcasts an llm frame via the in-memory WebSocketSession registry — the same registry /api/alerts/ws connections are held in, since this internal endpoint and the public API are the same Spring Boot deployable exposing two ports, not separate microservices.",
			fallback:
				"30s timeout. Spring Boot writes 'Analysis unavailable' to alert row, rebroadcasts, proceeds to webhooks.",
			dedup: "None",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-fastapi-analyze",
	},
];

// Internal-port endpoints omit requiredRole: network isolation gates access.
// Spring Boot exposes public and internal ports in the same deployable, sharing
// the in-memory WebSocketSession registry and single-instance silence watchdog.
// The telemetry writer owns ClickHouse writes; this callback performs
// synchronous evaluation and alert persistence, not telemetry ingestion.
// vigil.ingestion-key authenticates services -> collector, not ClickHouse:
// Spring Boot generates it at startup via @PostConstruct and writes it to the
// shared mounted file read directly by the collector's bearertokenauth extension.
// ClickHouse credentials are a separate, unspecified secret.

export const INTERNAL_ENDPOINTS =
[
	{
		route: "/internal/alerts/trigger-evaluation",
		service: "Spring Boot (internal port) + ClickHouse + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body:
			{
				notification_id: "UUID — stable across retries",
				signal_type: "logs | metrics | traces",
				stored_at: "UTC timestamp when storage was confirmed queryable — immutable across retries",
				services:
				[
					{
						service: "Nonblank service name — unique in this nonempty array",
						latest_timestamp: "UTC maximum event timestamp for this service's stored rows",
					},
				],
			},
		},
		response:
		{
			204: "Empty response — returned after synchronous evaluation and alert persistence; does not wait for LLM completion or webhook delivery",
			400: "{ message: '<validation message>' }",
			500: "{ message: 'evaluation or alert persistence failed' }",
		},
		group: "Alert Telemetry Evaluation",
		internal: true,
		tables:
		[
			"logs",
			"metrics",
			"traces",
			"alert_rules",
			"alert_history",
			"alert_notifications",
			"users",
		],
		tables_actions:
		{
			logs: "Read",
			metrics: "Read",
			traces: "Read",
			alert_rules: "Read",
			alert_history: "Insert + Update (llm_analysis on LLM completion)",
			alert_notifications: "Insert (recipient rows on trigger)",
			users: "Read (notification recipients)",
		},
		constraints:
		{
			criteria:
			[
				"Metadata-only callback after the writer confirms the deduplicated rows are queryable in ClickHouse. No telemetry rows are carried in this request and this endpoint never inserts logs/metrics/traces. A notification represents one signal type and the services with rows actually stored; latest_timestamp is each service's maximum event timestamp in those rows, not delivery time or stored_at.",
				"Validate before acceptance: notification_id must be a UUID; signal_type must be logs | metrics | traces; stored_at and every latest_timestamp must be valid UTC timestamps; services must be a nonempty array of objects with a nonblank service and latest_timestamp, with unique service names. Reject missing, malformed, unknown fields or telemetry-row payloads with 400. stored_at records the time storage was confirmed queryable and is immutable across retries.",
				"Synchronous processing: validate the metadata, query ClickHouse and evaluate all matching services/rules in this request, then persist resulting alert_history and recipient alert_notifications rows in one PostgreSQL transaction. Return 204 only after evaluation succeeds and the transaction commits, including when no rule triggers. Do not wait for LLM completion or webhook delivery. No callback-metadata table, background evaluation queue, or persisted evaluation-processing status is used; alert_notifications stores recipient seen state only.",
				"Writer delivery: after row dedup, stamp each retained row's persisted attributes['vigil.notification_id'] with a stable notification_id, overwriting any client-supplied reserved key. Write to ClickHouse, confirm queryability, then send metadata to this endpoint. Retry failed or timed-out callbacks independently of telemetry insertion, using the same notification_id, stored_at and services metadata. A 400 requires correcting invalid input rather than blindly retrying. The ID correlates stored rows for SSE; it is not a backend idempotency key. The custom Go Collector exporter is compiled with OpenTelemetry Collector Builder and packaged in a custom Docker image. It uses synchronous inserts into one ClickHouse instance with a persistent volume; the backend queries that same instance. No replicas, distributed tables or asynchronous inserts are used.",
				"Callback retries: 10-second timeout per attempt; 3 attempts total. Retry connection failures, timeouts and 5xx responses with approximately 1 second and then 2 seconds of backoff plus jitter. Do not retry 4xx responses. Stop on 204; unexpected non-error responses are logged as contract failures, not success. Reuse the same notification_id, stored_at and services. After exhaustion, log an error and increment an exporter callback-failure counter. Callback-only failures are handled inside the exporter and must not surface as retryable whole-export failures that cause the Collector to repeat a successful ClickHouse insert.",
				"Collector crash behavior: callback retry state is in memory only. A Collector crash after successful storage but before callback completion can lose the evaluation request. Stored telemetry remains in ClickHouse; later callbacks may evaluate overlapping history but do not guarantee recovery. No durable callback-metadata storage or callback replay is provided; recipient alert_notifications are persisted separately. Callback failures are monitored independently of this evaluation path.",
				"Dispatcher: for each services entry, evaluate only enabled alert_rules matching that service and notification.signal_type, using that entry's latest_timestamp as the end of the rule's own window_seconds. Evaluation queries read all matching stored history in that window and are NOT restricted to vigil.notification_id; that ID correlates exact rows for SSE only. Trigger when the computed aggregate >= threshold.",
				"Logs: metric_name is the closed enum error_count | warning_count | critical_count | total_count. Query logs for the service/window: error_count/warning_count/critical_count count severity = 'error'/'warning'/'critical' respectively; total_count counts every row regardless of severity. aggregation is null.",
				"Metrics: query metrics for the service/window with name = metric_name. aggregation = latest takes the single most recent matching point's value; avg/sum/min/max/count/p50/p95/p99 apply that statistic to value across all matching points in the window. The instantaneous latest behavior remains expressible through latest.",
				"Traces: metric_name is the closed enum error_rate | span_count | avg_duration_ms | p50_duration_ms | p95_duration_ms | p99_duration_ms | max_duration_ms. Query traces for the service/window: error_rate = count of status='error' spans / count of all spans (a 0..1 fraction); span_count counts all spans; avg_duration_ms/p50_duration_ms/p95_duration_ms/p99_duration_ms/max_duration_ms apply that statistic to duration_ms across all spans. aggregation is null.",
				"Silence watchdog: one shared in-memory timer per service across logs/metrics/traces, single-instance deployment only. For valid callbacks, last_seen = max(stored_at) across signals, never callback receipt time or event time. Only a strictly newer stored_at advances last_seen and reschedules last_seen + vigil.silence-timeout-seconds (Spring Boot @ConfigurationProperties, default 300). Retries and older late delivery cannot extend freshness; an already-expired deadline is due immediately rather than receiving another 300 seconds. Fire at most once per silence period in a running instance and rearm only on newer confirmed storage. Timer/fired/last_seen state is lost on restart; watchdog tracking resumes on the next valid callback for that service. Multi-instance operation requires shared watchdog state.",
				"On silence watchdog fire: run the same On trigger and On LLM completion alert/LLM/WS/webhook lifecycle below. Use rule_id: null, metric_name: 'service_silent', threshold: null, severity: 'critical', signal_type: null, window_seconds: null, aggregation: null. Fetch service telemetry context from ClickHouse for analysis, broadcast the alert frame, then rebroadcast the llm frame and deliver the same webhook payload on LLM completion.",
				{
					text: "On trigger: persist alert_history results after all services/rules have been evaluated with status=sent, owner_id/acked_at/acked_by/resolved_at/resolved_by=null and version=0; create alert_notifications for current recipient users with seen=false and seen_at=null in the same transaction. Only after commit initiate best-effort external delivery — metric_name/threshold/severity/signal_type/window_seconds/aggregation are copied from the matching alert_rules row's own values at insert time (not a live join), so this alert's historical record stays fixed even if that rule is later edited or deleted — broadcast shared alert to all connected users and case-sensitive Notification only to each recipient connected sessions via the in-memory WebSocketSession registry (populated by the alerts WebSocket connections to the public API — this callback endpoint and that one are the same Spring Boot deployable exposing two ports, an internal one and a public one, so both can reach the same in-process registry), then forward the alert and its telemetry context to FastAPI for analysis. Fetch logs/metrics/traces context from already-queryable ClickHouse history for the service and alert time window, never from the metadata callback payload; forward alert_id/service/triggered_at/context to FastAPI.",
					refs: ["ep-alerts-ws", "ep-fastapi-analyze"],
				},
				"On LLM completion: single write to alert row (Update: llm_analysis only — the Insert above already wrote rule_id/service/triggered_at/metric_name/threshold/severity/signal_type/window_seconds/aggregation), rebroadcast llm frame via the same WebSocketSession registry, POST { alert_uid: alert_history.id, title: '<severity> alert: <metric_name> on <service>', message: llm_analysis, state: 'alerting', link_to_upstream_details: '<vigil.frontend-base-url>/alerts?id=<alert_history.id>', service, metric_name, threshold, severity, triggered_at, signal_type, window_seconds, aggregation } to every registered webhook — fire-and-forget by design (accepted scope decision for this project): no retry, no backoff, no dead-letter, no delivery-status surfaced anywhere in the API",
				"Retry limitation: the backend does not deduplicate callbacks. If evaluation and alert persistence succeed but the response is lost, a retry can evaluate again and create duplicate alert_history rows. SSE/WS frames, LLM requests and webhooks may also repeat or be lost on a process crash. There is no backend replay or exactly-once delivery guarantee.",
			],
			security:
			[
				"INTERNAL_ONLY: private container networking on one trusted host; the backend internal port and database ports are not published. No additional callback credential or internal TLS is used in this topology. Cross-host or untrusted-network traffic requires TLS and authenticated service access before deployment. The exporter uses a dedicated least-privilege ClickHouse writer account; the backend uses a separate read-only account. Credentials are injected outside images and source control. vigil.ingestion-key authenticates the earlier services-to-collector hop only.",
			],
			rateLimit: "N/A",
			realtime:
			{
				text: "The metadata callback contains no rows. Fetch the exact persisted rows from the signal_type-selected logs/metrics/traces table WHERE attributes['vigil.notification_id'] = notification_id, then push them to the corresponding live SseEmitters using each row's subscriber filters: service/severity for logs, service for metrics and traces. Do this independently of whether any rule triggers. Do not approximate this row set with a service/time window. Shared alert frames and later llm frames use the shared in-memory WebSocketSession registry; Notification frames with history service/trigger/signal/severity metadata and seen/seen_at go only to recipient sessions. SSE/WS remain best-effort external effects, not durable replay.",
				refs:
				[
					"ep-telemetry-logs-live",
					"ep-telemetry-metrics-live",
					"ep-telemetry-traces-live",
					"ep-alerts-ws",
				],
			},
			fallback: "Evaluation or alert persistence failure: return 500 and log the error; roll back the request’s history and recipient-notification inserts on transaction failure. The exporter retries connection failures, timeouts and 5xx responses up to 3 attempts total with a 10-second timeout per attempt and approximately 1s/2s backoff plus jitter. Callback retry exhaustion is logged and counted without resending a successful telemetry write. A timeout or lost response after commit may produce duplicate alerts on retry. No background recovery queue is used. External delivery remains best-effort.",
			dedup: "Writer-side row dedup drops duplicates seen in the last 10 minutes before stamping/writing rows: logs hash service + severity + message + time bucket per entry; metrics hash series_id + exact start_timestamp + exact timestamp + original point payload per point (excluding exporter-added vigil.notification_id); never deduplicate different label sets or distinct points merely because they share a time bucket; traces hash service + name + status + time bucket per span. The backend does not deduplicate callbacks or store callback-metadata records. Repeated callbacks can repeat evaluation and create duplicate alerts; notification_id is only a ClickHouse row-correlation marker.",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-alerts-trigger-evaluation",
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
				"Streams token frames back to Spring Boot caller. Spring Boot writes final analysis to alert row and rebroadcasts an llm frame via the in-memory WebSocketSession registry — the same registry the public alerts WebSocket connections are held in, since this internal endpoint and the public API are the same Spring Boot deployable exposing two ports, not separate microservices.",
			fallback:
				"30s timeout. Spring Boot writes 'Analysis unavailable' to alert row, rebroadcasts, proceeds to webhooks.",
			dedup: "None",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-fastapi-analyze",
	},
];

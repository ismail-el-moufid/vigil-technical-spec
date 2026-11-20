// Internal-port endpoints omit requiredRole: network isolation gates access.
// Spring Boot exposes public and internal ports in the same deployable, sharing
// the in-memory WebSocketSession registry and single-instance silence watchdog.
// The telemetry writer owns ClickHouse writes; this callback performs
// synchronous evaluation and alert persistence, not telemetry ingestion.
// vigil.ingestion-key authenticates services -> collector, not ClickHouse:
// Spring Boot generates an in-memory ingestion key if unset. Shared-file
// publication is planned; the current Collector reads its environment instead.
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
			404: "Empty response — controller rejects requests arriving on a port other than 8081",
			500: "Empty response — runtime failure is logged by IngestController",
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
				"Validate before acceptance: notification_id must be a UUID; signal_type must be logs | metrics | traces; stored_at and every latest_timestamp must deserialize to Instant (ISO8601 instants; not a literal-Z-only check); services must be a nonempty array of objects with a nonblank service and latest_timestamp, with exact, untrimmed unique service names (no future-time or stored_at/latest_timestamp ordering validation). Reject missing, malformed, unknown fields or telemetry-row payloads with 400. stored_at records the time storage was confirmed queryable and is immutable across retries.",
				"Implemented synchronous order: best-effort correlated SSE broadcast, update watchdog timers, query/evaluate matching rules, then AlertsService.saveAlertsService persists resulting history and recipient rows in one PostgreSQL transaction. Return 204 after this work, including no-trigger cases; do not wait for LLM/webhooks. No callback-metadata table, evaluation queue or processing status is persisted. SSE/watchdog effects precede evaluation and are not rolled back on later failure.",
				"Writer delivery: after row dedup, stamp each retained row's persisted attributes['vigil.notification_id'] with a stable notification_id, overwriting any client-supplied reserved key. Write to ClickHouse with async_insert=0 and wait_end_of_query=1, then confirm the notification-ID row count equals exactly the retained count before sending metadata. A visibility-check failure returns an export error but retains in-memory pending metadata/keys; a later overlapping batch resumes confirmation without reinserting those pending rows. This recovery is overlap-driven, not a background durable queue. Retry failed or timed-out callbacks independently of telemetry insertion, using the same notification_id, stored_at and services metadata. A 400 requires correcting invalid input rather than blindly retrying. The ID correlates stored rows for SSE; it is not a backend idempotency key. The default serialized batch limit is 1,048,576 bytes (runtime overrides from MAX_SERIALIZED_BATCH_BYTES); oversize/serialization failures are permanent export errors before insertion. Concurrent deliveries on an exporter use TryLock and return a retryable busy error rather than queueing. The custom Go Collector exporter is compiled with OpenTelemetry Collector Builder and packaged in a custom Docker image. It uses synchronous inserts into one ClickHouse instance with a persistent volume; the backend queries that same instance. No replicas, distributed tables or asynchronous inserts are used.",
				"Callback retries: 10-second timeout per attempt; 3 attempts total. Retry connection failures, timeouts and 5xx responses with approximately 1 second and then 2 seconds of backoff plus jitter. Do not retry 4xx responses. Stop on 204; unexpected non-error responses are logged as contract failures, not success. Reuse the same notification_id, stored_at and services. After exhaustion, log an error and increment an exporter callback-failure counter. Callback-only failures are handled inside the exporter and must not surface as retryable whole-export failures that cause the Collector to repeat a successful ClickHouse insert.",
				"Collector crash behavior: callback retry state is in memory only. A Collector crash after successful storage but before callback completion can lose the evaluation request. Callback exhaustion is swallowed after logging/counting and the pending delivery is removed; a later duplicate batch within the dedup window does not replay the exhausted callback. Stored telemetry remains in ClickHouse; later callbacks may evaluate overlapping history but do not guarantee recovery. No durable callback-metadata storage or callback replay is provided; recipient alert_notifications are persisted separately. Callback failures are monitored independently of this evaluation path.",
				"Dispatcher: for each services entry, evaluate enabled alert_rules matching service and signal_type, ending the window at latest_timestamp. Query full window history, not only notification_id rows. Trigger when aggregate >= threshold only if no existing history for that rule has status sent or acknowledged. IngestService.evaluateAlertRules is synchronized per instance; resolution allows another later trigger. There is no automatic recovery/resolution.",
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
				"Retry limitation: there is no notification_id idempotency store. Retries repeat SSE and evaluation, but an existing sent/acknowledged alert suppresses another trigger for that rule in the current single-instance implementation. A resolved prior alert, multiple instances or other races can still retrigger; do not claim exactly-once behavior. Telemetry streaming failures are logged/swallowed before watchdog/evaluation and do not force callback retry.",
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
			fallback: "Evaluation/persistence runtime failure: IngestController logs and returns an empty 500; AlertsService persistence transaction rolls back its inserts. SSE/watchdog effects already occurred and are not rolled back. Exporter retries failures independently of a successful telemetry write. Sent/acknowledged rule-history suppression limits repeat triggers, but no callback idempotency or durable replay exists.",
			dedup: "Writer-side row dedup and notification_id correlate stored telemetry; backend has no callback-metadata idempotency table. IngestService suppresses a rule trigger while its history is sent/acknowledged, independently of notification_id. Multi-instance and post-resolution retries are not exactly-once. Collector dedup is in-memory per exporter instance, default 10 minutes (runtime config: 10m): logs hash the normalized row plus signal, traces hash signal/trace_id/span_id, metrics hash signal/series_id/timestamp/start_timestamp/normalized payload. Duplicate rows within a batch and retained-window repeats are dropped; expired entries and process restarts permit reinsertion. No cross-instance durable dedup exists.",
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
			body: "{ alert_id: '<uuid>', service, triggered_at, rule: { signal_type, metric_name, aggregation, threshold, window_seconds, severity }, context: { logs[], metrics[], traces[] } }",
		},
		response:
		{
			token: "event: token; data: { token: '<text>' }",
			done: "event: done; data: {}",
			error: "event: error; data: { message: 'Analysis unavailable' }",
			400: "{ message: '<validation message>' }",
			503: "{ message: 'Analysis unavailable' } | { message: 'llm busy; retry in <seconds> seconds' }",
		},
		group: "LLM Alert Summarization",
		internal: true,
		tables: [],
		tables_actions: {},
		constraints: {
			criteria:
			[
				"Implemented by FastAPI app/routes/llm.py and ForwardRequest, not a Spring internal-port controller. Called by LlmService after trigger persistence for every signal type. Spring sends rule snapshots and telemetry context; the LLM service also exposes unauthenticated /health for private health checks.",
				"Spring Boot owns persistence, WS and webhook lifecycle — FastAPI only runs inference. ForwardRequest accepts alert_id/service/triggered_at, optional rule, and context arrays (context defaults to empty arrays when omitted); unknown fields are ignored on this forward model. ForwardRequest does not require a nonblank service or enforce closed rule enums, and accepts datetime values rather than enforcing a literal UTC-Z representation. Named done has empty JSON data, not a boolean done property.",
			],
			security: [],
			rateLimit: "No forward per-user request limit; shared FastAPI concurrency=1, queue wait=0.5s by default",
			realtime:
				"FastAPI streams named token/done/error events to Spring's LlmClient. Spring accumulates tokens, requires a nonempty done result, writes llm_analysis, broadcasts llm and schedules webhooks. The WS registry belongs to Spring; FastAPI is a separate process/service.",
			fallback:
				"FastAPI inference timeout defaults to 25s; Spring client defaults to 30s (5s connect timeout). Failures/timeouts persist Analysis unavailable and still broadcast/deliver webhooks. Both FastAPI inference routes share a default concurrency-1 limiter with 0.5s queue wait; pre-stream capacity/unavailability returns 503, post-first-token failures emit error without done.",
			dedup: "None",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-fastapi-analyze",
	},
	{
		route: "/internal/llm/ask",
		service: "FastAPI + Ollama",
		owner: "AI Engineer",
		method: "POST",
		request: {
			query: [],
			body: "{ alert_id, service, triggered_at, rule?, context: { logs[], metrics[], traces[] }, question: '<1-500 characters, stripped>', previous_analysis?: '<max 5000 characters, stripped; null allowed>' }; required header X-Vigil-User-Id: '<1-64 characters>'",
		},
		response: {
			token: "event: token; data: { token: '<text>' }",
			done: "event: done; data: {}",
			error: "event: error; data: { message: 'Analysis unavailable' }",
			400: "{ message: '<validation message>' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			503: "{ message: 'Analysis unavailable' } | { message: 'llm busy; retry in <seconds> seconds' }",
		},
		group: "LLM Alert Summarization",
		internal: true,
		tables: [], tables_actions: {},
		constraints: {
			criteria: [
				"Implemented in FastAPI app/routes/llm.py. Spring's public alert ask endpoint loads trusted alert/context and forwards the authenticated user ID in the header. AskRequest forbids unknown top-level fields and strips strings; it accepts question and optional previous_analysis, not conversation history.",
				"FastAPI has no database access and does not persist follow-up answers. Spring streams this result to the requesting client without changing saved analysis or scheduling webhooks. X-Vigil-User-Id is required and length-checked only, not UUID-validated; invalid/missing header/body returns 400 via app/main.py (not FastAPI's default 422). Rate-limit acquisition happens after validation and before concurrency admission, so a busy/unavailable inference still consumes the user's ask allowance.",
			],
			security: ["Private LLM network only; header is a rate-limit identity, not a service authentication credential. Do not expose this route to untrusted callers."],
			rateLimit: "Default 5/min per X-Vigil-User-Id fixed window; shared default concurrency=1 and queue wait=0.5s with automatic forward inference",
			realtime: "Named token/done/error SSE; pre-stream errors are HTTP responses, post-first-token failures are error events",
			fallback: "FastAPI inference timeout defaults to 25s; Spring timeout defaults to 30s",
			dedup: "None",
		},
		authStrategy: ["INTERNAL_ONLY"],
		id: "ep-fastapi-ask",
	},
];

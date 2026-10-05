export const ARCHITECTURE_DELIVERY_DIAGRAM = "flowchart TD\n\tA[Custom Collector exporter] --> B[Write telemetry to ClickHouse]\n\tB --> C[Confirm data is queryable]\n\tC --> D[POST /internal/alerts/trigger-evaluation]\n\tD --> E[Backend queries ClickHouse and evaluates rules]\n\tE --> F[Persist alerts and recipient notifications in PostgreSQL]\n\tF --> G[Return 204 No Content]\n\tlinkStyle default stroke:white;";

export const ARCHITECTURE_SECTIONS =
[
	{
		"id": "overview",
		"title": "System overview",
		"summary": "VIGIL runs on one host with a custom Collector exporter, one Spring Boot backend, one ClickHouse instance, and PostgreSQL.",
		"items": [
			{
				"title": "Telemetry and evaluation",
				"text": "The custom Go Collector exporter writes telemetry to ClickHouse synchronously, confirms queryability, then POSTs metadata to /internal/alerts/trigger-evaluation. Spring Boot evaluates event-time windows, persists resulting alerts in PostgreSQL, and returns 204. Callback metadata is not stored; recipient notifications are persisted separately with personal seen state."
			},
			{
				"title": "Callback contract",
				"text": "One unversioned POST /internal/alerts/trigger-evaluation handles logs, metrics, and traces via signal_type. It carries notification_id, stored_at, and services entries with service and latest_timestamp. LLM and webhook completion do not block the response."
			},
			{
				"title": "Transaction boundary",
				"text": "ClickHouse and PostgreSQL commit independently. Successful telemetry storage does not guarantee evaluation or external delivery. Callback retries can repeat evaluation and create duplicate alerts; the backend does not deduplicate callbacks."
			}
		]
	},
	{
		"id": "telemetry",
		"title": "Telemetry and time",
		"summary": "Event timestamps define evaluation windows; confirmed storage timestamps define service freshness.",
		"items": [
			{
				"title": "Evaluation clock",
				"text": "Each services entry supplies latest_timestamp, the maximum event timestamp for that service in the stored batch. Evaluation windows end at that timestamp, not callback arrival time. stored_at records confirmed storage time and stays unchanged on retry."
			},
			{
				"title": "Silence detection",
				"text": "One in-memory watchdog per service is shared across logs, metrics, and traces. Only a newer stored_at advances freshness; duplicate and out-of-order callbacks cannot extend it. The silence timeout is 300 seconds. Watchdog state is lost on backend restart and tracking resumes on the next valid callback for that service."
			},
			{
				"title": "Batching",
				"text": "Each signal pipeline targets 1,000 items per batch, flushes after 5 seconds, and limits batches to 5,000 items. The custom exporter also enforces a configurable serialized-byte limit so large individual records cannot bypass memory bounds. Collector buffering is bounded and a memory limiter protects the process; queue capacity, byte limits and memory thresholds are configured for the host memory budget."
			},
			{
				"title": "Correlation",
				"text": "The exporter stamps stored rows with reserved attributes[vigil.notification_id], overwriting client-supplied values. Live streams fetch those exact rows from ClickHouse. The ID is correlation metadata, not a backend idempotency key; alert evaluation still queries all relevant rows in its event-time window."
			}
		]
	},
	{
		"id": "delivery",
		"diagram": ARCHITECTURE_DELIVERY_DIAGRAM,
		"title": "Storage-success delivery",
		"summary": "The custom exporter performs the ClickHouse write before the synchronous backend callback.",
		"items": [
			{
				"title": "POST /internal/alerts/trigger-evaluation",
				"text": "Required metadata: notification_id (UUID), signal_type (logs | metrics | traces), stored_at (UTC storage-confirmation timestamp), and a nonempty services array of unique service/latest_timestamp pairs. 204 means evaluation and alert persistence succeeded, including when no rule triggers; 400 means invalid input; 500 means evaluation or alert persistence failed."
			},
			{
				"title": "Synchronous storage and evaluation",
				"text": "ClickHouse uses synchronous inserts on one instance with a persistent volume. Spring Boot queries that same instance. There are no replicas, distributed tables, or asynchronous inserts. The callback follows a successful insert response. The backend evaluates all matching services/rules and commits resulting alert_history and recipient alert_notifications rows in one PostgreSQL transaction before returning 204; it does not wait for LLM completion or webhooks."
			},
			{
				"title": "Callback retry policy",
				"text": "Each callback attempt has a 10-second timeout. The exporter makes at most 3 attempts total, with approximately 1 second and then 2 seconds of backoff plus jitter. Retry connection failures, timeouts and 5xx responses; do not retry 4xx responses. Keep notification_id, stored_at and services unchanged. Stop on 204; other unexpected responses are logged as contract failures rather than treated as success."
			},
			{
				"title": "Failure handling",
				"text": "Callback retries never repeat a successful ClickHouse insert. After retry exhaustion, log an error and increment an exporter callback-failure counter. A callback-only failure is handled inside the exporter and is not returned as a retryable whole-export failure that would make the Collector resend the telemetry write."
			},
			{
				"title": "Crash behavior",
				"text": "Callback retry state exists only in memory. A Collector crash after storage but before callback completion can lose that evaluation request. Telemetry remains in ClickHouse. Later callbacks may evaluate overlapping history but do not guarantee recovery. A lost response can produce duplicate alerts on retry. No callback-metadata table, durable callback retry state, evaluation queue, replay, or exactly-once processing is provided. Recipient alert_notifications are stored independently for personal seen state."
			},
			{
				"title": "Asynchronous external delivery",
				"text": "LLM processing and webhook delivery remain asynchronous and best-effort. The LLM timeout is 30 seconds. SSE and WS frames, LLM requests and webhooks can be repeated or lost on failures; callback success does not guarantee their completion."
			}
		]
	},
	{
		"id": "databases",
		"title": "Database storage and retention",
		"summary": "ClickHouse stores 30 days of telemetry; PostgreSQL stores configuration and retained alert history.",
		"items": [
			{
				"title": "ClickHouse layout",
				"text": "Telemetry tables use MergeTree on a single ClickHouse instance, monthly event-time partitions via PARTITION BY toYYYYMM(timestamp), and TTL timestamp + INTERVAL 30 DAY DELETE. Logs use ORDER BY (service, timestamp); metrics use ORDER BY (service, name, timestamp); traces use ORDER BY (service, timestamp, trace_id, span_id). These keys support the service/time-window query paths; workload tests verify their performance."
			},
			{
				"title": "Retention",
				"text": "Logs, metrics and traces have a 30-day TTL. TTL deletion runs asynchronously during ClickHouse maintenance and is not an immediate privacy-erasure guarantee. PostgreSQL alert history has no automatic expiry and remains retained until an explicit cleanup policy is introduced."
			},
			{
				"title": "Shared history and personal notifications",
				"text": "History status is shared: sent, acknowledged or resolved. The acknowledging owner controls owned records; unowned history can be resolved directly. Actor email snapshots survive owner deletion, while owner_id becomes null. Optimistic version locking rejects concurrent conflicts with 409. Personal notifications are keyed by (user_id, alert_history_id), store seen/seen_at, and cascade on recipient or history deletion. Shared alert updates reach all connected users; Notification broadcasts reach only recipient sessions. REST and WebSocket actions use the same services."
			},
			{
				"title": "PostgreSQL integrity",
				"text": "The backend connection pool has a maximum of 10 connections. Database access uses parameterized SQL, constraints, foreign keys, transactions and workload-appropriate indexes. Alert history snapshots preserve the values used at evaluation time. Schema changes use versioned, tested migrations."
			},
			{
				"title": "Backups",
				"text": "Both PostgreSQL and ClickHouse are backed up daily. Backups are encrypted, kept outside the application host, and retained for 7 days. Backup age is monitored; this schedule allows approximately 24 hours of data loss after total host failure when backups are succeeding. Backups do not recover missed evaluation callbacks."
			},
			{
				"title": "Restore verification",
				"text": "A restore into an isolated environment is tested before deployment and monthly afterward. Verification covers database readability, telemetry queries, configuration and alert-history integrity. Persistent volumes are not a substitute for off-host backups."
			}
		]
	},
	{
		"id": "deployment",
		"title": "Deployment and security",
		"summary": "A custom Collector Docker image and a single backend/database deployment run on private container networks on one host.",
		"items": [
			{
				"title": "Custom Collector exporter",
				"text": "A custom Go exporter is compiled with OpenTelemetry Collector Builder (OCB), alongside the required receivers, processors and extensions, and packaged in a custom Docker image. That exporter owns the synchronous ClickHouse insert and subsequent metadata callback; the two operations are not independent export destinations. For metrics, preserve the original OTLP type, unit, temporality, monotonic flag, start time and series identity, plus histogram sum/count; do not flatten histograms into scalar values or infer types from names. ClickHouse computes generic time-bucket aggregates for GET /api/telemetry/metrics; the Collector does not precompute fixed chart buckets. Unsupported OTLP summary distributions remain unavailable to bucketed reads."
			},
			{
				"title": "Single-host topology",
				"text": "One Spring Boot backend, the Collector and the databases communicate over private container networks on a trusted host. The backend internal port and database ports are not published to the host or public network. PostgreSQL and ClickHouse use persistent volumes. In-memory watchdog and socket registries belong to this single-instance topology."
			},
			{
				"title": "Onboarding OTLP address",
				"text": "The deployment-origin address offered by onboarding must expose /v1/traces, /v1/logs and /v1/metrics to the Collector OTLP/HTTP receiver, preserving the Authorization: Bearer ingestion_key header for its bearertokenauth check. These are Collector ingestion routes, not Spring Boot telemetry-read API routes. Deployment routing must support them before advertising the origin as a working exporter endpoint; a page-local custom address may instead identify another reachable ingress for the same Collector. Use HTTPS across untrusted networks and never forward an ingestion key to an unrelated deployment. The custom exporter address changes application exports only; browser configuration-key and live-read requests remain on the authenticated current deployment. Verify routing with an actual instrumented export, not merely an HTTP reachability response."
			},
			{
				"title": "Internal transport",
				"text": "The same-host callback uses network isolation without an additional callback credential or internal TLS. This boundary is limited to trusted containers on the same host; moving internal traffic across hosts or untrusted networks requires TLS and authenticated service access before deployment."
			},
			{
				"title": "Credentials and privileges",
				"text": "The exporter uses a dedicated least-privilege ClickHouse writer account; the backend uses a separate read-only ClickHouse account. Migration and backup permissions belong to separate operational identities. PostgreSQL application permissions are limited to the required tables and actions. Credentials are injected outside images and source control. vigil.ingestion-key authenticates the services-to-Collector hop only and is separate from database credentials."
			}
		]
	},
	{
		"id": "decisions",
		"title": "Operations and verification",
		"summary": "Operational monitoring observes the Collector and databases independently of the evaluation callback.",
		"items": [
			{
				"title": "Callback health",
				"text": "Every exhausted callback retry sequence emits an error log and increments an exporter failure counter. Callback latency and failures are monitored directly, not solely through VIGIL evaluation. The p95 evaluation-callback latency target is below 2 seconds under representative load; this is a measured target, not a performance guarantee."
			},
			{
				"title": "Queue and disk thresholds",
				"text": "Collector queue utilization above 80% for 5 minutes raises a warning. Disk usage above 80% raises a warning and above 90% raises a critical alert. Monitoring covers the persistent database volumes and Collector storage as applicable."
			},
			{
				"title": "Backup freshness",
				"text": "A last successful backup older than 26 hours raises a warning for each database. Backup failures and restore-test failures are surfaced independently of the callback evaluation path."
			},
			{
				"title": "Verification requirements",
				"text": "Tests cover write-before-callback ordering, synchronous visibility on the same ClickHouse instance, timeout and 5xx retry behavior, non-retryable 4xx errors, retry exhaustion, response loss, duplicate alerts, and Collector crashes between storage and callback completion. Callback-only failures must not resend successful writes. Backup restoration is verified before deployment and monthly."
			}
		]
	}
];

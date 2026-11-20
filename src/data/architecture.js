export const ARCHITECTURE_DELIVERY_DIAGRAM = `flowchart TD
	subgraph CollectorWork["Collector · write before callback"]
		Exporter["Custom Collector exporter<br/>Dedup + notification ID<br/>Insert + visibility SELECT"]
	end
	subgraph ApiWork["API · synchronous request"]
		Evaluate["SSE attempt, then watchdog<br/>Enabled rules + aggregates<br/>Event-time windows"]
		Trigger{"Any threshold met with<br/>no open alert for rule?"}
		subgraph AlertSave["PostgreSQL · one save transaction"]
			Commit["Alert history snapshots<br/>+ per-user notifications"]
		end
		Dispatch["Best-effort WebSocket<br/>then submit AI job"]
		Done["Return 204 No Content"]
		Evaluate -->|"Check value + open history"| Trigger
		Trigger -->|"Yes · collect new alerts"| Commit
		Trigger -->|"No new alerts"| Done
		Commit -->|"After commit"| Dispatch
		Dispatch -->|"Submission only; no AI wait"| Done
	end
	subgraph AsyncWork["API · asynchronous executor"]
		Job["Submitted AI task"]
		Analysis["AI analysis<br/>then webhook attempt"]
	end
	Exporter -->|"Confirmed; POST :8081"| Evaluate
	Job -->|"When executor runs"| Analysis`;

export const ARCHITECTURE_SECTIONS =
[
	{
		id: 'alert-connection',
		title: 'Live alert connection',
		summary: 'The sidebar reports the socket state. After a disconnect, Retry opens a fresh connection. Each successful open refreshes alert history and personal notifications.',
		diagram: `flowchart TD
		subgraph Dashboard["Authenticated dashboard"]
			Start["Mount with access token"]
			Refresh["Invalidate history and<br/>personal notifications"]
			Update["Handle incoming frame"]
			Retry["Show disconnected state"]
		end
		subgraph Socket["Browser WebSocket"]
			Connect{"Did /api/alerts/ws open?"}
			Event{"Next socket event?"}
		end
		Start -->|"Token in query"| Connect
		Connect -->|"Opened"| Refresh
		Connect -->|"Closed before open"| Retry
		Event -->|"Message"| Update
		Event -->|"Close"| Retry
		Refresh -->|"Listen"| Event
		Update -->|"Listen"| Event
		Retry -->|"User selects Retry"| Connect`,
		items: [{ title: 'Recovering the dashboard', text: 'The dashboard invalidates its history and notification queries on open. Frames received while disconnected are not replayed.' }]
	},
	{
		id: 'offline-navigation',
		title: 'Offline navigation',
		summary: 'The service worker tries the network for page navigation. If the request fails, the browser displays the offline page saved during installation.',
		diagram: `flowchart TD
		subgraph Worker["Installed service worker"]
			Visit["Page navigation"]
			Read{"Did fetch resolve?"}
		end
		subgraph Browser["Navigation response"]
			Page["Return network response"]
			Cache[("Precached /offline.html")]
			Fallback["Display offline page"]
		end
		Visit -->|"Fetch requested URL"| Read
		Read -->|"Yes · any HTTP status"| Page
		Read -->|"Network rejection"| Cache
		Cache -->|"Return cached document"| Fallback`,
		items: [{ title: 'Offline assets', text: 'The installation cache includes the fallback page, font, colors stylesheet and favicon. API reads have no service-worker fallback.' }]
	},
	{
		"id": "overview",
		"title": "System overview",
		"summary": "Three paths share one Compose host: a producer stores a batch, the dashboard reads alert history, and a queued job asks the local model for analysis.",
		"diagram": `flowchart TD
		subgraph Clients["Outside the host"]
			Producer["Instrumented service"]
			Browser["Dashboard · alert history"]
		end
		subgraph Host["Single Compose host · shared bridge"]
			Ingest["Caddy strips /otlp"]
			Collector["Collector :4318"]
			CH[("ClickHouse · telemetry")]
			Confirmed["Exporter confirms visibility"]
			Callback["API :8081 · evaluate batch"]
			WAF["Caddy forwards to WAF"]
			API["API :8080 · history query"]
			PG[("PostgreSQL · alert history")]
			Job["API · queued analysis"]
			LLM["FastAPI :8000"]
			Ollama["Ollama :11434"]
		end
		Producer -->|"HTTPS /otlp/v1/*"| Ingest
		Ingest -->|"Bearer-authenticated OTLP/HTTP"| Collector
		Collector -->|"Insert retained rows"| CH
		CH -->|"Return exact batch count"| Confirmed
		Confirmed -->|"POST metadata"| Callback
		Browser -->|"HTTPS /api/alerts"| WAF
		WAF -->|"Allowed request"| API
		API -->|"Read saved alerts"| PG
		Job -->|"Internal inference request"| LLM
		LLM -->|"Stream local chat"| Ollama`,
		"items": [
			{
				"title": "Audit boundary and evidence",
				"text": "These statements describe checked-in implementation, not a verified running installation. Sources: docker-compose.yml; services/reverse-proxy/Caddyfile and Dockerfile; services/telemetry-collector/buildtime/exporter; services/telemetry-db/clickhouse-init.sh; services/api/src/main; services/llm/app; security/vault. Environment values, actual secrets, deployed database DDL, off-host infrastructure and production performance were not inspected. Other endpoint data files may still describe intended rather than implemented behavior."
			},
			{
				"title": "Public and private services",
				"text": "Compose publishes only reverse-proxy TCP ${HTTPS_PORT:-8443}:443. The frontend is built into the Caddy image, not a separate web service. API ports 8080/8081, Collector 4318, PostgreSQL 5432, ClickHouse 8123/9000, FastAPI 8000 and Ollama 11434 are unpublished. Application services share the default Compose bridge; it is not an internal:true network or per-service isolation boundary. Vault and its bootstrap/agent containers use a separate internal:true vault_internal network, transferring secrets to consumers through named volumes."
			},
			{
				"title": "Implemented UI is narrower than backend capability",
				"text": "services/web/src/App.tsx mounts overview, telemetry, alerts, admin rules/onboarding and nested settings, plus public auth/legal pages. Root redirects to overview; the wildcard 404 is authenticated and uses DashboardLayout. There is no status or AI Insights route, and the existing AlertNotificationsPage file is not mounted. The dashboard supplies a notification bell and alert-scoped AI drawer, not general chat. Metrics charts use /metrics/series; local chart selection does not filter raw-point CSV. Backend endpoints and source page files alone are not evidence of exposed UI. The drawer is mounted, but alertAskApi.ts sends { question, history } while AlertAskRequestDto accepts only question and application.properties rejects unknown fields; the checked-in browser ask request is rejected before SSE. Backend question streaming is implemented, not a working UI integration. See pages.js for route-level behavior."
			},
			{
				"title": "Independent commits and volatile coordination",
				"text": "ClickHouse telemetry writes and PostgreSQL alert commits are independent. Callback metadata is not persisted or deduplicated by notification_id. Collector deduplication/visibility recovery, API silence timers, SSE/WebSocket registries, AI work and webhook work are process-local. There is no durable evaluation queue, replay worker, cross-database transaction, replication or exactly-once guarantee."
			}
		]
	},
	{
		"id": "telemetry",
		"title": "Telemetry and time",
		"diagram": `flowchart TD
		subgraph Pipeline["Collector · one pipeline per signal"]
			Receive["Receive OTLP/HTTP<br/>Validate bearer token"]
			Batch["Limit memory and batch rows"]
			Store["Write and confirm visibility"]
		end
		subgraph Callback["API · confirmed batch"]
			Timer["Advance timer only when<br/>stored_at is newer"]
			Window["Evaluate enabled rules"]
		end
		subgraph Scheduler["Independent scheduled check"]
			Deadline["Timer at stored_at + timeout"]
			Current{"Still the latest stored_at?"}
			Silent["Create critical service_silent"]
			Stale["Ignore superseded timer"]
		end
		Receive -->|"Logs, metrics or traces"| Batch
		Batch -->|"Retained rows"| Store
		Store -->|"Callback · after SSE attempt"| Timer
		Timer -->|"Use latest_timestamp as window end"| Window
		Deadline -->|"Check service watermark"| Current
		Current -->|"Yes"| Silent
		Current -->|"No"| Stale`,
		"summary": "Vault renders the active Collector configuration; OTLP/HTTP ingestion is authenticated, batched and stored before the metadata callback.",
		"items": [
			{
				"title": "Active pipeline",
				"text": "Compose overrides the image configuration with /vigcol --config /run/secrets/collector-config.yaml, rendered from security/vault/agent/collector-config.tpl. It enables only OTLP/HTTP on 0.0.0.0:4318 with bearertokenauth reading the ingestion-key file. Each logs/metrics/traces pipeline runs memory_limiter then batch then the custom vigilclickhouse exporter. No OTLP/gRPC receiver, persistent queue or exporter-helper sending queue/retry policy is configured. The checked-in runtime/config.yaml is not the Compose runtime configuration."
			},
			{
				"title": "Batching and memory limits",
				"text": "The batch processor targets 1,000 items, flushes after 5 seconds and caps batches at 5,000 items. Compose defaults the memory limiter to 384 MiB with a 96 MiB spike allowance, checked every second. The exporter rejects an entire serialized batch above 1,048,576 bytes by default as a permanent error; it does not split that batch. Validation can reject a whole batch for one invalid record. These are process protections, not Docker memory reservations or a durable backpressure guarantee."
			},
			{
				"title": "Deduplication and correlation",
				"text": "delivery.go and dedup.go retain row keys in memory for 10 minutes by default. Logs hash their converted row, metrics hash series/time/start-time/payload identity, and traces use trace_id/span_id. Keys are computed before the exporter overwrites attributes['vigil.notification_id']; the serialized-byte check also precedes filtering duplicates. A UUID identifies the retained rows and the callback. Exact-ID ClickHouse queries feed live SSE; threshold evaluation reads the full service/time window instead. Deduplication is neither a ClickHouse uniqueness constraint nor durable across Collector restart."
			},
			{
				"title": "Stored representation and metric limitations",
				"text": "rows.go requires service.name and valid event timestamps and truncates stored event times to milliseconds. Resource and point/record attributes are merged into string maps. Metrics preserve type, unit, temporality, monotonicity, start time, series_id, and histogram sum/count. Histogram bucket distributions are used in dedup payload hashes but are not persisted; summaries are rejected at ingestion, not merely omitted from bucketed reads. Full OTLP round-trip fidelity, exemplars and histogram percentile reconstruction are not provided."
			},
			{
				"title": "Evaluation clock and silence detection",
				"text": "The callback sends each service's maximum stored event timestamp as latest_timestamp. Rule SQL uses (latest_timestamp - window_seconds, latest_timestamp], while stored_at is assigned after visibility confirmation. SilenceWatchdog shares max(stored_at) across all signals per service and schedules one check at stored_at plus the configurable timeout, default 300 seconds. Duplicate or older callbacks do not advance freshness. Timers disappear on API restart; services are tracked only after a callback. Silence alerts use service_silent, critical severity, wall-clock triggered_at and null rule/threshold; there is no open-alert suppression in this separate path."
			}
		]
	},
	{
		"id": "delivery",
		"diagram": ARCHITECTURE_DELIVERY_DIAGRAM,
		"title": "Storage-success delivery and alert evaluation",
		"summary": "The Collector owns both the synchronous ClickHouse write/visibility check and subsequent callback; the API saves alerts synchronously but delegates AI and webhooks.",
		"items": [
			{
				"title": "Write, confirm, notify",
				"text": "storage.go sends INSERT ... FORMAT JSONEachRow over HTTP with async_insert=0 and wait_end_of_query=1, then SELECT count() WHERE attributes['vigil.notification_id'] equals the batch UUID and checks the exact retained row count. Only then is stored_at set and the callback attempted. The exporter and API queries target the same single ClickHouse instance; no distributed tables or replicas are configured."
			},
			{
				"title": "POST /internal/alerts/trigger-evaluation",
				"text": "Required JSON: notification_id UUID, signal_type logs | metrics | traces, stored_at timestamp, and a nonempty services array of unique service/latest_timestamp pairs. IngestController accepts this route only on local port 8081; 8080 returns 404. BACKEND_CALLBACK_URL must therefore target http://api:8081/internal/alerts/trigger-evaluation; Compose supplies it from the environment without a default. Input errors return 400, processing exceptions 500 and success 204. The endpoint has no additional callback credential or internal TLS."
			},
			{
				"title": "Actual processing order and transaction boundary",
				"text": "IngestService first queries exact-ID rows and broadcasts telemetry SSE best-effort, then refreshes service silence timers, then synchronously queries enabled PostgreSQL rules for each service/signal and computes ClickHouse aggregates. A non-null aggregate >= threshold triggers only when no alert for that rule is sent or acknowledged. New alert_history snapshots and one unseen notification for every current users row are committed together by transactional AlertsService.saveAlertsService before alert/recipient WebSocket broadcasts and AI submission. Rule reads and ClickHouse evaluation are outside that save transaction. A 204 does not guarantee SSE, WebSocket, AI or webhook delivery; SSE and watchdog side effects can precede an evaluation failure."
			},
			{
				"title": "Open-alert suppression is not callback idempotency",
				"text": "evaluateAlertRules is synchronized within the single API process and checks rule_id against statuses sent/acknowledged. Repeated callbacks normally do not create another threshold alert while one remains open. Resolving it allows a repeated or overlapping event-time window to create a new alert. No notification_id ledger or database uniqueness constraint makes this exactly-once; multiple API instances would bypass the process-local lock. Silence alerts do not use this rule-based suppression. Source: IngestService.java and AlertHistoryRepository.java."
			},
			{
				"title": "Callback retry policy",
				"text": "Each callback attempt has a 10-second timeout. callback.go makes at most 3 attempts total, with 1 second and then 2 seconds of backoff plus up to 250 ms jitter, bounded by the caller context. Retry connection failures, timeouts and 5xx; do not retry 4xx or other unexpected statuses. Redirects are disabled and only 204 succeeds. notification_id, stored_at and services stay unchanged across these attempts. An exhausted callback logs an error and increments vigil.exporter.callback.failures, but is swallowed rather than returned as a retryable whole-export failure that would resend the successful write."
			},
			{
				"title": "Concurrent delivery is rejected, not queued",
				"text": "delivery.go holds an exporter-instance mutex through insert, visibility confirmation and callback attempts. TryLock failure returns errDedupInFlight rather than waiting. factory.go creates separate exporter instances for logs, metrics and traces, so this is not one global cross-signal lock. No exporter-helper retry queue is installed; a retryable error does not establish that the pipeline will replay it. Pending visibility recovery needs a later overlapping delivery and has no autonomous scheduler."
			},
			{
				"title": "Visibility recovery and crash limitations",
				"text": "After a successful insert, a failed visibility check retains pending metadata/row keys and returns an export error. An overlapping later delivery can recheck visibility without reinserting those rows; no autonomous recovery worker is configured. Callback-only failures are discarded after their retry sequence. Pending state, dedup keys and callback retries exist only in memory. An ambiguous insert response can still cause duplicate storage on resend, and a crash between storage and callback can lose evaluation/live delivery. Later overlapping windows do not guarantee recovery."
			}
		]
	},
	{
		"id": "databases",
		"title": "Database storage and retention",
		"diagram": `flowchart LR
		subgraph Application["Database clients · distinct operations"]
			Exporter["Collector exporter"]
			Query["API telemetry queries"]
			Edit["API application writes"]
			Save["API alert-save transaction"]
		end
		subgraph TelemetryStore["ClickHouse · independent commit"]
			CH[("Logs / metrics / traces<br/>30-day TTL · merge cleanup")]
			CHVolume[("clickhouse_data")]
			Rows["SELECT rows or aggregates"]
		end
		subgraph AppStore["PostgreSQL · independent commits"]
			State[("Users, sessions, rules, hooks")]
			Alerts[("Alert history + notifications")]
			PGVolume[("postgres_data")]
		end
		Exporter -->|"Insert telemetry"| CH
		CH -->|"Persist rows"| CHVolume
		Query -->|"Read-only ClickHouse SELECT"| Rows
		Edit -->|"JPA write"| State
		State -->|"Persist state"| PGVolume
		Save -->|"One commit"| Alerts
		Alerts -->|"Persist both together"| PGVolume`,
		"summary": "ClickHouse holds telemetry with event-time TTL; PostgreSQL holds JPA-managed application state. Persistence volumes exist, but backup automation and versioned migrations are not supplied.",
		"items": [
			{
				"title": "ClickHouse layout and initialization",
				"text": "services/telemetry-db/clickhouse-init.sh creates single-node MergeTree logs, metrics and traces with PARTITION BY toYYYYMM(timestamp) and TTL timestamp + INTERVAL 30 DAY DELETE. ORDER BY is (service, timestamp), (service, name, timestamp), and (service, timestamp, trace_id, span_id), respectively. This is the configured 30-day TTL, not proof of measured query performance. CREATE TABLE IF NOT EXISTS does not upgrade an existing table's columns, keys or TTL. clickhouse_data persists /var/lib/clickhouse."
			},
			{
				"title": "Retention and backups: implementation limits",
				"text": "ClickHouse TTL deletion occurs asynchronously during background merges; late telemetry already older than 30 days can become eligible immediately. No automatic alert-history expiry or database backup service/job is supplied. Daily encrypted off-host backups, 7-day retention, a 24-hour recovery point, backup-age monitoring and monthly restore verification are not established by this repository. Named volumes survive ordinary container replacement, not host loss; PostgreSQL, ClickHouse, Vault and TLS state need an operator-defined backup/restore plan."
			},
			{
				"title": "PostgreSQL mappings, not a migration-managed schema",
				"text": "Compose defaults SPRING_JPA_HIBERNATE_DDL_AUTO to update. JPA entities map users, sessions, refresh_tokens, alert_rules, alert_history, webhooks, and an implicitly named alert_notification table. The spec's alert_notifications key is a logical reference; AlertNotification has no explicit plural @Table. AlertHistory.user normally maps to user_id, while the API exposes ownership as owner_id. UUIDs are generated by Hibernate, not a declared gen_random_uuid() default. Thresholds are Java Double, not NUMERIC. No Flyway/Liquibase dependency, versioned migration set or explicit workload indexes is supplied. Existing deployed DDL was not inspected."
			},
			{
				"title": "Shared history and personal notifications",
				"text": "History snapshots survive rule deletion through SET NULL; owner deletion also sets the user relation null while actor email snapshots remain. @Version provides optimistic locking, and the explicit LLM update also increments version. Recipient rows have composite user/history IDs and cascading foreign keys, with personal seen/seen_at separate from shared sent/acknowledged/resolved status. AlertsService creates recipients from userRepository.findAll(), including the persisted API account. No automatic alert-history expiry is implemented. Source: domain/entities and AlertsService.java."
			},
			{
				"title": "Connection pools and database privileges",
				"text": "DataSourceConfig.java creates separate Hikari pools for PostgreSQL and ClickHouse without setting pool sizes; Hikari's default maximum of 10 connections applies to each, not an explicitly tuned host budget. ClickHouse pool initialization is allowed to proceed without an initial connection. vigil_api is reset to SELECT-only on the three telemetry tables. vigil_writer receives INSERT and SELECT for visibility confirmation; its existing grants are not revoked and its authentication uses plaintext_password. PostgreSQL uses the same POSTGRES_USER as image initialization, with no separate restricted application role provisioned; on a fresh official image this is normally a superuser."
			},
			{
				"title": "Metric read-path hazards",
				"text": "MetricsRepository computes chart buckets in ClickHouse, using series_id for cumulative differencing before grouping by service/name/bucket. It then chooses unit/kind/internal via any(), so different units, types or labels sharing a name can be merged. start_timestamp is stored but not used in reset handling; only value/count/sum comparisons and first-row checks are used, with no pre-window baseline. Nonempty unknown types are not explicitly rejected by this query. Scalar threshold evaluation separately aggregates raw non-null values by metric name, not counter rates or histogram distributions. These limitations should not be diagrammed as fully type-safe or reset-complete aggregation. Frontend useMetrics/useTraces and timestamp-sorted useLogs use timestamp-only pagination bookmarks; tied timestamps need explicit pagination coverage. MetricsPage merges up to 200 live points without applying the selected historical period, while useMetricSeries polls the selected period every 60 seconds: the table and charts are not one synchronized snapshot. Sources: services/web/src/hooks/useMetrics.ts, useTraces.ts, useLogs.ts, useLiveMetrics.ts and pages/Metrics/MetricsPage.tsx."
			}
		]
	},
	{
		"id": "deployment",
		"title": "Deployment, proxy and security boundaries",
		"summary": "Caddy terminates public TLS; only /api/* traverses the WAF. Vault supplies static secrets over per-service volumes, not dynamic database leases or end-to-end TLS.",
		"diagram": `flowchart TD
		Public["HTTPS request · :8443 default"]
		subgraph Proxy["Caddy · ordered request match"]
			Route{"First matching path?"}
			Forbidden["403 Forbidden"]
			Hidden["404 Not Found"]
			Static["Serve file or index.html"]
		end
		subgraph PrivateHops["Private upstreams"]
			WAF["WAF :8080"]
			API["Spring Boot :8080"]
			Collector["Collector :4318<br/>Bearer check"]
		end
		Public -->|"Terminate TLS"| Route
		Route -->|"Sensitive path"| Forbidden
		Route -->|"/internal or /internal/*"| Hidden
		Route -->|"/api/*"| WAF
		Route -->|"/otlp/* · strip prefix"| Collector
		Route -->|"Otherwise"| Static
		WAF -->|"Allowed request"| API`,
		"items": [
			{
				"title": "Proxy routing",
				"text": "services/reverse-proxy/Caddyfile blocks sensitive file paths and /internal routes, proxies /api/* to waf:8080, strips /otlp from /otlp/* before forwarding to telemetry-collector:4318, and serves the bundled SPA for other paths. The WAF proxies API requests to api:8080 with response buffering disabled and WebSocket upgrade headers. OTLP ingestion bypasses the WAF; it relies on the Collector bearer check and its resource limits. Root /v1/* paths are not Collector ingress in this configuration. Caddy replaces client-supplied X-Forwarded-For and removes Forwarded for the API hop; Tomcat uses native forwarded-header handling."
			},
			{
				"title": "Onboarding OTLP address",
				"text": "Use https://<reachable-host>:<published-port>/otlp as the OTLP/HTTP base, so SDK exports reach /otlp/v1/traces, /otlp/v1/logs and /otlp/v1/metrics. Caddy removes only /otlp and preserves Authorization: Bearer ingestion_key for bearertokenauth. These are ingestion routes, not authenticated API telemetry reads. Local TLS requires trusting the installation's exported public CA certificate; never distribute its private key or send ingestion keys to an unrelated deployment. Verify an actual instrumented export, not an SPA fallback or reachability-only response. The optional mock-telemetry-sender profile is not a ready-to-run acceptance check: Compose supplies a placeholder ingestion key and a portless https://localhost/otlp endpoint despite the default host port 8443. Operators must supply matching credentials and reachable endpoint/trust settings."
			},
			{
				"title": "TLS ownership and control",
				"text": "Caddy starts with localhost/tls internal. Its entrypoint reconstructs persisted configuration, starts a Go TLS-control helper on /run/vigil-tls/control.sock, then starts Caddy. The API reaches this socket through a read-only shared volume, not Caddy's loopback admin API. The helper persists hosts.json and generated Caddyfile under /config/vigil-tls, reloads Caddy and probes certificates on 127.0.0.1:443 with the requested server name. Only root.crt is copied into the API's read-only public-CA volume; Caddy's private CA remains in caddy_data. Socket/UID permissions are part of this same-host trust boundary."
			},
			{
				"title": "Port and certificate reachability hazard",
				"text": "Compose defaults public HTTPS to 8443, while frontend-base URL defaults and the optional host-network mock sender use https://localhost without that port. The TLS helper preserves an explicitly supplied nondefault origin port, but renders Caddy listeners and probes certificates on internal port 443; that probe does not verify external host-port routing. Align HTTPS_PORT, externally reachable routing and advertised URLs; merely obtaining a verified certificate does not fix mismatched URL defaults. Only TCP 443 is mapped internally; public ACME challenge reachability is deployment-dependent and not demonstrated by the Compose file."
			},
			{
				"title": "Internal trust is not isolation from peer containers",
				"text": "The callback on API 8081 is permitAll and protected by its local-port check and unpublished port, not a credential. API, databases, Collector, WAF, FastAPI and Ollama share the default bridge and use plaintext internal HTTP/database connections as configured. FastAPI's /internal/llm routes have no service authentication; X-Vigil-User-Id is a rate-limit identity supplied by the API, not proof of identity against a malicious peer. A compromised default-network container can bypass public proxy controls. Cross-host or less-trusted deployment requires authenticated service access, TLS and tighter network policy."
			},
			{
				"title": "Custom Collector image",
				"text": "The Go exporter is compiled with OpenTelemetry Collector Builder into a custom Docker image using a nonroot distroless runtime. Compose selects the Vault-rendered config rather than the image's fallback config. No built-in exporter-helper durable queue, disk spool or general export retries are instantiated by factory.go; the explicit retries are for the post-storage callback. This distinction matters for storage errors and memory-limiter/batch backpressure."
			}
		]
	},
	{
		"id": "vault",
		"title": "Vault secret lifecycle",
		"summary": "A single file-backed Vault bootstraps static KV-v2 values and four AppRoles; agents render per-consumer files. This is a same-host demonstration boundary, not managed secret rotation.",
		"diagram": `flowchart TD
		subgraph Bootstrap["Bootstrap · Vault init"]
			Vault["Seed role-specific KV v2 docs<br/>from selected deployment values"]
			Roles["Provision policies and AppRoles"]
		end
		subgraph Agent["Each of four agents · its configured role"]
			Login["Log in with role credentials"]
			Read["Read role-scoped KV"]
			Render["Render templates to volume"]
		end
		subgraph Consumer["API · PostgreSQL · ClickHouse · Collector"]
			Mount["Read own mounted files"]
		end
		Vault -->|"Then configure auth"| Roles
		Roles -->|"Role ID and secret ID files"| Login
		Login -->|"Role token"| Read
		Read -->|"Template values"| Render
		Render -->|"Read-only consumer mount"| Mount`,
		"items": [
			{
				"title": "Bootstrap and rendering flow",
				"text": "security/vault/scripts/init-vault.sh waits for Vault, initializes it once, stores bootstrap credentials in vault_init, unseals it, imports selected application.env fields into role-specific KV documents once, and creates read policies/AppRole credentials for api, postgres, clickhouse and collector. Each vault-agent authenticates over vault_internal and renders a dedicated secrets volume; application mounts are read-only. API loads configtree:/run/secrets/, PostgreSQL uses POSTGRES_PASSWORD_FILE, ClickHouse wrappers read rendered files, and the Collector gets a rendered YAML plus bearer-key file. Policies restrict each role to its own KV document."
			},
			{
				"title": "Security limitations",
				"text": "vault.hcl uses a single-node file backend, disables TLS and mlock, and exposes no host port. Bootstrap uses one unseal share with threshold one and retains both the unseal key and initial root token in the same host's vault_init volume; the bootstrap process automatically unseals when needed. AppRole secret IDs have no expiry/use limit. Rendered files use 0444 within service-specific volumes and agents/bootstrap run as root. Vault encrypts its own backend, but rendered secret volumes and application database/TLS volumes have no at-rest encryption configured here. Host/Docker access remains highly privileged."
			},
			{
				"title": "Ingestion-key distribution is implemented; rotation is not",
				"text": "init-vault.sh imports the same VIGIL_INGESTION_KEY into API and Collector KV documents on initial bootstrap and backfills a missing API key from the Collector document for existing installations. api.hcl renders the API configtree value; collector.hcl renders the bearer-key file used by collector-config.tpl. The page's read-only key display therefore does not require a Java-to-Collector writer in Compose. These are separate static KV values, not ongoing synchronization: later independent edits can diverge. Agents poll static secrets every 5 minutes, but no consumer reload/restart hook is configured for API configtree, Collector YAML or database credentials. Changing the bootstrap .env does not reimport existing KV documents, and changing a PostgreSQL password file does not rotate an existing database role. ClickHouse-init resets application passwords only when that one-shot job runs. File-existence healthchecks establish rendered files, not fresh credentials, successful login or consumer reload. Rotation must coordinate KV, database grants and consumer restarts; there are no dynamic DB leases or automated end-to-end rotation."
			}
		]
	},
	{
		"id": "ai",
		"title": "AI analysis and webhook flow",
		"summary": "The API gathers ClickHouse context and consumes FastAPI SSE from a local Ollama model. Only automatic analysis is saved; chat and work queues are ephemeral.",
		"diagram": `flowchart TD
		subgraph Automatic["Committed alert · automatic job"]
			Saved["Queue analysis"]
			Forward["Read context · call /forward"]
			Result{"Analysis available?"}
			Unavailable["Use Analysis unavailable"]
			Persist["Update alert history"]
			Hooks["Broadcast llm frame<br/>then submit webhooks"]
		end
		subgraph Question["Authenticated question · same API executor"]
			Ask["Queue question for alert"]
			Prompt["Read context · call /ask"]
			Relay["Relay SSE to caller"]
		end
		Saved -->|"Single worker"| Forward
		Forward -->|"FastAPI streams from Ollama"| Result
		Result -->|"Yes · model text"| Persist
		Result -->|"Context or inference failed"| Unavailable
		Unavailable -->|"Fallback text"| Persist
		Persist -->|"Alert still present"| Hooks
		Ask -->|"Single worker"| Prompt
		Prompt -->|"Token / done / error"| Relay`,
		"items": [
			{
				"title": "Automatic analysis",
				"text": "LlmService submits saved alerts to a single-thread ExecutorService. It fetches all logs, metrics and traces for that service in the rule window ending at triggered_at, or the silence timeout window for service_silent. It POSTs alert/rule/context JSON to http://llm:8000/internal/llm/forward and consumes token/done SSE. Completion updates alert_history.llm_analysis and increments version, broadcasts an llm WebSocket frame, then submits webhooks. Errors persist 'Analysis unavailable' and normally follow the same broadcast/webhook path. The API client defaults to 30 seconds per upstream stream plus a 5-second connection timeout; queue/context-fetch time is not covered by that stream timeout."
			},
			{
				"title": "Question flow and persistence",
				"text": "The authenticated alert ask endpoint uses the same executor, fetches fresh service/window context and includes the existing analysis truncated to 5,000 characters. The API supplies X-Vigil-User-Id to /internal/llm/ask, forwarding token, done or error SSE to the browser. Questions and answers are not stored as chat history and do not replace the saved automatic analysis. Client completion/error cancels its FutureTask. This describes backend capability: services/web/src/api/alertAskApi.ts always adds history, which AlertAskRequestDto does not accept under fail-on-unknown-properties=true. The current drawer therefore fails request deserialization rather than reaching this stream. Fixing the contract is required before claiming working interactive UI. Source: LlmService.java, LlmClient.java, AlertAskRequestDto.java and application.properties."
			},
			{
				"title": "FastAPI and Ollama",
				"text": "FastAPI uses caller-supplied context; it has no database connection. context.py selects at most 20 logs by severity/time, 10 metrics by name/proximity and 10 traces preferring errors/long duration; log messages are truncated to 160 characters. routes/llm.py applies a default one-request concurrency limit with 0.5-second slot wait and 5 asks per user per 60 seconds. It obtains a first token before returning HTTP 200 SSE, with 503 for early failure/busy and SSE error for later failure. Ollama streams /api/chat using qwen2.5:0.5b by default, 4096 context, 200 predicted tokens, temperature 0.3 and a 25-second adapter generation budget. No hosted AI provider is configured; initial model pull needs network access."
			},
			{
				"title": "Queue, context and external-delivery hazards",
				"text": "Automatic analysis and interactive questions share an unbounded single-thread API executor, so slow jobs delay both and backlog is lost on restart. ClickHouse context is materialized without a row limit before FastAPI selects a small prompt; prompt limits do not bound API query memory or JSON payload size. No telemetry-secret redaction or prompt-injection isolation beyond prompt text is established. WebhookDeliveryService has another single-thread executor and sends each URL once with 5-second connect/read timeouts, no retry/outbox or delivery history. Webhooks are downstream of analysis persistence and WebSocket broadcast; an exception in that block can skip delivery."
			}
		]
	},
	{
		"id": "startup",
		"title": "Startup dependency graph",
		"summary": "Read each lane as a Compose start condition. The API requires both databases and completed ClickHouse initialization. The Collector can start before the API, and inference starts independently.",
		"diagram": `flowchart LR
		subgraph Secrets["Secret bootstrap"]
			Bootstrap["Vault starts · run vault-init"]
			Agents["Four role agents start"]
			Bootstrap -->|"Init healthy"| Agents
		end
		subgraph Storage["Database startup"]
			PgGate["Postgres agent healthy"]
			PG["Start PostgreSQL"]
			ChGate["ClickHouse agent healthy"]
			CH["Start ClickHouse"]
			Init["Run ClickHouse init"]
			PgGate -->|"File gate"| PG
			ChGate -->|"File gate"| CH
			CH -->|"Healthy"| Init
		end
		subgraph Ingress["Application startup · all listed gates required"]
			ApiGate["API agent and both DBs healthy<br/>ClickHouse init completed"]
			API["Start API"]
			WAF["Start WAF"]
			CollectorGate["Collector agent healthy<br/>ClickHouse init completed"]
			Collector["Start Collector"]
			Proxy["Start Caddy once API and<br/>Collector have also started"]
			ApiGate -->|"All gates met"| API
			API -->|"Started"| WAF
			CollectorGate -->|"Both gates met"| Collector
			WAF -->|"WAF healthy"| Proxy
		end
		subgraph AiStartup["Independent inference startup"]
			Ollama["Ollama healthy"]
			Pull["Pull configured model"]
			LLM["Start FastAPI"]
			Ollama -->|"Start init job"| Pull
			Pull -->|"Completed successfully"| LLM
		end`,
		"items": [
			{
				"title": "Database and ingress branch",
				"text": "docker-compose.yml gates PostgreSQL/ClickHouse on their respective agents' rendered-file healthchecks, then gates clickhouse-init on ClickHouse health. API waits for PostgreSQL and ClickHouse health, clickhouse-init success and API-agent files. Collector waits only for clickhouse-init success and collector-agent files, not API startup. WAF waits for API service_started and checks its own /healthz; Caddy waits for API/Collector service_started and WAF healthy. API, Collector and Caddy have no Compose application-readiness healthchecks. An early successful telemetry write can exhaust callbacks while API is still starting."
			},
			{
				"title": "AI branch",
				"text": "Ollama's ollama list healthcheck gates a one-shot ollama-model-init pull, whose success gates FastAPI. FastAPI attempts a one-token warm-up with up to 120 seconds of HTTP timeout and logs failure but continues. /health then returns status ok without testing model generation. API has no depends_on llm health or model readiness; alerts can be persisted before AI is available and fall back to Analysis unavailable. Model files persist in ollama_data."
			},
			{
				"title": "Restart and recovery limits",
				"text": "Compose startup conditions are not continuous dependency supervision. Several services use unless-stopped, but API, PostgreSQL, ClickHouse and the one-shot ClickHouse initializer do not declare that restart policy. No failover or HA database/Vault topology is present. Recovery must account for database volumes, Vault data plus matching bootstrap/AppRole volumes, rendered credentials, API admin credentials, Caddy CA/config/TLS state and Ollama models; preserving just telemetry and relational volumes is not a complete installation restore."
			}
		]
	},
	{
		"id": "decisions",
		"title": "Operations and verification limits",
		"diagram": `flowchart TD
		subgraph Runtime["Collector · rows already confirmed"]
			Attempt["POST metadata · 10s timeout"]
			Result{"Callback outcome?"}
			Retry{"Attempts left and<br/>caller still active?"}
			Wait{"Backoff completes<br/>before cancellation?"}
			Complete["HTTP 204 · callback complete"]
			Failure["Log and count failure"]
			Discard["End delivery without replay"]
			Attempt -->|"Inspect result"| Result
			Result -->|"204"| Complete
			Result -->|"Transport failure or 5xx"| Retry
			Result -->|"Other HTTP status"| Failure
			Retry -->|"Yes · up to three attempts"| Wait
			Retry -->|"No"| Failure
			Wait -->|"Yes"| Attempt
			Wait -->|"No · caller cancelled"| Failure
			Failure -->|"Keep stored rows"| Discard
		end
		subgraph Proposed["Proposed · recovery verification"]
			Backup["Off-host backup"]
			Restore["Isolated restore drill"]
			Backup -.->|"Verify recoverability"| Restore
		end`,
		"summary": "Implementation evidence is separated from operational guarantees: code emits callback failures, but monitoring deployment, backup schedules and performance results are not established.",
		"items": [
			{
				"title": "Implemented observability versus monitoring deployment",
				"text": "The exporter emits an error and vigil.exporter.callback.failures after callback failure; API and AI paths log failures. Compose supplies service healthchecks but no monitoring scraper, dashboard stack, external alert routing or backup-age monitor. No enforced Collector queue/disk thresholds or measured p95 callback latency target is established by the audited configuration. A failure counter existing in code does not prove that it is scraped or alerted on independently of VIGIL."
			},
			{
				"title": "Source tests are not deployment verification",
				"text": "The repository contains exporter unit tests, a Collector integration harness, API tests and security/proxy tests. Their presence is not evidence that they passed on this host or that backup restoration, real SDK exports, TLS public reachability or representative-load performance has been verified. This audit did not start the runtime, inspect secrets or query deployed databases. Validate callback loss/retry, insert ambiguity, schema upgrades, startup races, secret rotation and complete restore procedures in an isolated environment before relying on stronger guarantees."
			}
		]
	}
];

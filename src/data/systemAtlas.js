// Source paths are relative to the vigil repository, not this specification app.
// Planned nodes describe proposed work, not deployed capabilities or commitments.
const API = "services/api/src/main/java/com/ft_transcendence/vigil";
const EXPORTER = "services/telemetry-collector/buildtime/exporter";

export const SYSTEM_ATLAS = {
	id: "vigil",
	title: "VIGIL system atlas",
	description: "Source-audited single-host telemetry and alerting system. Implemented means present in checked-in code, not verified in a running installation. Planned items are explicitly marked; sources do not establish production guarantees.",
	source: "docker-compose.yml",
	children: [
		{
			id: "experience",
			title: "Browser and query experience",
			description: "Implemented React application served by Caddy, backed by Spring Boot reads and process-local live delivery.",
			source: "services/web/src/App.tsx",
			children: [
				{
					id: "experience-spa",
					title: "Bundled application",
					description: "Implemented: the reverse-proxy image builds services/web and serves its static output. Routes include overview, alerts, logs, metrics, traces, admin alert rules/onboarding and nested settings; there is no separate Compose web service. Public auth/legal routes are distinct from the protected dashboard wildcard. /status and /ai-insights are proposals, not mounted pages; AlertNotificationsPage exists but is unmounted (the bell is implemented).",
					source: "services/reverse-proxy/Dockerfile; services/web/src/App.tsx",
					children: []
				},
				{
					id: "experience-queries",
					title: "Historical telemetry and CSV",
					description: "Implemented: validated period/filter queries return paginated telemetry, metric chart series and streaming CSV exports from ClickHouse. Metric bucket intervals depend on the selected period. The implemented metrics UI selects chart names locally; selection does not filter raw-point reads or CSV. Traces expose no sort control despite backend support, and vigil.internal metrics filtering is a backend capability, not a mounted status dashboard.",
					source: `${API}/services/TelemetryService.java; services/web/src/pages/Metrics/MetricsPage.tsx; services/web/src/hooks/useTraces.ts`,
					children: []
				},
				{
					id: "experience-live",
					title: "Live telemetry and alerts",
					description: "Implemented: callbacks fetch exact notification-ID rows for best-effort telemetry SSE. Saved alerts broadcast shared WebSocket frames and recipient-specific notifications. These live deliveries are not durable queues. UI policies differ: logs/traces/metrics are opt-in and close SSE on error, while onboarding opens all three verification streams and allows native EventSource reconnect. Metrics charts poll every 60 seconds while live is selected, independently of raw SSE health. Dashboard WebSocket reconnect invalidates history/notification caches, not a server-side event replay.",
					source: `${API}/services/IngestService.java`,
					children: []
				}
			]
		},
		{
			id: "ingestion",
			title: "Telemetry ingestion and storage",
			description: "Implemented custom Go Collector exporter converts OTLP signals, writes ClickHouse and then notifies the API.",
			source: `${EXPORTER}/delivery.go`,
			children: [
				{
					id: "ingestion-pipeline",
					title: "Active Collector pipeline",
					description: "Implemented: Compose selects the rendered Collector YAML. Each OTLP/HTTP signal runs memory_limiter then batch, targeting 1000 items with a 5000-item maximum and 5-second timeout. The receiver is bearer-authenticated OTLP/HTTP only, not OTLP/gRPC. This is not a disk-backed queue; factory.go installs no exporter-helper sending queue or general export retry policy. Concurrent delivery on the same signal exporter returns an in-flight error instead of waiting.",
					source: "security/vault/agent/collector-config.tpl; docker-compose.yml",
					children: []
				},
				{
					id: "ingestion-delivery",
					title: "Write, confirm, callback",
					description: "Implemented: row keys are computed before notification-ID stamping; byte limits precede duplicate filtering. Retained rows are inserted, exact-ID visibility is checked, then stored_at and per-service latest event times are sent to the API.",
					source: `${EXPORTER}/delivery.go; ${EXPORTER}/storage.go`,
					children: [
						{
							id: "ingestion-retry",
							title: "Bounded callback retries",
							description: "Implemented: at most three callback attempts, 10 seconds each, within caller context; connection failures and 5xx can retry, only 204 succeeds. Final callback failure is logged and counted, not returned as a whole-export retry.",
							source: `${EXPORTER}/callback.go; ${EXPORTER}/delivery.go`,
							children: []
						},
						{
							id: "ingestion-recovery",
							title: "Volatile visibility recovery",
							description: "Implemented limitation: failed post-insert visibility checks retain pending state in memory. An overlapping delivery can recheck without reinserting those rows; there is no autonomous recovery worker or durable callback ledger.",
							source: `${EXPORTER}/delivery.go`,
							children: []
						}
					]
				},
				{
					id: "ingestion-clickhouse",
					title: "Telemetry tables and retention",
					description: "Implemented: single-node MergeTree logs, metrics and traces use monthly event-time partitions and a 30-day TTL. Deletion happens during background merges; CREATE TABLE IF NOT EXISTS does not migrate existing table definitions.",
					source: "services/telemetry-db/clickhouse-init.sh",
					children: []
				}
			]
		},
		{
			id: "alerting",
			title: "Evaluation and application state",
			description: "Implemented Spring Boot evaluation combines ClickHouse aggregates with PostgreSQL rules and transactional alert persistence; the databases commit independently.",
			source: `${API}/services/IngestService.java; ${API}/services/AlertsService.java`,
			children: [
				{
					id: "alerting-thresholds",
					title: "Event-time threshold evaluation",
					description: "Implemented: enabled rules are evaluated per service and signal at latest_timestamp. A non-null aggregate at or above threshold triggers unless that rule already has a sent or acknowledged alert. Synchronization is process-local, not callback idempotency.",
					source: `${API}/services/IngestService.java`,
					children: []
				},
				{
					id: "alerting-silence",
					title: "Service silence watchdog",
					description: "Implemented: callback stored_at refreshes per-service in-memory tracking across signals, with a default 300-second timeout. Expiry creates a critical service_silent alert through a separate path without rule-based open-alert suppression. Restart loses timers.",
					source: `${API}/ingest/SilenceWatchdog.java; ${API}/services/IngestService.java; docker-compose.yml`,
					children: []
				},
				{
					id: "alerting-recipients",
					title: "History and personal notifications",
					description: "Implemented: AlertsService saves alert history and recipient rows for every current user in one PostgreSQL transaction. Personal notification state is separate from shared alert status; broadcast and AI submission follow the save.",
					source: `${API}/services/AlertsService.java; ${API}/services/IngestService.java`,
					children: []
				},
				{
					id: "alerting-schema",
					title: "Application schema lifecycle",
					description: "Implemented configuration: Compose defaults Hibernate ddl-auto to update and persists PostgreSQL in postgres_data. This is not a supplied versioned migration workflow or an automatic alert-history expiry policy.",
					source: "docker-compose.yml; services/api/pom.xml",
					children: []
				}
			]
		},
		{
			id: "analysis",
			title: "Local AI and outbound delivery",
			description: "Implemented API orchestration calls FastAPI and local Ollama. Automatic analysis and interactive questions share a volatile single-thread API executor.",
			source: `${API}/services/LlmService.java; docker-compose.yml`,
			children: [
				{
					id: "analysis-context",
					title: "Context collection and selection",
					description: "Implemented: the API materializes service/window logs, metrics and traces before FastAPI selects prompt context. Defaults retain up to 20 logs, 10 metrics and 10 traces; log messages are shortened to 160 characters. Prompt limits do not bound the upstream database query.",
					source: `${API}/services/LlmService.java; services/llm/app/context.py; docker-compose.yml`,
					children: []
				},
				{
					id: "analysis-automatic",
					title: "Saved automatic analysis",
					description: "Implemented: the API consumes internal SSE, persists the completed analysis or Analysis unavailable, broadcasts an llm WebSocket frame, then submits webhooks. An exception in the persistence/broadcast block can skip webhook submission.",
					source: `${API}/services/LlmService.java`,
					children: []
				},
				{
					id: "analysis-questions",
					title: "Ephemeral questions",
					description: "Implemented: alert questions fetch fresh context and include up to 5000 characters of prior analysis. Backend token/done/error SSE can be relayed to the browser; questions and answers are not saved as chat history or substituted for automatic analysis. Integration gap: the mounted drawer always sends history alongside question, but AlertAskRequestDto is question-only and Jackson rejects unknown fields, so the checked-in UI request is rejected before streaming.",
					source: `${API}/services/LlmService.java`,
					children: []
				},
				{
					id: "analysis-webhooks",
					title: "Best-effort webhooks",
					description: "Implemented: another single-thread executor sends each configured URL once with 5-second connect/read timeouts. No durable outbox, retry worker or delivery-history store is provided.",
					source: `${API}/services/WebhookDeliveryService.java`,
					children: []
				}
			]
		},
		{
			id: "operations",
			title: "Runtime and operational roadmap",
			description: "Implemented Compose wiring and persistence are distinct from planned operational assurance. No running deployment, backup restoration or performance target was verified for this atlas.",
			source: "docker-compose.yml",
			children: [
				{
					id: "operations-startup",
					title: "Startup dependencies",
					description: "Implemented: database health and ClickHouse initialization gate API startup; rendered configuration and ClickHouse initialization gate the Collector. Collector startup does not wait for API readiness. Only Caddy publishes a host port (8443 by default); API/Collector/Caddy have no Compose application-readiness checks, and WAF health checks its own endpoint, not end-to-end API readiness. The independent Ollama/model-pull/FastAPI branch does not gate the API.",
					source: "docker-compose.yml",
					children: []
				},
				{
					id: "operations-volumes",
					title: "Persistent installation state",
					description: "Implemented: named volumes retain databases, model files and installation configuration/credentials. Recovery includes matching Vault data/bootstrap/AppRole credentials, API credentials and Caddy CA/configuration, not just the two database volumes. They survive ordinary container replacement, not host loss, and do not persist callback retries, live streams, silence timers or executor backlogs.",
					source: "docker-compose.yml",
					children: []
				},
				{
					id: "operations-monitoring-planned",
					title: "Planned: independent failure monitoring",
					description: "Proposed, not deployed: scrape and alert independently on callback failures. The exporter already logs and increments vigil.exporter.callback.failures, but Compose supplies no independent monitoring stack or routing guarantee. The optional mock sender uses a placeholder bearer key and a portless localhost endpoint; it must be configured for the actual ingress before it can verify an installation.",
					source: `${EXPORTER}/callback.go; docker-compose.yml`,
					children: []
				},
				{
					id: "operations-recovery-planned",
					title: "Planned: backup and recovery verification",
					description: "Proposed, not implemented or verified: operator-defined off-host backups and complete installation restore drills. Compose volumes do not establish a backup schedule, recovery-point objective, failover or recovery of missed evaluation callbacks.",
					source: "docker-compose.yml",
					children: []
				}
			]
		}
	]
};

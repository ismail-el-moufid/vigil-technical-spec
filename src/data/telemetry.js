// Wire names follow TelemetryPage's explicit hasMore override, not alert pagination.
const RATE = "JWT: 60/min per user + method + URI; ApiKey: shared 10/min per IP; SSE opening GETs count, push events do not";
const ERRORS = {
	400: "{ message: '<validation message>' }",
	401: "{ message: '<authentication failure message>' }",
	429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
	500: "{ message: 'server error' }",
};
const LOG = "{ service, timestamp, severity, message, attributes: {} }";
const TRACE = "{ trace_id, span_id, parent_span_id, name, service, timestamp, duration_ms: number, status, attributes: {} }";
const METRIC = "{ service, timestamp, name, value: number | null, attributes: {} }";
const PERIOD = { name: "period", type: "1h | 24h | 7d | 30d (omitted = no time restriction)", required: false };
const SERVICE = { name: "service", type: "string (REST: nonblank exact filter; blank ignored; unknown nonblank values match no rows; SSE: supplied value matched literally)", required: false };
const COUNT = { name: "count", type: "integer 1-500 (default 50; ignored for CSV)", required: false };
const BEFORE = { name: "before", type: "ISO8601 timestamp (exclusive timestamp cursor)", required: false };
const FORMAT = { name: "format", type: "json | csv (default json)", required: false };
const INTERNAL = { name: "vigil.internal", type: "boolean (true: attributes['internal']='true'; false: 'false' or missing key; omitted: all)", required: false };
const PAGE_CRITERIA = [
	"Implemented by TelemetryController, TelemetryService and the ClickHouse repositories. JSON is { data, hasMore }, not { data, has_more }. Fetch count + 1 rows, return at most count and set hasMore only when the additional row exists.",
	"count defaults to 50 and accepts 1-500. Invalid period, count, format or a parsed cursor returns 400. Default order is timestamp DESC with timestamp < before. Timestamp-only cursors do not disambiguate records sharing exactly the same timestamp.",
	"format=csv returns all matching records, ignoring pagination and sort, with the same period/service/signal-specific filters. Repositories iterate matching rows through TelemetryExport without collecting a result list, but CsvResponse still builds an in-memory byte[] with Content-Type text/csv and no Content-Disposition header; export still counts as one request, not one per row. CSV bypasses service validation of count/before/offset/sort, but controller-bound count/offset must still convert to Integer; e.g. count=0 is ignored while count=abc returns 400. Period and Boolean vigil.internal conversion still apply.",
];
const LIVE_CRITERIA = [
	"Implemented: service is the only service-name filter. TelemetryController has no name parameter or name/service precedence rule; sending name alone does not filter the stream. Omit service for all services; a supplied empty service is an exact empty-string filter, not a validation-400 path.",
	"Unnamed SSE data messages contain one record in the same shape as the raw REST DTO. SseEmitter registries apply exact service matching (plus exact severity matching for logs); there is no replay, heartbeat, event ID or Last-Event-ID recovery protocol. Registries use SseEmitter(Long.MAX_VALUE), remove emitters on completion/timeout/error and complete a failing sender with error; this is not a durable subscription.",
	"The onboarding wizard opens all three signals only on its final verification step using ?service=<encodedServiceName>&token=<encodedAccessToken>. Any onmessage marks that signal received; open events do not. Current useTelemetryVerification does not parse/validate payloads, trim the service filter, suppress stale callbacks or close streams on first success. Those stronger detection guarantees remain planned.",
	"Onboarding retains EventSource automatic reconnect and offers manual retry (which resets all signals and connections). Dashboard live hooks instead close on errors. No scheduled JWT-expiry refresh/backoff coordinator is implemented for live streams; changing the AuthProvider token reopens them.",
	"Native EventSource errors do not expose HTTP status/body. Do not infer a specific authentication/rate-limit failure from onerror. Query credentials must be redacted from logs; never use ingestion_key for reads.",
];
const liveRequest = (logs = false) => ({
	query: [SERVICE, ...(logs ? [{ name: "severity", type: "string (exact match)", required: false }] : []),
		{ name: "token", type: "JWT access token (needed for native EventSource authentication; optional when Authorization supplies Bearer JWT or ApiKey; Authorization takes precedence)", required: false }],
	body: null,
});
const liveConstraints = (signal) => ({
	criteria: LIVE_CRITERIA,
	security: ["JWT signature/expiry and current database identity are checked when opening. Query token is JWT-only; API keys require Authorization: ApiKey <key>. Established streams do not reauthenticate on each push."],
	rateLimit: RATE,
	realtime: {
		text: `On a ${signal} callback, IngestService fetches exact persisted rows WHERE attributes['vigil.notification_id'] = notification_id and sends records through subscriber filters, independently of alert evaluation. Streaming failures are logged and do not fail the callback. Callback retries may resend records.`,
		refs: ["ep-alerts-trigger-evaluation"],
	},
	fallback: "Best-effort only; reconnect behavior differs between onboarding and dashboard hooks (see criteria).",
	dedup: "No backend SSE deduplication",
});

export const TELEMETRY_ENDPOINTS =
[
	{
		route: "/api/telemetry/metrics",
		service: "Spring Boot + ClickHouse",
		owner: "Telemetry Engineer",
		method: "GET",
		request: { query: [PERIOD, SERVICE, COUNT, BEFORE, INTERNAL, FORMAT], body: null },
		response: { 200: `{ data: [${METRIC}], hasMore: boolean } — or full matching text/csv bytes`, ...ERRORS },
		group: "Telemetry",
		tables: ["metrics"],
		tables_actions: { metrics: "Read" },
		constraints: {
			criteria: [...PAGE_CRITERIA,
				"Raw Metric exposes service/timestamp/name/value/attributes only; histogram points can have value=null. Stored OTLP metadata is not returned in this DTO.",
				"metric_name, interval and aggregation are not implemented query parameters here. Planned richer bucket/aggregation contract is not a current API. Current charts call the separate /api/telemetry/metrics/series route, not a bucketed mode on this endpoint.",
				"vigil.internal filters the attributes map, not a first-class internal column. No implemented /status page currently consumes it.",
			],
			security: [], rateLimit: RATE, realtime: "None", fallback: "None", dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-telemetry-metrics",
	},
	{
		route: "/api/telemetry/metrics/series",
		service: "Spring Boot + ClickHouse",
		owner: "Telemetry Engineer",
		method: "GET",
		request: { query: [{ name: "period", type: "1h | 24h | 7d | 30d", required: true }, SERVICE, INTERNAL], body: null },
		response: { 200: "{ interval_seconds: integer, series: [{ name, service, unit, kind: gauge | counter | histogram, internal: boolean, points: [{ bucket: '<iso8601>', value: number | null }] }] }", ...ERRORS },
		group: "Telemetry", tables: ["metrics"], tables_actions: { metrics: "Read (bucketed series)" },
		constraints: {
			criteria: [
				"Implemented: period is required and controls interval_seconds: 1h=60, 24h=1800, 7d=10800, 30d=43200. Missing/unknown period returns 400. No pagination or hasMore field.",
				"MetricsRepository.findSeries groups by name/service/UTC bucket. Gauge-kind values use avg(value); monotonic sums use increases divided by the fixed bucket duration; histograms use summed histogram-sum increases / summed count increases. Cumulative differences use lag per series_id within the queried range, excluding first samples and decreases. Delta samples use their stored values directly.",
				"Current limitations: no pre-range baseline read, start_timestamp reset handling, proportional allocation across overlapping buckets, dense empty-bucket filling, mixed-unit/type rejection or 2000-result guard. unit/kind/internal use any() for each service/name/bucket. Do not conflate this implementation with the earlier planned richer aggregation contract.",
				"MetricsPage uses this for charts (first two metric names selected by default); in live mode useMetricSeries polls every 60s while raw live points arrive on SSE separately.",
			],
			security: [], rateLimit: RATE, realtime: "REST; frontend live charts poll every 60s", fallback: "None", dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-telemetry-metrics-series",
	},
	{
		route: "/api/telemetry/traces", service: "Spring Boot + ClickHouse", owner: "Telemetry Engineer", method: "GET",
		request: { query: [PERIOD, SERVICE,
			{ name: "sort", type: "timestamp (default DESC) | trace_id | span_id | parent_span_id | name | service | duration_ms | status (non-time fields ASC)", required: false },
			COUNT, BEFORE, { name: "offset", type: "integer 0-500 (non-default-sort pagination)", required: false }, FORMAT], body: null },
		response: { 200: `{ data: [${TRACE}], hasMore: boolean } — or full matching text/csv bytes`, ...ERRORS },
		group: "Telemetry", tables: ["traces"], tables_actions: { traces: "Read" },
		constraints: {
			criteria: [...PAGE_CRITERIA,
				"Non-default sort uses offset instead of before; continuous inserts can cause drift. Only the active pagination mode is service-validated: before is not parsed under non-default sorting and offset is not checked under timestamp sorting. Non-numeric controller-bound integer parameters can still fail binding. Unknown sort returns 400.",
				"Frontend currently provides period/service, live toggle, CSV, load-more and expandable span details. trace_id/span_id in the page URL select a loaded row; they are not REST filter parameters. There is no current trace sort control.",
			], security: [], rateLimit: RATE, realtime: "None", fallback: "None", dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-telemetry-traces",
	},
	{
		route: "/api/telemetry/logs", service: "Spring Boot + ClickHouse", owner: "Telemetry Engineer", method: "GET",
		request: { query: [PERIOD, SERVICE,
			{ name: "severity", type: "string (nonblank exact match; blank ignored; no closed-enum validation)", required: false },
			{ name: "search", type: "string (nonblank case-insensitive substring via ILIKE '%search%'; SQL % and _ remain wildcards)", required: false },
			{ name: "sort", type: "timestamp (default DESC) | service | severity | message (other fields ASC)", required: false },
			COUNT, BEFORE, { name: "offset", type: "integer 0-500 (used for non-default sort)", required: false }, FORMAT], body: null },
		response: { 200: `{ data: [${LOG}], hasMore: boolean } — or full matching text/csv bytes`, ...ERRORS },
		group: "Telemetry", tables: ["logs"], tables_actions: { logs: "Read" },
		constraints: {
			criteria: [...PAGE_CRITERIA,
				"Non-default sort uses offset instead of before; drift is possible. TelemetryService validates both supplied before and offset for JSON logs even when one is unused. offset accepts 0-500; unknown sort returns 400.",
				"LogsPage implements period/service/severity/search, sorting, infinite scroll, CSV and opt-in live updates with a 200-record live/pending buffer. New live records are held while scrolled away from the top.",
			], security: [], rateLimit: RATE, realtime: "None", fallback: "None", dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-telemetry-logs",
	},
	{
		route: "/api/telemetry/logs/live", service: "Spring Boot + ClickHouse", owner: "Telemetry Engineer", method: "SSE",
		request: liveRequest(true), response: { event: LOG }, group: "Telemetry", tables: ["logs"], tables_actions: { logs: "Read" },
		constraints: liveConstraints("logs"), authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-telemetry-logs-live",
	},
	{
		route: "/api/telemetry/traces/live", service: "Spring Boot + ClickHouse", owner: "Telemetry Engineer", method: "SSE",
		request: liveRequest(), response: { event: TRACE }, group: "Telemetry", tables: ["traces"], tables_actions: { traces: "Read" },
		constraints: liveConstraints("traces"), authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-telemetry-traces-live",
	},
	{
		route: "/api/telemetry/metrics/live", service: "Spring Boot + ClickHouse", owner: "Telemetry Engineer", method: "SSE",
		request: liveRequest(), response: { event: METRIC }, group: "Telemetry", tables: ["metrics"], tables_actions: { metrics: "Read" },
		constraints: liveConstraints("metrics"), authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-telemetry-metrics-live",
	},
	{
		route: "/api/telemetry/attributes", service: "Spring Boot + ClickHouse", owner: "Telemetry Engineer", method: "GET",
		request: { query: [], body: null }, response: { 200: "[{ key: '<string>', values: ['<string>'] }]", 401: ERRORS[401], 429: ERRORS[429], 500: ERRORS[500] },
		group: "Telemetry", tables: ["logs", "metrics", "traces"], tables_actions: { logs: "Read (last 7 days)", metrics: "Read (last 7 days)", traces: "Read (last 7 days)" },
		constraints: {
			criteria: [
				"AttributesRepository unions map keys/values from all three telemetry tables over the last 7 days, grouping distinct values by key. It does not enumerate metrics.name.",
				"Current frontend consumer: useAlertRuleForm offers attribute.key as metrics-rule metric-name options. This is an integration gap: evaluators query metrics.name, while AlertsService leaves DB metric-name validation as TODO. Backend metrics rules accept arbitrary nonblank metric_name with a valid aggregation; no attribute membership check is implemented. Telemetry pages currently do not use this endpoint for suggestions.",
			], security: [], rateLimit: RATE, realtime: "None", fallback: "None", dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN_/_VIEWER", id: "ep-telemetry-attributes",
	},
];

export const TELEMETRY_ENDPOINTS =
[
	{
		route: "/api/telemetry/metrics",
		service: "Spring Boot + ClickHouse",
		owner: "Telemetry Engineer",
		method: "GET",
		request:
		{
			query:
			[
				{
					name: "period",
					type: "string",
					required: false
				},
				{
					name: "service",
					type: "string",
					required: false
				},
				{
				   name: "metric_name",
				   type: "string — exact metrics.name filter; unknown names return no rows",
				   required: false
				},
				{
				   name: "interval",
				   type: "1m | 5m | 15m | 1h | 1d — enables bucketed JSON mode",
				   required: false
				},
				{
				   name: "aggregation",
				   type: "avg | sum | min | max | rate — required with interval; validated against stored OTLP metric metadata",
				   required: false
				},
				{
					name: "count",
					type: "number",
					required: false
				},
				{
					name: "before",
					type: "string (ISO8601 — timestamp of the oldest row already loaded; omit for first page)",
					required: false
				},
				{
					name: "vigil.internal",
					type: "boolean — filters on attributes['internal'] = 'true' in the metrics row's attributes Map; there is no first-class 'internal' column on the metrics table, so this is an attribute-key lookup, not a column filter. Rows without an 'internal' attribute key are treated as vigil.internal=false",
					required: false
				},
				{
					name: "format",
					type: "json | csv (default json); 400 if any other value is supplied",
					required: false
				},
			],
			body: null,
		},
		response:
		{
			200: "Raw mode: { data[], has_more: boolean }; format=csv: full matching raw dataset as text/csv. Bucketed mode: { interval, aggregation, data: [{ timestamp: <UTC bucket start>, service, metric_name, unit, value: <number | null> }] }; no pagination or has_more",
			400: "{ message: '<single validation message>' }",
			401: "{ message: 'unauthorized' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
		},
		group: "Telemetry",
		tables: ["metrics"],
		tables_actions: { metrics: "Read" },
		constraints: {
			criteria:
			[
				"Without interval, existing raw JSON pagination and CSV export remain unchanged; metric_name filters metrics.name in both modes. aggregation without interval returns 400.",
				"Bucketed mode requires metric_name, aggregation and period (1h | 24h | 7d | 30d). interval must be 1m | 5m | 15m | 1h | 1d. Reject count, before, offset or format=csv in bucketed mode with 400. Maximum 2000 bucket/service results per request; reject larger requests with 400 rather than truncate or paginate.",
				"Backend executes time-bucket aggregation in ClickHouse. Fix now once per request; query [now - period, now), align buckets to UTC epoch boundaries and order by timestamp then service. Keep services and metric names separate; apply existing service and vigil.internal filters before aggregation. Emit null for empty or uncomputable buckets, never invent zero activity. Unknown metric_name returns data: []. Edge buckets cover only the requested time range.",
				"Type validation uses persisted OTLP metric_type, aggregation_temporality and is_monotonic, never metric-name heuristics. avg/sum/min/max accept gauges and non-monotonic delta sums as scalar samples. Monotonic sums support sum (interval increase) and rate (increase per second), not avg/min/max. Histograms support avg only in this initial contract, using combined interval sum / combined interval count, not an average of averages. Other type/aggregation combinations, missing metadata or mixed incompatible types/units return 400; percentile queries are not part of this change.",
				"Compute counter increases and cumulative histogram sum/count differences per series_id before combining series by service/name. Read the preceding point before the range when available; honor start_timestamp changes and monotonic counter decreases as resets, never subtract across unrelated series. Delta points already describe [start_timestamp, timestamp]; cumulative differences describe the interval between observations. Allocate interval increases proportionally to overlapping requested buckets (uniform activity assumption); divide rate by the covered bucket duration in seconds, including partial edge buckets. Unresolvable baselines, gaps without a supported observation interval, or zero histogram count yield null. Preserve units for scalar/histogram averages; rate units are the original unit per second.",
				"Collector exporter preserves OTLP identity/type/temporality and histogram sum/count rather than flattening every point into value. Existing rows receive metric_type=unknown and cannot participate in bucketed reads until reingested with metadata; raw reads remain available. This endpoint does not change alert-rule aggregation semantics.",
				"Infinite scroll via keyset (cursor) pagination on timestamp, not offset — avoids row skip/duplicate drift as new metrics continuously insert ahead of the page",
				"count defaults to 50 when omitted (json mode only; ignored under format=csv); fetch count + 1 matching rows after applying the cursor or offset, return at most count rows, and set has_more only when the additional row exists",
				"400 returned if count is present but non-numeric or outside 1-500, or before is present but not a valid ISO8601 timestamp",
				"400 also returned if period is present but not one of the recognized values (1h | 24h | 7d | 30d); service has no fixed vocabulary — an unrecognized value is treated as a legitimate filter that simply matches no rows, not a validation error",
				"400 returned if format is present but not one of json | csv",
				"Status page passes ?vigil.internal=true for infra metrics panel — intentional dual-call (service vs infra)",
				"format=csv ignores count/before/offset and returns every row matching period/service/metric_name/vigil.internal as one unpaginated CSV response — this is the actual mechanism behind the page's 'CSV export' feature, distinct from the paginated JSON view. Not exempt from the standard bucket, but doesn't need to be: the DEFAULT bucket (10 tokens, +10/60s, keyed by client IP) counts requests, not rows, so this one unpaginated response still consumes exactly one token, same as any small paginated GET",
			],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-telemetry-metrics",
	},
	{
		route: "/api/telemetry/traces",
		service: "Spring Boot + ClickHouse",
		owner: "Telemetry Engineer",
		method: "GET",
		request:
		{
			query:
			[
				{ name: "period",  type: "string", required: false },
				{ name: "service", type: "string", required: false },
				{ name: "sort", type: "string", required: false },
				{ name: "count",type: "number", required: false },
				{
					name: "before",
					type: "string (ISO8601 — timestamp of the oldest row already loaded; used when sort is unset/default)",
					required: false
				},
				{
					name: "offset",
					type: "number (0-500; fallback pagination when sort is set to a non-default field — a stable cursor isn't well-defined for arbitrary sort keys)",
					required: false
				},
				{
				   name: "format",
				   type: "json | csv (default json); 400 if any other value is supplied",
				   required: false
				},
			],
			body: null,
		},
		response:
		{
			200: "{ data[], has_more: boolean } — or, when format=csv, a text/csv body of the full matching dataset",
			400: "{ message: '<single validation message>' }",
			401: "{ message: 'unauthorized' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
		},
		group: "Telemetry",
		tables: ["traces"],
		tables_actions: { traces: "Read" },
		constraints: {
			criteria:
			[
				"Default (time-descending) infinite scroll uses keyset pagination via 'before' — avoids row skip/duplicate drift under continuous inserts",
				"Non-default sort falls back to 'offset'; drift under continuous inserts is an accepted limitation in that mode only, since sorted-but-not-by-time views are inherently harder to cursor",
				"count defaults to 50 when omitted (json mode only; ignored under format=csv); fetch count + 1 matching rows after applying the cursor or offset, return at most count rows, and set has_more only when the additional row exists",
				{
					text: "400 returned if count is present but non-numeric or outside 1-500, or offset is present but non-numeric or outside 0-500 (zero is valid), or before is present but not a valid ISO8601 timestamp, or sort references an unknown field",
					refs: ["ep-telemetry-metrics"],
				},
				"400 also returned if period is present but not one of the recognized values (1h | 24h | 7d | 30d); service has no fixed vocabulary — an unrecognized value is treated as a legitimate filter that simply matches no rows, not a validation error",
				"400 returned if format is present but not one of json | csv",
				"format=csv ignores count/before/offset/sort and returns every row matching period/service as one unpaginated CSV response — this is the actual mechanism behind the page's 'CSV export' feature, distinct from the paginated JSON view. Not exempt from the standard bucket, but doesn't need to be: the DEFAULT bucket (10 tokens, +10/60s, keyed by client IP) counts requests, not rows, so this one unpaginated response still consumes exactly one token, same as any small paginated GET",
			],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-telemetry-traces",
	},
	{
		route: "/api/telemetry/logs",
		service: "Spring Boot + ClickHouse",
		owner: "Telemetry Engineer",
		method: "GET",
		request:
		{
			query:
			[
				{
					name: "period",
					type: "string",
					required: false
				},
				{
					name: "service",
					type: "string",
					required: false
				},
				{
					name: "severity",
					type: "string",
					required: false
				},
				{
					name: "search",
					type: "string",
					required: false
				},
				{
					name: "sort",
					type: "string",
					required: false
				},
				{
					name: "count",
					type: "number",
					required: false
				},
				{
					name: "before",
					type: "string (ISO8601 — timestamp of the oldest row already loaded; used when sort is unset/default)",
					required: false
				},
				{
					name: "offset",
					type: "number (0-500; fallback pagination when sort is set to a non-default field — a stable cursor isn't well-defined for arbitrary sort keys)",
					required: false
				},
				{
					name: "format",
					type: "json | csv (default json); 400 if any other value is supplied",
					required: false
				},
			],
			body: null,
		},
		response:
		{
			200: "{ data[], has_more: boolean } — or, when format=csv, a text/csv body of the full matching dataset",
			400: "{ message: '<single validation message>' }",
			401: "{ message: 'unauthorized' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
		},
		group: "Telemetry",
		tables: ["logs"],
		tables_actions: { logs: "Read" },
		constraints: {
			criteria:
			[
				"Default (time-descending) infinite scroll uses keyset pagination via 'before' — avoids row skip/duplicate drift under continuous inserts",
				"Non-default sort falls back to 'offset'; drift under continuous inserts is an accepted limitation in that mode only, since sorted-but-not-by-time views are inherently harder to cursor",
				"count defaults to 50 when omitted (json mode only; ignored under format=csv); fetch count + 1 matching rows after applying the cursor or offset, return at most count rows, and set has_more only when the additional row exists",
				{
					text: "400 returned if count is present but non-numeric or outside 1-500, or offset is present but non-numeric or outside 0-500 (zero is valid), or before is present but not a valid ISO8601 timestamp, or sort references an unknown field",
					refs: ["ep-telemetry-metrics"],
				},
				"400 also returned if period is present but not one of the recognized values (1h | 24h | 7d | 30d); service has no fixed vocabulary — an unrecognized value is treated as a legitimate filter that simply matches no rows, not a validation error",
				"400 returned if format is present but not one of json | csv",
				"format=csv ignores count/before/offset/sort and returns every row matching period/service/severity/search as one unpaginated CSV response — this is the actual mechanism behind the page's 'CSV export' feature, distinct from the paginated JSON view. Not exempt from the standard bucket, but doesn't need to be: the DEFAULT bucket (10 tokens, +10/60s, keyed by client IP) counts requests, not rows, so this one unpaginated response still consumes exactly one token, same as any small paginated GET",
			],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-telemetry-logs",
	},
	{
		route: "/api/telemetry/logs/live",
		service: "Spring Boot + ClickHouse",
		owner: "Telemetry Engineer",
		method: "SSE",
		request:
		{
			query:
			[
				{
				   name: "name",
				   type: "string (exact OTel service.name; takes precedence over service when both are supplied; provided empty name returns 400)",
				   required: false
				},
				{
				   name: "service",
				   type: "string (backward-compatible alias for name; omitting both leaves service unfiltered)",
				   required: false
				},
				{ name: "severity", type: "string", required: false },
				{
				   name: "token",
				   type: {
				      text: "string (the only auth channel for this connection — native EventSource cannot set an Authorization header, so this must be present or the initial HTTP GET is rejected; same requirement as the alerts WS handshake token)",
				      refs: ["ep-alerts-ws"]
				   },
				   required: true
				},
			],
			body: null,
		},
		response:
		{
			event: "{ service: '<string>', timestamp: '<iso8601>', trace_id: '<string>', severity: '<string>', message: '<string>', attributes: {} }",
		},
		group: "Telemetry",
		tables: ["logs"],
		tables_actions: { logs: "Read" },
		constraints: {
			criteria:
			[
				"Frame shape identical to single REST log record",
				"Shared onboarding contract for logs/live, traces/live and metrics/live: subscribe to all three concurrently with URL-encoded name and access token query values (?name=...&token=...); name identifies exact OTel service.name, not a span or metric name. Keep optional signal-specific filters omitted for onboarding.",
				"Only an actual telemetry record whose service exactly matches the active name in the current onboarding session counts as detection; any one of logs, traces or metrics is sufficient. Connection open events, heartbeats and stale callbacks or success from a previous name/session never count.",
				"Delivery is best-effort with no replay guarantee after disconnect; onboarding waits for newly arriving telemetry, not historical records, and absence of an event is not proof that instrumentation failed.",
				"Close all three EventSource connections and cancel pending timers/retries on name change, session reset, success or unmount; reset detection state for each new name/session and ignore callbacks from obsolete sessions. Debounce name edits before opening streams and back off reconnect/open attempts rather than stacking new streams on automatic EventSource retries.",
				"All three initial HTTP GETs and subsequent reconnects share the DEFAULT bucket (10 tokens, +10/60s, keyed by client IP) with other requests; one three-stream opening consumes three tokens, not three independent budgets. Coordinate retries across signals to avoid exhausting this shared budget.",
				"Native EventSource error callbacks do not expose readable HTTP status or response bodies: show actionable connection guidance (check authentication, the service name and telemetry setup; retry with backoff) without claiming a specific 400, 401 or 429 from the callback. Coordinated access-token refresh and reopening all three streams with the updated token follow the gateway auth contract, not independent per-signal refresh loops.",
			],
			security: [
				"Token passed as ?token= query param since native EventSource cannot set headers — accepted tradeoff for this project; token lands in server access logs and browser history. Same token as the Authorization header carries, still short-lived."
			],
			rateLimit: "Not exempt: the initial HTTP GET that opens this SSE stream consumes one token from the DEFAULT bucket (10 tokens, +10/60s, keyed by client IP), same as any other GET; once the stream is established, server-push frames over it are not further limited",
			realtime: {
				text: "SseEmitter per subscriber. On a logs notification accepted by /internal/alerts/trigger-evaluation, the backend reads logs rows from ClickHouse by the reserved attributes['vigil.notification_id'] correlation marker and applies subscriber filters before pushing matching log records. The callback contains metadata, not records; streaming is independent of whether any alert rule triggers. Callback retries may push the same records again; delivery over SSE is best-effort, with no replay guarantee after disconnect or process crash. Accepts ?token= for JWT or API key (native EventSource cannot set headers).",
				refs: ["ep-alerts-trigger-evaluation"],
			},
			fallback: "Browser EventSource reconnects automatically",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-telemetry-logs-live",
	},
	{
		route: "/api/telemetry/traces/live",
		service: "Spring Boot + ClickHouse",
		owner: "Telemetry Engineer",
		method: "SSE",
		request:
		{
			query:
			[
				{
				   name: "name",
				   type: "string (exact OTel service.name; takes precedence over service when both are supplied; provided empty name returns 400)",
				   required: false
				},
				{
				   name: "service",
				   type: "string (backward-compatible alias for name; omitting both leaves service unfiltered)",
				   required: false
				},
				{
				   name: "token",
				   type: {
				      text: "string (the only auth channel for this connection — native EventSource cannot set an Authorization header, so this must be present or the initial HTTP GET is rejected; same requirement as the alerts WS handshake token)",
				      refs: ["ep-alerts-ws"]
				   },
				   required: true
				},
			],
			body: null,
		},
		response:
		{
			event: "{ trace_id: '<string>', span_id: '<string>', parent_span_id: '<string>', name: '<string>', service: '<string>', timestamp: '<iso8601>', duration_ms: number, status: ok | error, attributes: {} }",
		},
		group: "Telemetry",
		tables: ["traces"],
		tables_actions: { traces: "Read" },
		constraints: {
			criteria:
			[
				"Frame shape identical to single REST trace record",
				{
					text: "Shared onboarding subscription, detection, lifecycle, retry-budget and error/auth handling criteria apply across all three live signals; see logs/live",
					refs: ["ep-telemetry-logs-live"],
				},
			],
			security: [
				"Token passed as ?token= query param since native EventSource cannot set headers — accepted tradeoff for this project; token lands in server access logs and browser history. Same token as the Authorization header carries, still short-lived."
			],
			rateLimit: "Not exempt: the initial HTTP GET that opens this SSE stream consumes one token from the DEFAULT bucket (10 tokens, +10/60s, keyed by client IP), same as any other GET; once the stream is established, server-push frames over it are not further limited",
			realtime:
				{
					text: "SseEmitter per subscriber. On a traces notification accepted by /internal/alerts/trigger-evaluation, the backend reads traces rows from ClickHouse by the reserved attributes['vigil.notification_id'] correlation marker and applies subscriber filters before pushing matching trace records. The callback contains metadata, not records; streaming is independent of whether any alert rule triggers. Callback retries may push the same records again; delivery over SSE is best-effort, with no replay guarantee after disconnect or process crash. Accepts ?token= for JWT or API key (native EventSource cannot set headers).",
					refs: ["ep-alerts-trigger-evaluation"],
				},
			fallback: "Browser EventSource reconnects automatically",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-telemetry-traces-live",
	},
	{
		route: "/api/telemetry/metrics/live",
		service: "Spring Boot + ClickHouse",
		owner: "Telemetry Engineer",
		method: "SSE",
		request:
		{
			query:
			[
				{
				   name: "name",
				   type: "string (exact OTel service.name; takes precedence over service when both are supplied; provided empty name returns 400)",
				   required: false
				},
				{
				   name: "service",
				   type: "string (backward-compatible alias for name; omitting both leaves service unfiltered)",
				   required: false
				},
				{
				   name: "token",
				   type: {
				      text: "string (the only auth channel for this connection — native EventSource cannot set an Authorization header, so this must be present or the initial HTTP GET is rejected; same requirement as the alerts WS handshake token)",
				      refs: ["ep-alerts-ws"]
				   },
				   required: true
				},
			],
			body: null,
		},
		response:
		{
			event: "{ service: '<string>', timestamp: '<iso8601>', name: '<string>', value: number, attributes: {} }",
		},
		group: "Telemetry",
		tables: ["metrics"],
		tables_actions: { metrics: "Read" },
		constraints: {
			criteria:
			[
				"Frame shape identical to single REST metric record",
				{
					text: "Shared onboarding subscription, detection, lifecycle, retry-budget and error/auth handling criteria apply across all three live signals; see logs/live",
					refs: ["ep-telemetry-logs-live"],
				},
			],
			security: [
				"Token passed as ?token= query param since native EventSource cannot set headers — accepted tradeoff for this project; token lands in server access logs and browser history. Same token as the Authorization header carries, still short-lived."
			],
			rateLimit: "Not exempt: the initial HTTP GET that opens this SSE stream consumes one token from the DEFAULT bucket (10 tokens, +10/60s, keyed by client IP), same as any other GET; once the stream is established, server-push frames over it are not further limited",
			realtime:
				{
					text: "SseEmitter per subscriber. On a metrics notification accepted by /internal/alerts/trigger-evaluation, the backend reads metrics rows from ClickHouse by the reserved attributes['vigil.notification_id'] correlation marker and applies subscriber filters before pushing matching metric records. The callback contains metadata, not records; streaming is independent of whether any alert rule triggers. Callback retries may push the same records again; delivery over SSE is best-effort, with no replay guarantee after disconnect or process crash. Accepts ?token= for JWT or API key (native EventSource cannot set headers).",
					refs: ["ep-alerts-trigger-evaluation"],
				},
			fallback: "Browser EventSource reconnects automatically",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-telemetry-metrics-live",
	},
	{
		route: "/api/telemetry/attributes",
		service: "Spring Boot + ClickHouse",
		owner: "Telemetry Engineer",
		method: "GET",
		request: { query: [], body: null },
		response:
		{
			200: "[{ key: '<string>', values: ['<string>'] }]",
			401: "{ message: 'unauthorized' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
		},
		group: "Telemetry",
		tables: ["logs", "metrics", "traces"],
		tables_actions: {
			logs: "Read (last 7 days)",
			metrics: "Read (last 7 days)",
			traces: "Read (last 7 days)"
		},
		constraints: {
			criteria: [
				"Used by ADMIN callers to validate custom alert rule attributes when creating/editing metrics-type rules — the form behind POST/PATCH /api/alerts/rules checks a submitted metric_name against this endpoint's key/value list before allowing a signal_type = metrics rule to be saved (those two write endpoints are ADMIN-only). Not used for signal_type = logs | traces rules — metric_name there is validated against a fixed enum baked into the endpoints themselves, not against this dynamic key list",
				"Also used by VIEWER callers to power search/filter-suggestion dropdowns on the telemetry views (logs/traces/metrics pages) — this is the reason the role grant is ADMIN_/_VIEWER rather than ADMIN-only; confirmed intentional, not over-scoped",
			],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-telemetry-attributes",
	},
];

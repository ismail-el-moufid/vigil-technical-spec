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
					type: "json | csv (default json)",
					required: false
				},
			],
			body: null,
		},
		response:
		{
			200: "{ data[], hasMore: boolean } — or, when format=csv, a text/csv body of the full matching dataset",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Telemetry",
		tables: ["metrics"],
		tables_actions: { metrics: "Read" },
		constraints: {
			criteria:
			[
				"Data and Analytics Major Dashboard (2pt)",
				"Infinite scroll via keyset (cursor) pagination on timestamp, not offset — avoids row skip/duplicate drift as new metrics continuously insert ahead of the page",
				"count defaults to 50 when omitted (json mode only; ignored under format=csv); hasMore derived server-side: returned.length === count",
				"400 returned if count is present but non-numeric or outside 1-500, or before is present but not a valid ISO8601 timestamp",
				"400 also returned if period is present but not one of the recognized values (1h | 24h | 7d | 30d); service has no fixed vocabulary — an unrecognized value is treated as a legitimate filter that simply matches no rows, not a validation error",
				"Status page passes ?vigil.internal=true for infra metrics panel — intentional dual-call (service vs infra). Fulfils DevOps Minor Health check + status page (1pt)",
				"format=csv ignores count/before/offset and returns every row matching period/service/vigil.internal as one unpaginated CSV response — this is the actual mechanism behind the page's 'CSV export' feature, distinct from the paginated JSON view. Not exempt from the standard bucket, but doesn't need to be: the DEFAULT bucket (10 tokens, +10/60s, keyed by client IP) counts requests, not rows, so this one unpaginated response still consumes exactly one token, same as any small paginated GET",
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
					type: "number (fallback pagination when sort is set to a non-default field — a stable cursor isn't well-defined for arbitrary sort keys)",
					required: false
				},
				{ name: "format",  type: "json | csv (default json)", required: false },
			],
			body: null,
		},
		response:
		{
			200: "{ data[], hasMore: boolean } — or, when format=csv, a text/csv body of the full matching dataset",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Telemetry",
		tables: ["traces"],
		tables_actions: { traces: "Read" },
		constraints: {
			criteria:
			[
				"Data export (1pt)",
				"Default (time-descending) infinite scroll uses keyset pagination via 'before' — avoids row skip/duplicate drift under continuous inserts",
				"Non-default sort falls back to 'offset'; drift under continuous inserts is an accepted limitation in that mode only, since sorted-but-not-by-time views are inherently harder to cursor",
				"count defaults to 50 when omitted (json mode only; ignored under format=csv); hasMore derived server-side: returned.length === count",
				{
					text: "400 returned if count/offset are present but non-numeric or outside 1-500 (same bound as the metrics endpoint), or before is present but not a valid ISO8601 timestamp, or sort references an unknown field",
					refs: ["ep-telemetry-metrics"],
				},
				"400 also returned if period is present but not one of the recognized values (1h | 24h | 7d | 30d); service has no fixed vocabulary — an unrecognized value is treated as a legitimate filter that simply matches no rows, not a validation error",
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
					type: "number (fallback pagination when sort is set to a non-default field — a stable cursor isn't well-defined for arbitrary sort keys)",
					required: false
				},
				{
					name: "format",
					type: "json | csv (default json)",
					required: false
				},
			],
			body: null,
		},
		response:
		{
			200: "{ data[], hasMore: boolean } — or, when format=csv, a text/csv body of the full matching dataset",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Telemetry",
		tables: ["logs"],
		tables_actions: { logs: "Read" },
		constraints: {
			criteria:
			[
				"Web Minor Advanced search (1pt)",
				"Data export (1pt)",
				"Default (time-descending) infinite scroll uses keyset pagination via 'before' — avoids row skip/duplicate drift under continuous inserts",
				"Non-default sort falls back to 'offset'; drift under continuous inserts is an accepted limitation in that mode only, since sorted-but-not-by-time views are inherently harder to cursor",
				"count defaults to 50 when omitted (json mode only; ignored under format=csv); hasMore derived server-side: returned.length === count",
				{
					text: "400 returned if count/offset are present but non-numeric or outside 1-500 (same bound as the metrics endpoint), or before is present but not a valid ISO8601 timestamp, or sort references an unknown field",
					refs: ["ep-telemetry-metrics"],
				},
				"400 also returned if period is present but not one of the recognized values (1h | 24h | 7d | 30d); service has no fixed vocabulary — an unrecognized value is treated as a legitimate filter that simply matches no rows, not a validation error",
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
				{ name: "service",  type: "string", required: false },
				{ name: "severity", type: "string", required: false },
				{
				   name: "token",
				   type: {
				      text: "string (the only auth channel for this connection — native EventSource cannot set an Authorization header, so this must be present or the Upgrade is rejected; same requirement as the alerts WS handshake token)",
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
			],
			security: [
				"Token passed as ?token= query param since native EventSource cannot set headers — accepted tradeoff for this project; token lands in server access logs and browser history. Same token as the Authorization header carries, still short-lived."
			],
			rateLimit: "Not exempt: the initial HTTP GET that opens this SSE stream consumes one token from the DEFAULT bucket (10 tokens, +10/60s, keyed by client IP), same as any other GET; once the stream is established, server-push frames over it are not further limited",
			realtime: {
				text: "SseEmitter per subscriber. Pushes matching new log records as each batch reaches /internal/ingest/v1/logs — that endpoint's own realtime field is the other side of this same push. Accepts ?token= for JWT or API key (native EventSource cannot set headers).",
				refs: ["ep-ingest-logs"],
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
				{ name: "service", type: "string", required: false },
				{
				   name: "token",
				   type: {
				      text: "string (the only auth channel for this connection — native EventSource cannot set an Authorization header, so this must be present or the Upgrade is rejected; same requirement as the alerts WS handshake token)",
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
			],
			security: [
				"Token passed as ?token= query param since native EventSource cannot set headers — accepted tradeoff for this project; token lands in server access logs and browser history. Same token as the Authorization header carries, still short-lived."
			],
			rateLimit: "Not exempt: the initial HTTP GET that opens this SSE stream consumes one token from the DEFAULT bucket (10 tokens, +10/60s, keyed by client IP), same as any other GET; once the stream is established, server-push frames over it are not further limited",
			realtime:
				{
					text: "SseEmitter per subscriber. Pushes matching new trace records as each batch reaches /internal/ingest/v1/traces — that endpoint's own realtime field is the other side of this same push. Accepts ?token= for JWT or API key (native EventSource cannot set headers).",
					refs: ["ep-ingest-traces"],
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
				{ name: "service", type: "string", required: false },
				{
				   name: "token",
				   type: {
				      text: "string (the only auth channel for this connection — native EventSource cannot set an Authorization header, so this must be present or the Upgrade is rejected; same requirement as the alerts WS handshake token)",
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
			],
			security: [
				"Token passed as ?token= query param since native EventSource cannot set headers — accepted tradeoff for this project; token lands in server access logs and browser history. Same token as the Authorization header carries, still short-lived."
			],
			rateLimit: "Not exempt: the initial HTTP GET that opens this SSE stream consumes one token from the DEFAULT bucket (10 tokens, +10/60s, keyed by client IP), same as any other GET; once the stream is established, server-push frames over it are not further limited",
			realtime:
				{
					text: "SseEmitter per subscriber. Pushes matching new metric records as each batch reaches /internal/ingest/v1/metrics — that endpoint's own realtime field is the other side of this same push. Accepts ?token= for JWT or API key (native EventSource cannot set headers).",
					refs: ["ep-ingest-metrics"],
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
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
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

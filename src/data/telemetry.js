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
				{ name: "period",  required: false, type: "string" },
				{ name: "service", required: false, type: "string" },
				{ name: "count",   required: false, type: "number" },
				{ name: "offset",  required: false, type: "number" },
			],
			body: null,
		},
		response:
		{
			200: "{ data[], hasMore: boolean }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Telemetry",
		tables: ["metrics"],
		tables_actions: "Read",
		constraints: {
			criteria:
			[
				"Data and Analytics Major Dashboard (2pt)",
				"Infinite scroll via offset pagination",
				"hasMore derived server-side: returned.length === count",
				"Status page passes ?vigil.internal=true for infra metrics panel — intentional dual-call (service vs infra). Fulfils DevOps Minor Health check + status page (1pt)",
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
				{ name: "period",  required: false, type: "string" },
				{ name: "service", required: false, type: "string" },
				{ name: "sort",    required: false, type: "string" },
				{ name: "count",   required: false, type: "number" },
				{ name: "offset",  required: false, type: "number" },
			],
			body: null,
		},
		response:
		{
			200: "{ data[], hasMore: boolean }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Telemetry",
		tables: ["traces"],
		tables_actions: "Read",
		constraints: {
			criteria:
			[
				"Data export (1pt)",
				"Infinite scroll via offset pagination",
				"hasMore derived server-side: returned.length === count",
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
				{ name: "period",   required: false, type: "string" },
				{ name: "service",  required: false, type: "string" },
				{ name: "severity", required: false, type: "string" },
				{ name: "search",   required: false, type: "string" },
				{ name: "sort",     required: false, type: "string" },
				{ name: "count",    required: false, type: "number" },
				{ name: "offset",   required: false, type: "number" },
			],
			body: null,
		},
		response:
		{
			200: "{ data[], hasMore: boolean }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Telemetry",
		tables: ["logs"],
		tables_actions: "Read (new records only)",
		constraints: {
			criteria:
			[
				"Web Minor Advanced search (1pt)",
				"Data export (1pt)",
				"Infinite scroll via offset pagination",
				"hasMore derived server-side: returned.length === count",
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
				{ name: "service",  required: false, type: "string" },
				{ name: "severity", required: false, type: "string" },
				{ name: "token",    required: false, type: "string" },
			],
			body: null,
		},
		response:
		{
			event: "{ service: '<string>', timestamp: '<iso8601>', trace_id: '<string>', severity: '<string>', message: '<string>', attributes: {} }",
		},
		group: "Telemetry",
		tables: ["logs"],
		tables_actions: "Read",
		constraints: {
			criteria:
			[
				"Frame shape identical to single REST log record",
			],
			security: [],
			rateLimit: "N/A",
			realtime: "SseEmitter per subscriber. Pushes matching new log records on each OTel batch. Accepts ?token= for JWT or API key (native EventSource cannot set headers).",
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
				{ name: "service", required: false, type: "string" },
				{ name: "token",   required: false, type: "string" },
			],
			body: null,
		},
		response:
		{
			event: "{ trace_id: '<string>', span_id: '<string>', parent_span_id: '<string>', name: '<string>', service: '<string>', timestamp: '<iso8601>', duration_ms: number, status: ok | error, attributes: {} }",
		},
		group: "Telemetry",
		tables: ["traces"],
		tables_actions: "Read",
		constraints: {
			criteria:
			[
				"Frame shape identical to single REST trace record",
			],
			security: [],
			rateLimit: "N/A",
			realtime:
				"SseEmitter per subscriber. Pushes matching new trace records on each OTel batch. Accepts ?token= for JWT or API key (native EventSource cannot set headers).",
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
				{ name: "service", required: false, type: "string" },
				{ name: "token",   required: false, type: "string" },
			],
			body: null,
		},
		response:
		{
			event: "{ service: '<string>', timestamp: '<iso8601>', name: '<string>', value: number, attributes: {} }",
		},
		group: "Telemetry",
		tables: ["metrics"],
		tables_actions: "Read",
		constraints: {
			criteria:
			[
				"Frame shape identical to single REST metric record",
			],
			security: [],
			rateLimit: "N/A",
			realtime:
				"SseEmitter per subscriber. Pushes matching new metric records on each OTel batch. Accepts ?token= for JWT or API key (native EventSource cannot set headers).",
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
		tables_actions: "Read (last 7 days)",
		constraints: {
			criteria: ["Used to validate custom alert rule attributes"],
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

export const CONFIG_ENDPOINTS =
[
	{
		route: "/api/config/keys",
		service: "Spring Boot",
		owner: "Backend Lead",
		method: "GET",
		request: { query: [], body: null },
		response:
		{
			200: "{ api_key: '<uuid>', ingestion_key: '<uuid>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Config Keys",
		tables: [],
		tables_actions: {},
		constraints: {
			criteria:
			[
				"Keys sourced from Spring Boot @ConfigurationProperties bean (vigil.api-key, vigil.ingestion-key)",
				"Auto-generated as UUID via @PostConstruct at startup if properties are absent, held in memory only — same generation mechanism documented on AUTH_STRATEGIES.API_KEY, restated here in full since this page is the natural place an operator looks for 'how do I get my API key', not just the auth-strategy reference",
				"Accepted dev-mode default, not a production design: a restart silently rotates the key if vigil.api-key/vigil.ingestion-key are left unset (breaking any external caller holding the old value, e.g. the OTel Collector, with no warning), and a multi-instance deployment mints a different key per instance unless the properties are set explicitly and identically everywhere. Production deployment requires setting vigil.api-key/vigil.ingestion-key explicitly",
				"Keys are read-only",
			],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-config-keys",
	},
];

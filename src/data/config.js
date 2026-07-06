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
		tables_actions: "None",
		constraints: {
			criteria:
			[
				"Keys sourced from Spring Boot @ConfigurationProperties bean (vigil.api-key, vigil.ingestion-key)",
				"Auto-generated as UUID via @PostConstruct at startup if properties are absent, held in memory only",
				"api_key: accepted as an alternative Auth method to JWT",
				"ingestion_key: written to a volume shared with the OTel Collector for secure provisioning, the Otel Collector madates it's validity for services that send the Collector telemetry",
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

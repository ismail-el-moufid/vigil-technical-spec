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
				{
					text: "This endpoint is the current source of truth for both keys' live values. For how they come to exist in the first place",
					refs: [{ id: "gw-strat-api-key", field: "items[1]" }],
				},
				"Keys are read-only",
				"api_key and ingestion_key have distinct consumers, which is why they're separate values rather than one key reused: api_key is the general-purpose credential for the public API's JWT_/_API_KEY endpoints. ingestion_key has nothing to do with ClickHouse — the collector's write to ClickHouse uses ClickHouse's own credentials, a separate secret this project doesn't specify. ingestion_key is instead the shared secret the collector's own receiver checks incoming telemetry against when a monitored service pushes logs/metrics/traces to it, rejecting anything that doesn't present it — that check happens entirely inside the collector, upstream of both ClickHouse and this API, and is unrelated to the network-isolated internal ingest port (which enforces via INTERNAL_ONLY network isolation, not a key at all)",
				"ingestion_key reaches the collector programmatically, not through an operator: on generation, Spring Boot writes the value to a file on a volume shared with the collector process, rather than holding it in memory only like vigil.api-key does. The collector's own bearertokenauth extension is configured with filename pointed at that same file and applied as the auth.authenticator on its receiver, so it validates every incoming service push against the file's current contents — a key rotated on restart reaches the collector automatically, with no copy-paste step. In a multi-instance Spring Boot deployment, either only one instance should own writing that file, or vigil.ingestion-key should be set explicitly and identically across instances, to avoid a race on first boot leaving the file holding a value not every instance agrees on",
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

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
			429: "{ error: 'rate limited; retry in <seconds> seconds' }",
			500: "{ error: 'server error' }",
		},
		group: "Config Keys",
		tables: [],
		tables_actions: {},
		constraints: {
			criteria:
			[
				{
					text: "This endpoint is the current source of truth for both keys' live values. For how api_key comes to exist in the first place",
					refs: [{ id: "gw-strat-api-key", field: "items[1]" }],
				},
				"Keys are read-only",
				"Onboarding fetches this endpoint with Authorization: Bearer <access_token> after first-admin setup or authenticated page entry. The ingestion_key is for OTLP exports only, not for authenticating API reads or live subscriptions; the returned api_key is not included in the generated application configuration",
				"Generate OTEL_SERVICE_NAME from the trimmed service-name input, OTEL_EXPORTER_OTLP_ENDPOINT from the validated VIGIL address, OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf, and OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <ingestion_key>. The address defaults to the deployment origin with a page-local override; its /v1/traces, /v1/logs and /v1/metrics routes must reach the Collector OTLP/HTTP receiver, not Spring Boot API controllers",
				"While loading, or on a missing/empty ingestion_key or failed request, block configuration copying and show a loading/error state with retry; never substitute a demo key. Follow the auth guard on 401, show access denied on 403, and back off temporary/rate-limit errors. Monitoring for a valid service name is independent of key loading. Keep keys only in page memory, do not log them or persist them in browser storage, and discard them on logout; Add another service retains the loaded deployment ingestion key without an unnecessary refetch",
				"api_key and ingestion_key have distinct consumers, which is why they're separate values rather than one key reused: api_key is the general-purpose credential for the public API endpoints that accept JWT or API key auth. ingestion_key has nothing to do with ClickHouse — the telemetry write owner’s write to ClickHouse uses ClickHouse's own credentials, a separate secret this project doesn't specify. ingestion_key is instead the shared secret the collector's own receiver checks incoming telemetry against when a monitored service pushes logs/metrics/traces to it, rejecting anything that doesn't present it — that check happens entirely inside the collector, upstream of both ClickHouse and this API, and is unrelated to the network-isolated internal callback port, which is isolated by port/network separation rather than by a key",
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

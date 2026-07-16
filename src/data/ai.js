export const AI_ENDPOINTS =
[
	{
		route: "/api/llm/analyze",
		service: "Spring Boot + FastAPI + Ollama + ClickHouse",
		owner: "AI Engineer",
		method: "POST",
		request: {
			query: [],
			body: [
				{
					name: "messages",
					type: "[{ role: user | assistant, content: string }]",
					required: true
				}
			]
		},
		response:
		{
			chunk: "data: { token: '...' }",
			done:  "data: { done: true }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
			503: "{ error: 'Analysis unavailable' }",
		},
		group: "AI",
		tables: [],
		tables_actions: {},
		constraints: {
			criteria:
			[
				"Frontend sends full conversation history each turn. Server maintains no turn state.",
				"Spring Boot proxies the chunked response from FastAPI directly to the client",
				"This endpoint answers only from the conversation history in the request body — it does not query logs/metrics/traces itself. Telemetry-grounded analysis is a distinct, internal-only flow triggered by alert evaluation, not by this endpoint: Spring Boot forwards { alert_id, service, triggered_at, context: { logs[], metrics[], traces[] } } to FastAPI at /internal/llm/forward, and that context field is what carries the actual telemetry rows into the LLM prompt. This endpoint's own request body (messages: [{ role, content }]) has no equivalent field, so it has no basis to read those tables",
				"400 returned if messages is missing, empty, not an array, or contains an element with role outside user | assistant or a non-string/missing content — validated before the request reaches FastAPI, same 'checked before insert/forward' pattern used on every other enum-typed body field in this spec",
				"503 above is the formal status code for the 30s LLM-timeout case described in fallback below — listed here explicitly so the response map doesn't silently disagree with the fallback text",
			],
			security: [],
			rateLimit:
				"10 req/min. Each POST = one request. Returns HTTP 429 on breach.",
			realtime:
				"Tokens delivered as HTTP chunked transfer encoding. Connection closes on completion.",
			fallback:
				"Returns HTTP 503 with { error: 'Analysis unavailable' } on LLM timeout (30s)",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-llm-analyze",
	},
];

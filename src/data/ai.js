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
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "AI",
		tables: [],
		tables_actions: {},
		constraints: {
			criteria:
			[
				"AI Major LLM interface + streaming (2pt)",
				"Frontend sends full conversation history each turn. Server maintains no turn state.",
				"Spring Boot proxies the chunked response from FastAPI directly to the client",
				"This endpoint answers only from the conversation history in the request body — it does not query logs/metrics/traces itself. Telemetry-grounded analysis is a distinct, internal-only flow (see ep-fastapi-analyze in internal.js, which carries an explicit context field); ep-llm-analyze has no equivalent field and therefore no basis to read those tables",
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

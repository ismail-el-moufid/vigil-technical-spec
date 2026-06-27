export const WEBHOOKS_ENDPOINTS =
[
	{
		route: "/api/webhooks",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "GET",
		request: { query: [], body: null },
		response:
		{
			200: "[{ id: '<uuid>', url: '<url>' }]",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Webhooks",
		tables: ["webhooks"],
		tables_actions: "Read",
		constraints: {
			criteria: [],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-webhooks-list",
	},
	{
		route: "/api/webhooks",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body:
			[
				{ name: "url", type: "string", required: true },
			],
		},
		response:
		{
			201: "{ id: '<uuid>', url: '<url>' }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Webhooks",
		tables: ["webhooks"],
		tables_actions: "Insert",
		constraints: {
			criteria: [],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "Delivery failures are silent",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-webhooks-create",
	},
	{
		route: "/api/webhooks/{id}",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "DELETE",
		request: { query: [], body: null },
		response:
		{
			204: "Empty response",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			404: "{ error: 'webhook not found' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Webhooks",
		tables: ["webhooks"],
		tables_actions: "Delete",
		constraints: {
			criteria: [],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-webhooks-delete",
	},
];

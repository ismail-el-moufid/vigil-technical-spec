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
		tables_actions: { webhooks: "Read" },
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
				{
					name: "url",
					type: "string (must be a well-formed https:// URL)",
					required: true
				},
			],
		},
		response:
		{
			201: "{ id: '<uuid>', url: '<url>' }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			409: "{ error: 'webhook url already registered' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Webhooks",
		tables: ["webhooks"],
		tables_actions: { webhooks: "Insert" },
		constraints: {
			criteria: [
				"400 if url isn't a well-formed https:// URL",
				"409 if url collides with the existing unique constraint on webhooks.url — checked before insert, not left as an unhandled DB constraint violation",
			],
			security: [
				"ADMIN-gated, which bounds who can register a target; server additionally resolves the hostname at registration time and rejects (400) targets resolving to private/loopback/link-local ranges or the cloud metadata address (169.254.169.254) — this narrows but does not eliminate SSRF risk (DNS can still change post-registration), which remains an accepted residual scope limitation for this project",
			],
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
		tables_actions: { webhooks: "Delete" },
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

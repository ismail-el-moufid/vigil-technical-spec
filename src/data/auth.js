export const AUTH_ENDPOINTS =
[
	{
		route: "/api/auth/setup",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body:
			[
				{ name: "email",    type: "string", required: true },
				{ name: "password", type: "string", required: true },
			],
			cookies: null,
		},
		response:
		{
			201: {
				body: "{ role: admin | viewer }",
				cookies: ["access_token", "refresh_token"]
			},
			400: "{ error: '<validation message>' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Auth",
		tables: ["users"],
		tables_actions: "Insert",
		constraints: {
			criteria:
			[
				"Hashed/salted passwords",
				"Frontend + backend validation",
			],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["PERMIT_ALL"],
		id: "ep-auth-setup",
	},
	{
		route: "/api/auth/login",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body:
			[
				{ name: "email",    type: "string", required: true },
				{ name: "password", type: "string", required: true },
			],
			cookies: null,
		},
		response:
		{
			200: {
			   body: "{ role: admin | viewer }",
			   cookies: ["access_token", "refresh_token"]
			},
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Auth",
		tables: ["users"],
		tables_actions: "Read",
		constraints: {
			criteria: ["Frontend + backend validation"],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["PERMIT_ALL"],
		id: "ep-auth-login",
	},
	{
		route: "/api/auth/refresh",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body: null,
			cookies: ["refresh_token"],
		},
		response:
		{
			204: { body: null, cookies: ["access_token"] },
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Auth",
		tables: ["users"],
		tables_actions: "Read",
		constraints: {
			criteria: [],
			security:
			[
				"Public at the filter level (permitAll), but the refresh cookie's signature and expiry are validated in the service layer — fails closed with 401 if invalid or missing",
			],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "401 on failure",
			dedup: "None",
		},
		authStrategy: ["PERMIT_ALL"],
		id: "ep-auth-refresh",
	},
	{
		route: "/api/auth/logout",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body: null,
			cookies: ["refresh_token"],
		},
		response:
		{
			204: { body: null, clears: ["access_token", "refresh_token"] },
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Auth",
		tables: ["users"],
		tables_actions: "Update",
		constraints: {
			criteria: [],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["PERMIT_ALL"],
		id: "ep-auth-logout",
	},
];

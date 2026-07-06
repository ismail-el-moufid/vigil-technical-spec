export const USERS_ENDPOINTS =
[
	{
		route: "/api/users",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "GET",
		request: { query: [], body: null },
		response:
		{
			200: "[{ id: '<uuid>', email: '<email>', role: admin | viewer }]",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: "Read",
		constraints: {
			criteria: ["User Management Major (2pt)"],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-users-list",
	},
	{
		route: "/api/users",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body:
			[
				{ name: "email",    type: "string",         required: true },
				{ name: "password", type: "string",         required: true },
				{ name: "role",     type: "admin | viewer", required: true },
			],
		},
		response:
		{
			201: "{ id: '<uuid>', email: '<email>', role: admin | viewer }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: "Insert",
		constraints: {
			criteria: ["User Management Major (2pt)"],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-users-create",
	},
	{
		route: "/api/users/me",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "PUT",
		request:
		{
			query: [],
			body:
			[
				{ name: "email",    type: "string", required: false },
				{ name: "password", type: "string", required: false },
			],
		},
		response:
		{
			200: "{ id: '<uuid>', email: '<email>', role: admin | viewer }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Users",
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
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-users-me",
	},
	{
		route: "/api/users/{id}",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "PUT",
		request:
		{
			query: [],
			body:
			[
				{ name: "email",    type: "string",         required: false },
				{ name: "role",     type: "admin | viewer", required: false },
				{ name: "password", type: "string",         required: false },
			],
		},
		response:
		{
			200: "{ id: '<uuid>', email: '<email>', role: admin | viewer }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			404: "{ error: 'user not found' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Users",
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
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-users-update",
	},
	{
		route: "/api/users/{id}",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "DELETE",
		request: { query: [], body: null },
		response:
		{
			204: "Empty response",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			404: "{ error: 'user not found' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Users",
		tables: ["users"],
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
		id: "ep-users-delete",
	},
];

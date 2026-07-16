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
		tables_actions: { users: "Read" },
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
				{
					name: "email",
					type: "string",
					required: true
				},
				{
					name: "password",
					type: "string",
					required: true
				},
				{
					name: "role",
					type: "admin | viewer",
					required: true
				},
			],
		},
		response:
		{
			201: "{ id: '<uuid>', email: '<email>', role: admin | viewer }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			409: "{ error: 'email already registered' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: { users: "Insert" },
		constraints: {
			criteria: [
				"409 returned if email collides with the existing unique constraint on users.email — checked before insert, not left as an unhandled DB constraint violation",
				"400 returned if role is present but not one of admin | viewer — same validation pattern as severity on the alert rules endpoints",
			],
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
		method: "GET",
		request: { query: [], body: null },
		response:
		{
			200: "{ id: '<uuid>', email: '<email>', role: admin | viewer }",
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: { users: "Read" },
		constraints: {
			criteria: [
				"Identity resolved from the SecurityContext principal (JWT) — no path param, always the caller's own row",
				"Closes the gap left by login/setup only returning { role, access_token }: this is the documented way the frontend gets its own id/email (e.g. to pre-fill the change-email form behind PATCH /api/users/me), rather than decoding the opaque access token client-side",
				"Read grant is ADMIN_/_VIEWER here vs. ADMIN-only on ep-users-list (GET /api/users) — confirmed intentional, not over-scoped: this endpoint only ever returns the caller's own row (see above), so it carries none of the full-directory disclosure ep-users-list's ADMIN gate exists to prevent; same reasoning pattern as ep-alert-rules-list's and ep-telemetry-attributes' ADMIN_/_VIEWER grants",
			],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN_/_VIEWER",
		id: "ep-users-me-get",
	},
	{
		route: "/api/users/me",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "PATCH",
		request:
		{
			query: [],
			body:
			[
				{ name: "email", type: "string", required: false },
				{ name: "password", type: "string", required: false },
			],
		},
		response:
		{
			200: "{ id: '<uuid>', email: '<email>', role: admin | viewer }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			409: "{ error: 'email already registered' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: { users: "Update" },
		constraints: {
			criteria: [
				"409 returned if a requested email collides with another user's users.email unique constraint",
			],
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
		method: "PATCH",
		request:
		{
			query: [],
			body:
			[
				{ name: "email", type: "string",required: false },
				{ name: "role",  type: "admin | viewer", required: false },
				{ name: "password", type: "string",required: false },
			],
		},
		response:
		{
			200: "{ id: '<uuid>', email: '<email>', role: admin | viewer }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			404: "{ error: 'user not found' }",
			409: "{ error: 'cannot demote the last remaining admin', code: 'LAST_ADMIN' } | { error: 'email already registered', code: 'EMAIL_TAKEN' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: { users: "Update" },
		constraints: {
			criteria:
			[
				"If role: viewer is requested and the target is currently the only user with role: admin, request is rejected with 409 — same guard as ep-users-delete, since demotion is functionally equivalent to removal",
				"If email is requested and collides with another user's users.email unique constraint, request is rejected with 409 — both 409 causes share the status code but carry distinct 'code' values (LAST_ADMIN vs EMAIL_TAKEN); clients should branch on 'code', not the 'error' message text",
				"400 returned if role is present but not one of admin | viewer — same validation pattern as severity on the alert rules endpoints, checked before the 409 last-admin guard",
			],
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
			409: "{ error: 'cannot delete the last remaining admin', code: 'LAST_ADMIN' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Users",
		tables: ["users", "sessions", "refresh_tokens", "alert_acks"],
		tables_actions: {
			users: "Delete",
			sessions: "Cascade Delete",
			refresh_tokens: "Cascade Delete",
			alert_acks: "Cascade Delete"
		},
		constraints: {
			criteria:
			[
				"If the target is currently the only user with role: admin, request is rejected with 409 — prevents the deployment from ending up with zero admins",
				"sessions.user_id and refresh_tokens.user_id are declared ON DELETE CASCADE — deleting a user removes all of their sessions and refresh_tokens rows in the same transaction as the users delete, so the 204 path never hits a dangling FK constraint",
				"alert_acks.user_id is also ON DELETE CASCADE — a deleted user's alert acknowledgment history is removed with them; this is an explicit, accepted product decision (not silent data loss) since re-showing acks for a deleted account has no meaningful owner to display",
			],
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

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
			401: "{ message: 'unauthorized' }",
			403: "{ message: 'admin role required' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: { users: "Read" },
		constraints: {
			criteria:
			[
				"Unpaginated by design, unlike the telemetry/alerts list endpoints: this is an admin-managed directory of provisioned accounts, not a continuously-inserted table, so it's expected to stay small enough that a bare array with no page size, offset, or has_more is an accepted scope decision rather than an oversight",
			],
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
			400: "{ message: '<single validation message>' }",
			401: "{ message: 'unauthorized' }",
			403: "{ message: 'admin role required' }",
			409: "{ message: 'email already registered' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: { users: "Insert" },
		constraints: {
			criteria: [
				{
					text: "400 returned if email isn't a well-formed address (local-part@domain, no whitespace, standard RFC 5322-subset check) — validated before the uniqueness lookup below, same 'checked before insert' pattern used throughout this spec. The update and self-update endpoints reuse it verbatim since they write the same column; setup and login also apply an email-format validation before continuing.",
					refs: ["ep-users-update", "ep-users-me", "ep-auth-setup"],
				},
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
			401: "{ message: 'unauthorized' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: { users: "Read" },
		constraints: {
			criteria: [
				"Identity resolved from the SecurityContext principal (JWT) — no path param, always the caller's own row",
				"Closes the gap left by login/setup only returning { role, access_token }: this is the documented way the frontend gets its own id/email (e.g. to pre-fill the change-email form behind PATCH /api/users/me), rather than decoding the opaque access token client-side",
				{
					text: "Read grant is ADMIN_/_VIEWER here vs. ADMIN-only on the full-directory users list endpoint — confirmed intentional, not over-scoped: this endpoint only ever returns the caller's own row (see above), so it carries none of the full-directory disclosure that endpoint's ADMIN gate exists to prevent; same reasoning pattern used elsewhere for ADMIN_/_VIEWER grants on otherwise-sensitive tables",
				},
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
			400: "{ message: '<single validation message>' }",
			401: "{ message: 'unauthorized' }",
			409: "{ message: 'email already registered' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: { users: "Update" },
		constraints: {
			criteria: [
				{
					text: "400 returned if email is present but malformed — same well-formed-address check as on create, not a separately-specified rule",
					refs: ["ep-users-create"],
				},
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
			400: "{ message: '<single validation message>' }",
			401: "{ message: 'unauthorized' }",
			403: "{ message: 'admin role required' }",
			404: "{ message: 'user not found' }",
			409: "{ message: 'cannot demote the last remaining admin' } | { message: 'email already registered' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: { users: "Update" },
		constraints: {
			criteria:
			[
				{
					text: "If role: viewer is requested and the target is currently the only user with role: admin, request is rejected with 409 — same guard as on delete, since demotion is functionally equivalent to removal",
					refs: ["ep-users-delete"],
				},
				"If email is requested and collides with another user's users.email unique constraint, request is rejected with 409 — both 409 causes share the status code but return different message-only JSON bodies; there is no structured error code",
				{
					text: "400 returned if email is present but malformed — same well-formed-address check as on create, not a separately-specified rule",
					refs: ["ep-users-create"],
				},
				"400 returned if role is present but not one of admin | viewer — same validation pattern as severity on the alert rules endpoints, checked before the 409 last-admin guard",
				"400 returned if the {id} path segment isn't a syntactically valid UUID — malformed path params are rejected the same way as malformed body fields above, not left to fall through to an unhandled 500 or a misleading 404",
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
			400: "{ message: '<single validation message>' }",
			401: "{ message: 'unauthorized' }",
			403: "{ message: 'admin role required' }",
			404: "{ message: 'user not found' }",
			409: "{ message: 'cannot delete the last remaining admin' }",
			429: "{ message: 'rate limited; retry in <seconds> seconds' }",
			500: "{ message: 'server error' }",
		},
		group: "Users",
		tables: [
		   "users",
		   "sessions",
		   "refresh_tokens",
		   "alert_history",
		   "alert_notifications"
		],
		tables_actions: {
			users: "Delete",
			sessions: "Cascade Delete",
			refresh_tokens: "Cascade Delete",
			alert_history: "Set owner reference NULL; retain history and actor emails",
			alert_notifications: "Cascade Delete (recipient rows)"
		},
		constraints: {
			criteria:
			[
				"If the target is currently the only user with role: admin, request is rejected with 409 — prevents the deployment from ending up with zero admins",
				"sessions.user_id and refresh_tokens.user_id are declared ON DELETE CASCADE — deleting a user removes all of their sessions and refresh_tokens rows in the same transaction as the users delete, so the 204 path never hits a dangling FK constraint",
				"Deleting another user does not clear the caller's refresh_token or session_hint. It cannot clear cookies in the deleted user's browsers either: their hints can remain stale, but their next POST /api/auth/refresh returns 401 and clears both cookies. The hint only tells the frontend to try refresh; it never proves the account or session still exists. After self-deletion, the frontend discards its access token and clears session_hint at Path=/; the remaining HttpOnly refresh cookie is unusable because its database row was deleted",
				"The alert_history owner reference uses ON DELETE SET NULL — deleting a user clears ownership without deleting alert history. Retain acked_by and resolved_by actor email snapshots unchanged, including for deleted accounts. alert_notifications.user_id uses ON DELETE CASCADE, removing only the deleted recipient notifications.",
				"400 returned if the {id} path segment isn't a syntactically valid UUID — malformed path params are rejected the same way as malformed query params or body fields elsewhere in this spec, not left to fall through to an unhandled 500 or a misleading 404",
			],
			security: [
				{
					text: "Deleting a user cascades sessions/refresh_tokens immediately. AuthFilter resolves the current users row on every authenticated HTTP request after validating JWT signature and expiry; a deleted user receives 401 immediately on their next request, even with an unexpired access token. Current database role changes also apply on the next request.",
					refs: ["gw-strat-jwt"],
				},
			],
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

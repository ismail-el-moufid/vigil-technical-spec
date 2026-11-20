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
			401: "{ message: '<authentication failure message>' }",
			403: "{ message: 'access denied' }",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: { users: "Read" },
		constraints: {
			criteria:
			[
				"Implemented unpaginated userRepository.findAll() mapped to id/email/role, including the persisted mustbe@api.email API-key account. Current frontend /settings/users is admin-only; there is no server-side pagination/filtering or special hiding/protection of the API-key account.",
			],
			security: [],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
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
			400: "{ message: 'invalid request' }",
			401: "{ message: '<authentication failure message>' }",
			403: "{ message: 'access denied' }",
			409: "{ message: 'email already registered' } | { message: 'resource already exists' } (database integrity conflict)",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: { users: "Insert" },
		constraints: {
			criteria: [
				{
					text: "Create uses @NotBlank and @Email before uniqueness lookup. Setup/login also validate nonblank email and email format; update/self-update use @Email without @NotBlank, so do not claim identical blank-email rejection. No extra server-side normalization/lowercasing or reserved API-account email rule is implemented by UsersService.",
					refs: ["ep-users-update", "ep-users-me", "ep-auth-setup"],
				},
				"UsersService prechecks exact email and returns 409 email already registered. That lookup is not a concurrency lock: a racing insert/update can instead raise DataIntegrityViolationException, mapped to 409 resource already exists. The same distinction applies to email PATCH routes.",
				"UsersPostDto requires email, role and password. Password must be at least 8 characters and contain lower/uppercase, digit and a symbol from @#$%^&+=!. Role serializes as admin | viewer; invalid enum/body validation returns { message: 'invalid request' }. application.properties enables SNAKE_CASE and fail-on-unknown-properties: unsupported fields (including role on PATCH /me) are rejected, not silently ignored. PATCH passwords use the same strength regex when non-null; null password is ignored, empty password fails validation.",
			],
			security: [],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
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
			401: "{ message: '<authentication failure message>' }",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
		},
		group: "Users",
		tables: ["users"],
		tables_actions: { users: "Read" },
		constraints: {
			criteria: [
				"Identity resolved from the SecurityContext principal (JWT or API key) — no path param, always the caller's own row. AuthProvider calls this after login/setup/initial refresh to populate user ID, email and role.",
				"Closes the gap left by login/setup only returning { role, access_token }: this is the documented way the frontend gets its own id/email (e.g. to pre-fill the change-email form behind PATCH /api/users/me), rather than treating decoded JWT claims as the profile contract",
				{
					text: "Read grant is ADMIN_/_VIEWER here vs. ADMIN-only on the full-directory users list endpoint — confirmed intentional, not over-scoped: this endpoint only ever returns the caller's own row (see above), so it carries none of the full-directory disclosure that endpoint's ADMIN gate exists to prevent; same reasoning pattern used elsewhere for ADMIN_/_VIEWER grants on otherwise-sensitive tables",
				},
			],
			security: [],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
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
			400: "{ message: 'invalid request' }",
			401: "{ message: '<authentication failure message>' }",
			409: "{ message: 'email already registered' } | { message: 'resource already exists' } (database integrity conflict)",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
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
				"409 returned if a requested email collides with another user's email. Null fields are ignored; empty PATCH {} is accepted as a no-op. Unlike create, patch email has @Email but no @NotBlank (empty email is not explicitly rejected by that DTO).",
			],
			security: ["No current-password confirmation, session revocation or token reissue occurs on email/password changes. JWT subject is the old email, so email changes require refresh before the next authenticated request. Frontend apiFetch retries one 401 through refresh; refresh issues the new subject."],
			rateLimit: "JWT: 60/min per user + method + URI; ApiKey: shared 10/min per IP",
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
			400: "{ message: 'invalid request' } | { message: 'Invalid value for parameter: id' } (UUID routes only)",
			401: "{ message: '<authentication failure message>' }",
			403: "{ message: 'access denied' }",
			404: "{ message: 'user not found' }",
			409: "{ message: 'cannot demote the last remaining admin' } | { message: 'email already registered' } | { message: 'resource already exists' }",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
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
			security: ["Admin email/password edits, like self edits, require no old-password confirmation and do not revoke sessions or reissue tokens. Role changes apply to subsequent HTTP requests through database lookup, not by trusting the JWT ROLE claim. API-key backing-account edits have no special protection."],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
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
			400: "{ message: 'Invalid value for parameter: id' }",
			401: "{ message: '<authentication failure message>' }",
			403: "{ message: 'access denied' }",
			404: "{ message: 'user not found' }",
			409: "{ message: 'cannot delete the last remaining admin' }",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
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
				"Last-admin delete/demotion checks count all admin rows, including the API-key backing user. These checks run in @Transactional methods but are not serialized or protected by explicit locking, so they are not a concurrent last-admin guarantee. No special guard prevents renaming/deleting/demoting the API-key account.",
				"sessions.user_id and refresh_tokens.user_id are declared ON DELETE CASCADE — deleting a user removes all of their sessions and refresh_tokens rows in the same transaction as the users delete, so the 204 path never hits a dangling FK constraint",
				"UsersController deletion sends no cookie-clearing headers for either self or other deletion. Cascaded refresh/session records make the deleted account credentials unusable. Current settings list mutation only invalidates the users query; it has no explicit immediate self-deletion logout path. The next authenticated request fails while the subject email is absent. Browser hints can stay stale until refresh 401 clears them.",
				"The alert_history owner reference uses ON DELETE SET NULL — deleting a user clears ownership without deleting alert history. Retain acked_by and resolved_by actor email snapshots unchanged, including for deleted accounts. alert_notifications.user_id uses ON DELETE CASCADE, removing only the deleted recipient notifications.",
				"400 returned if the {id} path segment isn't a syntactically valid UUID — malformed path params are rejected the same way as malformed query params or body fields elsewhere in this spec, not left to fall through to an unhandled 500 or a misleading 404",
			],
			security: [
				{
					text: "Deleting a user cascades sessions/refresh_tokens immediately. AuthFilter resolves the current users row on every authenticated HTTP request after validating JWT signature and expiry; a deleted user receives 401 immediately on their next request, even with an unexpired access token. Current database role changes also apply on the next request.",
					refs: ["gw-strat-jwt"],
				},
			],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-users-delete",
	},
];

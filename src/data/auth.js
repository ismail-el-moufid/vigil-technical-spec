// Shared cookie definition so refresh_token's Set-Cookie attributes are
// documented once and stay consistent across every endpoint that sets it.
const REFRESH_TOKEN_COOKIE =
{
	name: "refresh_token",
	httpOnly: true,
	secure: true,
	sameSite: "Strict",
	// Scoped to the whole /api/auth prefix, not just /api/auth/refresh —
	// every sibling route under that prefix that logs out, lists sessions,
	// or revokes a session also requires this cookie as input, so a Path
	// narrower than their shared
	// prefix would mean the browser never attaches it to those routes.
	path: "/api/auth",
	// 30 days: long enough that a user isn't forced to re-login every session,
	// short enough to bound the exposure window of a stolen cookie given the
	// reuse-detection story below (a leaked-but-unused token is only viable
	// for this long). Paired with the 15-minute access-token TTL declared on
	// AUTH_STRATEGIES.JWT — that's the window "claims lag DB state" actually
	// means in practice.
	maxAge: "30d",
};

export const AUTH_ENDPOINTS =
[
	{
		route: "/api/setup",
		service: "Spring Boot · in-memory startup state",
		owner: "Backend Lead",
		method: "GET",
		request:
		{
			query: [],
			body: null,
			cookies: null,
		},
		response:
		{
			200: "{ setup_required: true | false }",
			429: "{ timestamp: '<iso8601>', status: 429, path: '/api/setup', error: { message: 'rate limited' } }",
			500: "{ timestamp: '<iso8601>', status: 500, path: '/api/setup', error: { message: 'server error' } }",
		},
		group: "Setup",
		tables: [],
		tables_actions: {},
		constraints: {
			criteria: [
				"At process startup, the backend performs one users existence query and caches setup_required in memory: true when users has no rows, otherwise false",
				"GET /api/setup returns that cached setup_required value and does not hit PostgreSQL on the request path",
				"After POST /api/setup successfully commits the first admin, the backend flips the cached value to false; on restart the one startup query rebuilds the value from users"
			],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["PERMIT_ALL"],
		requiredRole: "NO_AUTH",
		id: "ep-setup-status",
	},
	{
		route: "/api/setup",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body:
			[
				{ name: "email", type: "string", required: true },
				{ name: "password", type: "string", required: true },
			],
			cookies: null,
		},
		response:
		{
			201: {
				body: "{ role: 'admin', access_token }",
				cookies: [REFRESH_TOKEN_COOKIE]
			},
			400: "{ timestamp: '<iso8601>', status: 400, path: '/api/setup', error: { email: '<validation message>', password: '<validation message>' } }",
			409: "{ timestamp: '<iso8601>', status: 409, path: '/api/setup', error: { message: 'setup already completed' } }",
			429: "{ timestamp: '<iso8601>', status: 429, path: '/api/setup', error: { message: 'rate limited' } }",
			500: "{ timestamp: '<iso8601>', status: 500, path: '/api/setup', error: { message: 'server error' } }",
		},
		group: "Setup",
		tables: ["users", "sessions", "refresh_tokens"],
		tables_actions: {
			users: "Insert",
			sessions: "Insert",
			refresh_tokens: "Insert"
		},
		constraints: {
			criteria:
			[
				"Hashed/salted passwords",
				"Frontend + backend validation",
				"400 returned if email is missing, not a string, or not a well-formed email address, or if password is missing, not a string, or does not meet the password-strength pattern",
				"Validation failures use the contextual error envelope: timestamp, status, and path identify the failed request; error maps each invalid field to its specific validation message",
				"Server checks the in-memory setup_required flag before creation — false returns 409 without a users-table existence read. First-admin creation is serialized in-process so only one concurrent setup request can proceed while the flag is true",
				"On the non-409 path, one users row, session row, and refresh_tokens row are inserted; only after that transaction commits is setup_required flipped to false in memory",
				"A restart reconstructs setup_required with the single boot-time users existence query, so the cached value is not treated as durable state",
			],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["PERMIT_ALL"],
		requiredRole: "NO_AUTH",
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
				{ name: "email", type: "string", required: true },
				{ name: "password", type: "string", required: true },
			],
			cookies: null,
		},
		response:
		{
			200: {
				body: "{ role: admin | viewer, access_token }",
				cookies: [REFRESH_TOKEN_COOKIE]
			},
			400: "{ timestamp: '<iso8601>', status: 400, path: '/api/auth/login', error: { email: '<validation message>', password: '<validation message>' } }",
			401: "{ timestamp: '<iso8601>', status: 401, path: '/api/auth/login', error: { message: 'unauthorized' } }",
			429: "{ timestamp: '<iso8601>', status: 429, path: '/api/auth/login', error: { message: 'rate limited' } }",
			500: "{ timestamp: '<iso8601>', status: 500, path: '/api/auth/login', error: { message: 'server error' } }",
		},
		group: "Auth",
		tables: ["users", "sessions", "refresh_tokens"],
		tables_actions: {
			users: "Read",
			sessions: "Insert",
			refresh_tokens: "Insert"
		},
		constraints: {
			criteria: [
			   "Frontend + backend validation",
			   "400 returned if email is missing, not a string, or not a well-formed email address, or if password is missing or not a string. Email format is validated before the user lookup; invalid credentials return 401."
			],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["PERMIT_ALL"],
		requiredRole: "NO_AUTH",
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
			200: { body: "{ access_token }", cookies: [REFRESH_TOKEN_COOKIE] },
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Auth",
		tables: ["sessions", "refresh_tokens"],
		tables_actions: {
			sessions: "Update (last_used_at)",
			refresh_tokens: "Update (mark old row superseded) + Insert (new row)"
		},
		constraints: {
			criteria: [],
			security:
			[
				"Public at the filter level (permitAll), but the refresh cookie's signature and expiry are validated in the service layer — fails closed with 401 if invalid or missing",
				"Stateful rotation: old refresh_tokens row marked superseded = true, new row inserted — both in one transaction",
				"Reuse detection: if presented token's row already has superseded = true, every refresh_tokens row and every sessions row sharing that user_id are revoked immediately (not just the one session tied to the reused token) and 401 is returned — this is what makes 'forces full re-login on all devices' actually true, since a user may hold several concurrent sessions rows",
			],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["PERMIT_ALL"],
		requiredRole: "NO_AUTH",
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
			204: { body: null, clears: ["refresh_token"] },
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Auth",
		tables: ["sessions", "refresh_tokens"],
		tables_actions: {
			sessions: "Update (revoked)",
			refresh_tokens: "Update (revoked)"
		},
		constraints: {
			criteria: [],
			security:
			[
				"Sets revoked = true on the presented session's sessions row and the matching refresh_tokens row — server-side invalidation, not just cookie clearing",
			],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["PERMIT_ALL"],
		requiredRole: "NO_AUTH",
		id: "ep-auth-logout",
	},
	{
		route: "/api/auth/sessions",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "GET",
		request:
		{
			query: [],
			body: null,
			cookies: ["refresh_token"],
		},
		response:
		{
			200: {
				body: "{ sessions: [{ id, user_agent, ip_address, last_used_at, current }] }"
			},
			401: "{ error: 'unauthorized' }",
			500: "{ error: 'server error' }",
		},
		group: "Auth",
		tables: ["sessions"],
		tables_actions: { sessions: "Read" },
		constraints: {
			criteria: [],
			security:
			[
				"Service layer validates refresh cookie to identify the requesting user — the current session is flagged via current: true in the response so the UI can distinguish it",
			],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["PERMIT_ALL"],
		requiredRole: "NO_AUTH",
		id: "ep-auth-sessions-list",
	},
	{
		route: "/api/auth/sessions/{id}",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "DELETE",
		request:
		{
			query: [],
			body: null,
			cookies: ["refresh_token"],
		},
		response:
		{
			204: {
				body: null,
				clears: [
					{
						name: "refresh_token",
						note: "only if revoking the caller's own session"
					}
				]
			},
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'forbidden' }",
			404: "{ error: 'not found' }",
			500: "{ error: 'server error' }",
		},
		group: "Auth",
		tables: ["sessions", "refresh_tokens"],
		tables_actions: {
			sessions: "Update (revoked)",
			refresh_tokens: "Update (revoked, cascaded from the session revoke)"
		},
		constraints: {
			criteria: [
				"400 returned if the {id} path segment isn't a syntactically valid UUID — malformed path params are rejected the same way as malformed query params or body fields elsewhere in this spec, not left to fall through to an unhandled 500 or a misleading 404",
			],
			security:
			[
				"Service layer validates refresh cookie — only the owning user can revoke their own sessions (403 if session.user_id !== requesting user)",
				"Revokes the sessions row and all refresh_tokens rows sharing that session_id — if :id is the current session, also clears the refresh cookie (equivalent to logout)",
			],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["PERMIT_ALL"],
		requiredRole: "NO_AUTH",
		id: "ep-auth-sessions-revoke",
	},
];

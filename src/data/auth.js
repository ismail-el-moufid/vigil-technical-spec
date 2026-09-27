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

const SESSION_HINT_COOKIE =
{
	name: "session_hint",
	httpOnly: false,
	secure: true,
	sameSite: "Strict",
	path: "/",
	maxAge: "30d",
	note: "Value=1; JavaScript-readable on app pages. Set alongside refresh_token with the same expiry, including after rotation. Not proof of login: the server ignores this hint when authenticating requests.",
};

const SESSION_HINT_PURPOSE = "Logged out and opening or reloading the app: no session_hint means skip the refresh request that would only return 401, then use GET /api/setup to choose /login or /setup. Logged in and reloading: session_hint=1 means call POST /api/auth/refresh to get a new access token, because reloading cleared the old one from memory. This saves only the pointless refresh request for a logged-out visitor; it saves no request or database work for a logged-in user.";
const CLEAR_SESSION_COOKIES = "Clear both cookies with Max-Age=0 using their original paths: refresh_token at /api/auth and session_hint at /. A hint can be stale or edited, so it never proves the user is logged in.";

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
				cookies: [REFRESH_TOKEN_COOKIE, SESSION_HINT_COOKIE]
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
				SESSION_HINT_PURPOSE,
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
				cookies: [REFRESH_TOKEN_COOKIE, SESSION_HINT_COOKIE]
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
			   SESSION_HINT_PURPOSE,
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
			200: {
			   body: "{ access_token }",
			   cookies: [REFRESH_TOKEN_COOKIE, SESSION_HINT_COOKIE]
			},
			401: {
			   body: "{ error: 'unauthorized' }",
			   clears: ["refresh_token", "session_hint"]
			},
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
				SESSION_HINT_PURPOSE,
				CLEAR_SESSION_COOKIES,
				"Public at the filter level (permitAll), but the refresh cookie's signature and expiry are validated in the service layer — fails closed with 401 if invalid or missing. Missing or empty refresh cookies are rejected before any database query",
				"On 200, rotate refresh_token and set session_hint=1 again with the new refresh cookie's expiry. On 401, clear both cookies, including when a token is expired, revoked, or reused. Network failures, 429, and 5xx do not clear the cookies or imply logout; show an error or retry state",
				"Reuse detection cannot clear cookies in other browsers: their hints may remain stale until their next refresh request returns 401 and clears both cookies",
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
			204: { body: null, clears: ["refresh_token", "session_hint"] },
			401: {
			   body: "{ error: 'unauthorized' }",
			   clears: ["refresh_token", "session_hint"]
			},
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
				CLEAR_SESSION_COOKIES,
				"Clear both cookies on successful logout and on 401 for a missing or invalid session. The frontend discards its in-memory access token. On the next page load, no hint means skip the pointless refresh request and use GET /api/setup to choose /login or /setup. Network failures, 429, and 5xx do not confirm logout or clear the cookies",
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
						note: "only if revoking the caller's current session; Path=/api/auth, Max-Age=0"
					},
					{
						name: "session_hint",
						note: "only if revoking the caller's current session; Path=/, Max-Age=0"
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
				"Revokes the sessions row and all refresh_tokens rows sharing that session_id — if :id is the current session, clear refresh_token and session_hint and discard the frontend's in-memory access token (equivalent to logout). The next page load skips the pointless refresh request",
				CLEAR_SESSION_COOKIES,
				"Revoking another session leaves the caller's cookies unchanged. The server cannot clear cookies in the other browser: its hint may remain, but its next refresh request returns 401 and clears both cookies",
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

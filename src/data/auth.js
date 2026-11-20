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
	// for this long). The access-token TTL remains 15 minutes; JWT
	// authentication loads the current database user and role on each request,
	// so deletion and role changes do not wait for token expiry.
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

const SESSION_HINT_PURPOSE = "Implemented: on initial load AuthProvider checks session_hint before refresh; no hint skips refresh. ProtectedRoute redirects unauthenticated visitors to /auth/login, where AuthEntryGuard calls GET /api/setup to choose /auth/login or /auth/setup. With a hint, refresh is followed by GET /api/users/me to restore identity. In-session apiFetch retries a 401 through one shared refresh promise without rechecking the hint. Access tokens remain in memory only.";
const CLEAR_SESSION_COOKIES = "Clear both cookies with Max-Age=0 using their original paths: refresh_token at /api/auth and session_hint at /. A hint can be stale or edited, so it never proves the user is logged in.";

export const AUTH_ENDPOINTS =
[
	{
		route: "/api/setup",
		service: "Spring Boot + PostgreSQL",
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
			200: "true | false — setupRequired (raw JSON boolean)",
			401: "{ message: '<filter authentication failure>' } — supplied invalid Authorization or token query",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
		},
		group: "Setup",
		tables: ["users"],
		tables_actions: { users: "Read (countByRole(ADMIN))" },
		constraints: {
			criteria: [
				"Every GET /api/setup request queries users with countByRole(ADMIN) and returns setupRequired = (countByRole(ADMIN) == 0)",
				"GET is informational: existing non-admin users do not prevent it returning true; any current ADMIN user, including the persisted API-key user, makes setupRequired false. Implementation gap: POST checks total user count instead, so a viewer-only database returns true here but rejects creation with 409.",
				"No startup cache or persisted setup-completion flag is used; the next request reflects the current admin count"
			],
			security: [],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
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
			400: "{ message: 'invalid request' }",
			401: "{ message: '<filter authentication failure>' } — supplied invalid Authorization or token query",
			409: "{ message: 'setup already completed' } | { message: 'resource already exists' } (database integrity conflict)",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
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
				"Implementation gap: SetupDto does not reserve mustbe@api.email. Using it as the human email collides with the separate API-key user insert and is not a dedicated validation-400 path.",
				"SetupDto applies @NotBlank/@Email to email and @NotBlank plus the strength regex to password: at least 8 characters, lower/uppercase, digit and one of @#$%^&+=!. Body/bean validation returns { message: 'invalid request' }. Frontend symbol regex is broader than backend, so client validation is not sufficient.",
				"GlobalExceptionsHandler maps body validation/unreadable JSON (including unknown DTO fields) to 400 invalid request, database integrity violations to 409 resource already exists, and explicit custom exceptions to message objects. It does not normalize every framework/proxy error.",
				"Implemented: @Transactional SetupService.handleSetup checks userRepository.count() > 0 and returns 409 when any user exists. Both initial users, human session and refresh token are inserted in that transaction. Planned hardening: serialize concurrent setup and align the POST eligibility check with GET countByRole(ADMIN); no in-process synchronization is implemented.",
				"On the non-409 path, two users rows are inserted atomically: the human admin with the submitted email/password and a separate API-key user with email mustbe@api.email, a cryptographically random password stored only as a salted bcrypt hash, and role admin (ADMIN authority). One session row and one refresh_tokens row are created for the human admin only; the returned access token and cookies belong to that human admin. The generated API-key user password is not returned or logged. After that transaction commits, countByRole(ADMIN) is nonzero and the next GET /api/setup returns false",
				"After 201, AuthProvider fetches GET /api/users/me, stores the human access token/user in memory and the setup form navigates to /service-onboarding. That admin-only wizard fetches keys, verifies TLS and opens live reads only at its verification step. setupRequired becomes false because admins exist, not because telemetry arrives. No persisted onboarding-completion flag exists.",
			],
			security: [],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
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
			400: "{ message: 'invalid request' }",
			401: "{ message: '<authentication failure message>' }",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
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
			   "LoginDto validates nonblank email/password and email format before lookup. Body validation returns { message: 'invalid request' }; bad credentials return 401 { message: 'Invalid username or password' }. No setup-strength requirement is imposed on login passwords."
			],
			security: [],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
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
			   body: "{ message: '<authentication failure message>' }",
			   clears: ["refresh_token", "session_hint"]
			},
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
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
				"Public at the security matcher level (permitAll). Refresh tokens are opaque 32-byte random values, not signed JWTs: the service hashes the supplied value with SHA-256, looks up token_hash and validates expiry, revocation and superseded state. Missing cookies fail before lookup; an empty string is hashed and looked up. Invalid credentials return 401 with { message: 'invalid Refresh Token' }.",
				"On 200, rotate refresh_token and reset session_hint=1 with hardcoded 30-day cookie Max-Age. Service-level 401 clears both cookies; a filter-level 401 caused by a supplied header/query token never reaches that controller cleanup. Network failures, 429 and 5xx do not clear server cookies. Token database expiry is separately configured (currently also 30 days).",
				"Reuse detection cannot clear cookies in other browsers: their hints may remain stale until their next refresh request returns 401 and clears both cookies",
				"Stateful rotation: old refresh_tokens row marked superseded = true, new row inserted — both in one transaction",
				"Reuse detection runs before revoked/expiry checks in refresh, logout, list and revoke. A superseded token revokes all of that user's sessions and their refresh tokens; dontRollbackOn=UnauthorizedException retains those changes despite 401. Already issued access JWTs remain valid until expiry while their email subject exists: no session ID or revocation lookup is part of JWT validation.",
				"Rotation has no explicit locking/version guard: concurrent use is not guaranteed single-winner. The frontend shared promise only deduplicates within one AuthProvider, not across tabs/devices. Each successful rotation starts a fresh configured 30-day token lifetime; no absolute session lifetime is enforced.",
			],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
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
			   body: "{ message: '<authentication failure message>' }",
			   clears: ["refresh_token", "session_hint"]
			},
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
		},
		group: "Auth",
		tables: ["sessions", "refresh_tokens"],
		tables_actions: {
			sessions: "Update (revoked)",
			refresh_tokens: "Update (revoked)"
		},
		constraints: {
			criteria: ["Logout and session revocation do not invalidate already issued access JWTs. JWTs carry no session ID and validation does not check session revocation; they remain usable until expiry while the subject email exists."],
			security:
			[
				"Sets revoked=true on the presented session and every refresh_tokens row for that session — server-side invalidation, not just cookie clearing",
				CLEAR_SESSION_COOKIES,
				"The server clears both cookies on successful logout and service-level 401, not on rate-limit or transport failures. Frontend behavior differs: AuthProvider.signOut always clears access token, user, query cache and session_hint in finally and navigates to /auth/login, even when logout fails. A surviving HttpOnly refresh cookie is not proof of completed server-side revocation.",
			],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
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
			401: "{ message: '<authentication failure message>' }",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
		},
		group: "Auth",
		tables: ["sessions"],
		tables_actions: { sessions: "Read" },
		constraints: {
			criteria: ["SessionDto returns id, user_agent, ip_address, last_used_at and current. Lists non-revoked sessions without pagination or ordering; it does not additionally filter by refresh-token expiry. user_agent and ip_address are captured at login/setup; user_agent may be null because response DTO annotations are not invoked as request validation. last_used_at is explicitly updated on refresh, not every authenticated read."],
			security:
			[
				"Service layer validates refresh cookie to identify the requesting user — the current session is flagged via current: true in the response so the UI can distinguish it. JWT/API-key identity is neither sufficient nor compared with the cookie owner; when both credentials are supplied, cookie identity governs session access and filter identity governs rate accounting. Superseded-cookie reuse can revoke all sessions even on this GET; list/revoke 401 does not clear cookies.",
			],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
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
			400: "{ message: 'Invalid value for parameter: id' }",
			401: "{ message: '<authentication failure message>' }",
			403: "{ message: 'forbidden' }",
			404: "{ message: 'session not found' }",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
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
				"Service layer validates refresh cookie — only the owning user can revoke their own sessions (403 if session.user_id !== requesting user). Unlike refresh/logout, list/revoke do not catch service 401 to clear cookies.",
				"Revokes the session and all refresh tokens sharing session_id. For the current session the controller clears both cookies, but current useSessions only invalidates the list; immediate frontend access-token/user cleanup remains an implementation gap. The existing access JWT can still authenticate HTTP requests until expiry because AuthFilter does not consult session revocation.",
				CLEAR_SESSION_COOKIES,
				"Revoking another session leaves the caller's cookies unchanged. The server cannot clear cookies in the other browser: its hint may remain, but its next refresh request returns 401 and clears both cookies",
			],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["PERMIT_ALL"],
		requiredRole: "NO_AUTH",
		id: "ep-auth-sessions-revoke",
	},
];

// Shared cookie definition so refresh_token's Set-Cookie attributes are
// documented once and stay consistent across every endpoint that sets it.
const REFRESH_TOKEN_COOKIE =
{
	name: "refresh_token",
	httpOnly: true,
	secure: true,
	sameSite: "Strict",
	pathEndpointId: "ep-auth-refresh",
	maxAge: "<TBD>",
};

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
				body: "{ role: 'admin', access_token }",
				cookies: [REFRESH_TOKEN_COOKIE]
			},
			400: "{ error: '<validation message>' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Auth",
		tables: ["users", "sessions", "refresh_tokens"],
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
				{ name: "email",    type: "string", required: true },
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
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Auth",
		tables: ["users", "sessions", "refresh_tokens"],
		tables_actions: "Read, Insert",
		constraints: {
			criteria: ["Frontend + backend validation"],
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
			204: { body: "{ access_token }", cookies: [REFRESH_TOKEN_COOKIE] },
			401: "{ error: 'unauthorized' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Auth",
		tables: ["users", "sessions", "refresh_tokens"],
		tables_actions: "Read, Update + Insert",
		constraints: {
			criteria: [],
			security:
			[
				"Public at the filter level (permitAll), but the refresh cookie's signature and expiry are validated in the service layer — fails closed with 401 if invalid or missing",
				"Stateful rotation: old refresh_tokens row marked superseded = true, new row inserted — both in one transaction",
				"Reuse detection: if presented token's row already has superseded = true, all refresh_tokens rows and the sessions row sharing user_id are revoked immediately and 401 is returned — forces full re-login on all devices",
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
		tables_actions: "Update",
		constraints: {
			criteria: [],
			security:
			[
				"Sets revoked = true on the presented token's row — server-side invalidation, not just cookie clearing",
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
		tables_actions: "Read",
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
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'forbidden' }",
			404: "{ error: 'not found' }",
			500: "{ error: 'server error' }",
		},
		group: "Auth",
		tables: ["sessions", "refresh_tokens"],
		tables_actions: "Update",
		constraints: {
			criteria: [],
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

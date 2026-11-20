// Existing strategy IDs remain stable for endpoint/schema references.
export const AUTH_STRATEGIES =
{
	PERMIT_ALL: {
		id: "gw-strat-permit-all", tag: "PERMIT ALL", tagType: "permit", label: "No access-token requirement: SecurityConfig.permitAll()",
		items: ["Setup/login are public; refresh/logout/session management authenticate the refresh cookie in AuthService. permitAll does not bypass filters: a supplied invalid Authorization header can still be rejected by JjwtAuthFilter."],
	},
	JWT: {
		id: "gw-strat-jwt", tag: "JWT", tagType: "sec", label: "Authorization: Bearer <access_token>",
		items: [
			"Access tokens have a configured 15-minute lifetime and are held only in frontend memory, not cookies/localStorage. In-memory storage limits persistence but does not make tokens inaccessible to an active XSS payload.",
			"On initial load AuthProvider refreshes only if session_hint is present, then calls GET /api/users/me. No hint skips recovery. ProtectedRoute sends unauthenticated visitors to /auth/login; AuthEntryGuard queries GET /api/setup to choose /auth/login or /auth/setup. Temporary bootstrap failures show an error state.",
			"session_hint=1 is JavaScript-readable, Secure, SameSite=Strict, Path=/, Max-Age=30d; refresh_token is HttpOnly at /api/auth with the same attributes/expiry. The hint is not proof of authentication. Refresh 401 clears both server cookies. In-session apiFetch retries a 401 through a shared refresh promise without checking the hint or proactively checking JWT expiry; no timer-based refresh is implemented.",
			"JjwtAuthFilter verifies signature/expiry and resolves the current database user by email from the JWT subject on every authenticated HTTP request. Missing/deleted user returns 401 and roles come from the current database row. Tokens are email-subject, not immutable user-ID tokens: changing email invalidates the old subject until refresh; recreating the same email is a security-review gap.",
			"Native EventSource supplies ?token=<JWT>; header-capable HTTP clients may use Bearer JWT or ApiKey. JjwtAuthFilter accepts the JWT query parameter on any route/method when Authorization is absent, not only live routes. API keys are not supported as query tokens. Header scheme prefixes are case-sensitive (Bearer / ApiKey plus one space); any supplied header takes precedence, even if invalid. Query credentials can leak through request logs/history; do not use real tokens in examples.",
			"Live streams and WebSockets are authenticated at opening, not on every push. The frontend reopens when its token changes, but no scheduled token-expiry refresh/reconnect coordinator is currently implemented. Existing connections are not closed automatically when a user is deleted or demoted; REST requests and WS client actions reload current users separately.",
			{ text: "Account deletion rejects the old subject on the next authenticated HTTP request while that email is absent. User role changes apply on the next request; ownership restrictions remain service-level checks.", refs: ["ep-users-delete"] },
			"HMAC signing secret comes from VigilProperties; if unset it generates 64 random bytes at startup and keeps the encoded secret in memory. Restart/multiple instances require an explicitly stable shared secret to preserve outstanding access tokens. Never embed that secret in spec data.",
		],
	},
	API_KEY: {
		id: "gw-strat-api-key", tag: "API KEY", tagType: "rate", label: "Authorization: ApiKey <key>",
		items: [
			"Persistent file-backed credential, loaded once at process startup; not an auto-rotating UUID.",
			"VigilProperties uses ApiKeyFile.loadOrCreate(vigil.api-key-file), default /var/lib/vigil/admin/api-key. Existing valid files are reused; only a missing file generates a 32-byte random base64url key. The dedicated directory is owner-only 0700 and the regular credential file 0600, with locking and symlink-safe/atomic publication. Invalid/inaccessible files fail startup. Retain the credential volume across restarts; the bean exposes no apiKey setter for an inline vigil.api-key override.",
			"API-key authentication uses constant-time comparison and resolves mustbe@api.email as the persisted principal. Setup creates that user with role admin and a random bcrypt-hashed password in the same transaction as the human admin; the generated password is not returned. No backing user means API-key auth fails. Deleting/renaming/demoting that row affects API access; it is not a roleless administrator bypass.",
			"Credential-file changes are not hot-reloaded by JjwtAuthFilter: the active bean value remains the loaded value until restart. FtTranscendenceApplication dispatches admin reset-password <email>, admin delete-all-accounts and admin restore-api-user before Spring starts. These are local CLI operations, not missing HTTP routes: reset/delete use API-key HTTP calls; recovery can repair the backing account through PostgreSQL with operator confirmation. Delete-all preserves the API account, commits deletions separately and does not reopen setup because that admin remains.",
		],
	},
	INTERNAL_ONLY: {
		id: "gw-strat-internal-only", tag: "INTERNAL", tagType: "dedup", label: "Private internal services / callback connector",
		items: [
			"Spring adds connector 8081 for the ingest callback, whose controller checks localPort and returns 404 on other ports. This is the same servlet application/filter chain, not a separate filter-free server. Only the POST callback is explicitly permitAll and rate-limit-exempt.",
			"FastAPI /internal/llm/forward and /internal/llm/ask live on the separate LLM service, not the Spring 8081 connector. They have no application credential in the current code and rely on private networking; ask additionally requires X-Vigil-User-Id supplied by Spring.",
			"Deployment must isolate internal ports and enforce trusted-host networking. Cross-host/untrusted networks require authenticated service access and TLS. An extra Tomcat connector alone does not restrict every public controller from being reachable on that connector.",
		],
	},
	WS_AUTH_HANDSHAKE: {
		id: "gw-strat-ws-auth-handshake", tag: "WS AUTH", tagType: "sec", label: "WebSocket JWT validated by MyHandShake",
		items: [
			{ text: "?token=<JWT> is required by MyHandShake, which verifies signature/expiry and loads the current database user by email. It stores userId/email/role and a frame bucket in connection attributes; API-key query tokens are unsupported.", refs: ["gw-strat-jwt"] },
			"Invalid/missing query credentials reject the upgrade with 401; MyHandShake sets the status without writing a JSON error body. Earlier filter rejection can instead return a JSON 401. A valid Authorization header alone is insufficient: the handshake still requires a valid token query. WebSocketConfiguration restricts browser origins to vigil.front-end-url; this is not a general HTTP CORS policy. There is no post-connect auth window or re-auth frame protocol.",
			"Each ack/notif action reloads the user and runs the REST service method. Established push connections have no server-side JWT-expiry timer or deleted-user eviction. Frontend WS reconnect/refetch is implemented, but proactive token refresh on expiry is not.",
		],
	},
};

export const STARTUP_SEQUENCE =
[
	{ tag: "KEYS", tagType: "rate", label: "Load API credential; initialize JWT and ingestion settings", sub: "VigilProperties loads/creates the persistent API-key file, generates a JWT secret if unset and an in-memory ingestion UUID if unset. Compose supplies JWT/ingestion secrets through Vault-rendered API configtree files; its Collector uses a rendered config with a bearer-token key filename. Vault init seeds matching ingestion keys; standalone generated fallback is not shared." },
	{ tag: "CHAIN", tagType: "dedup", label: "Assemble Spring Security chain", sub: "JjwtAuthFilter resolves identity before RateLimiter; method-level authorization follows. permitAll routes still pass through filters." },
	{ tag: "LISTEN", tagType: "crit", label: "Open public connector + callback connector 8081", sub: "Both use the same servlet application. Callback controller additionally checks localPort. Setup GET queries admin count per request; setup POST currently checks total user count and is not serialized." },
];

export const FILTER_CHAIN =
[
	{ tag: "IN", tagType: "dedup", label: "CLIENT", sub: "inbound HTTP", muted: true },
	{ tag: "AUTH", tagType: "sec", label: "JjwtAuthFilter", sub: "Bearer JWT / ApiKey header, or JWT token query → current database identity" },
	{ tag: "RL", tagType: "rate", label: "RateLimiter", sub: "After authentication · identity/method/URI buckets or shared API-key IP budget" },
	{ tag: "CTRL", tagType: "crit", label: "Controller / service", sub: "@PreAuthorize and ownership / cookie checks", muted: true },
];

export const RATE_LIMITING_INFO =
[
	{
		tag: "DEFAULT", tagType: "rate", label: "60 requests/min per identity + method + exact URI (except login/API key)",
		items: [
			"Implemented by RateLimiter after JjwtAuthFilter. JWT uses user:<database id>; unauthenticated requests use ip:<remoteAddr>. The key includes HTTP method and request URI (not query), so different resource IDs have independent buckets. Capacity 60, interval refill 60 every 60s. Cookie-only requests use IP identity; frontend session settings use apiFetch with a JWT header as well as the refresh cookie and therefore use user identity when that JWT is valid.",
			"Login uses 10/min keyed by IP + method + URI. ApiKey requests instead share one 10/min IP bucket across all methods/routes, including administration commands. The filter reads request.getRemoteAddr(), not forwarded headers directly. Compose enables SERVER_FORWARD_HEADERS_STRATEGY=native, so trusted-proxy processing can rewrite that address from X-Forwarded-For. Keep API connectors unpublished and restrict trusted proxy access; direct/untrusted access can undermine IP accounting.",
			"HTTP exhaustion returns { message: 'rate limited. Try again in <seconds> seconds.' }. Registry floors Duration.toSeconds(), so the number may be zero; no Retry-After header is set. FastAPI ask has a different message format and separate 5/min per-user default limit.",
			"JSON/CSV requests each consume one token regardless of row count. SSE and WS opening GETs consume one token; established server pushes do not. The earlier shared 10/min budget for every browser endpoint is not the current implementation. Buckets are process-local ConcurrentHashMap entries with no eviction or shared cluster store; restart resets budgets, instances enforce independently, and exact-URI cardinality can grow memory use. Invalid header/query credentials rejected by JjwtAuthFilter never reach this limiter.",
			"GlobalExceptionsHandler custom errors use a message object, but exact text is source-specific: access denied, Invalid username or password, invalid Refresh Token, etc. There is no catch-all guaranteeing every framework error has that envelope. Callback runtime failure and handshake rejection explicitly have empty bodies; streaming errors are protocol events.",
		],
	},
	{
		tag: "EXEMPT", tagType: "crit", label: "Callback exemption and separate LLM limits",
		items: ["POST /internal/alerts/trigger-evaluation skips the Spring limiter. The filter also retains a legacy /internal/ingest prefix exemption, but no such controller exists.", "FastAPI internal LLM routes do not traverse Spring filters; ask has its own per-user fixed window and both inference routes share a concurrency limiter."],
	},
	{
		tag: "SSE / WS", tagType: "realtime", label: "Opening HTTP budget plus independent WS frame bucket",
		items: ["WS MyHandShake creates a per-connection capacity-10 bucket refilled every 60s. AlertSocketHandler consumes a token for every incoming text frame, including malformed/unknown actions.", "Exhausted frames get { type: 'error', message: 'rate limited. Try again in <seconds> seconds.' }; connection remains open. This is independent of the opening HTTP request bucket."],
	},
];

export const ROLE_ENFORCEMENT_INFO =
{
	note: { text: "JjwtAuthFilter resolves current identity/authorities; @PreAuthorize and service ownership checks enforce permissions. JWT and API-key requests use the same role checks. Cookie-authenticated auth routes validate in AuthService instead. SecurityConfig disables CSRF, uses STATELESS servlet sessions and does not configure HTTP CORS. SameSite=Strict cookies and same-origin deployment are relevant controls, not a CSRF-token mechanism. permitAll path matchers for setup/auth/WS are not method-scoped; controller mappings still determine supported methods.", refs: ["gw-strat-api-key"] },
	roles: [
		{ tag: "ADMIN", tagType: "sec", label: "hasRole('admin')", items: ["GET /api/config/keys · POST /api/config/tls/addresses · GET /api/config/tls/ca", "GET/POST /api/users · PATCH/DELETE /api/users/{id} (last-admin guards)", "GET/POST /api/webhooks · DELETE /api/webhooks/{id}", "POST /api/alerts/rules · PATCH/DELETE /api/alerts/rules/{id}"] },
		{ tag: "ADMIN / VIEWER", tagType: "crit", label: "hasAnyRole('admin', 'viewer')", items: ["All raw/series/attributes telemetry reads and live SSE", "GET/PATCH /api/users/me", "GET /api/alerts · GET /api/alerts/rules · PATCH /api/alerts/history/{id} (owned changes restricted) · GET/PUT notifications (caller only)", "POST /api/alerts/{id}/ask · JWT alerts WS handshake. No public /api/llm/analyze controller."] },
		{ tag: "NO AUTH", tagType: "permit", label: "permitAll matchers (not filter bypass)", items: ["GET/POST /api/setup · POST /api/auth/login", "POST /api/auth/refresh · POST /api/auth/logout · GET /api/auth/sessions · DELETE /api/auth/sessions/{id} (refresh cookie required)", "/api/alerts/ws (handshake interceptor validates token) · POST /internal/alerts/trigger-evaluation (local-port check)"] },
	],
};

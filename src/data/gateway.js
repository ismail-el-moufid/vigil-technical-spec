// ─── AUTHENTICATION STRATEGIES ───────────────────────────────────────────
// Reusable auth patterns

export const AUTH_STRATEGIES =
{
	PERMIT_ALL: {
		id: "gw-strat-permit-all",
		tag: "PERMIT ALL",
		tagType: "permit",
		label: "No auth: SecurityConfig.permitAll()",
		items:
		[
		],
	},
	JWT: {
		id: "gw-strat-jwt",
		tag: "JWT",
		tagType: "sec",
		label: "Authorization: Bearer <access_token>",
		items:
		[
			"15-minute TTL — short-lived; frontend holds it in memory only — never written to a cookie or localStorage, so it can't be read by an XSS payload",
			"Lost on hard refresh — this is the expected missing-token case; the boot guard calls /api/auth/refresh on every page load and falls back to /login or /setup on 401",
			"AuthFilter validates signature and expiry only, then sets the SecurityContext principal — no DB hit on every request",
			"On expiry the next API call returns 401; frontend calls /api/auth/refresh which validates the refresh_token cookie against the refresh_tokens table, rotates the row, and reissues a new access token and refresh cookie",
			"Claims in a live access token are explicitly designed to lag DB state until the next refresh — the tradeoff for no DB hit on every request. Scope of the re-check: 'admin endpoints' means every endpoint whose requiredRole is ADMIN, GET included, not writes only — a demoted admin's still-live token gets a 403 on their very next call to any ADMIN-tier route (e.g. GET /api/config/keys, GET /api/users), it just isn't caught until that next request happens, per the claims-lag tradeoff above. ADMIN_/_VIEWER-tier reads are not re-checked beyond signature/expiry, since any authenticated role already satisfies them",
			{
				text: "The same claims-lag tradeoff applies to account deletion, not just demotion: deleting a user cascades their sessions/refresh_tokens rows immediately (their next /api/auth/refresh fails), but does not and cannot revoke an access token already issued to them, since AuthFilter never hits the DB per request. A just-deleted user (including a self-deleted admin) can keep making authenticated calls on that still-valid token, indistinguishable from any other valid JWT, until it naturally expires — up to the full 15-minute TTL. Accepted as the same tradeoff already made for demotion above, not a separate gap",
				refs: ["ep-users-delete"],
			},
			"Signing key: HMAC secret sourced from a Spring Boot @ConfigurationProperties bean (vigil.jwt-secret) — auto-generated as a random secret at startup via @PostConstruct and held in memory only if the property is left unset. This in-memory default is a dev-mode convenience, not the production design: a restart or a multi-instance deployment where vigil.jwt-secret isn't set identically everywhere invalidates every outstanding access token silently (the instance that issued it and the instance validating it disagree on the secret). Accepted for this project's scope; production deployment requires vigil.jwt-secret to be set explicitly and identically across instances",
		],
	},
	API_KEY: {
		id: "gw-strat-api-key",
		tag: "API KEY",
		tagType: "rate",
		label: "Authorization: ApiKey <key>",
		items:
		[
			"Program-level lifetime",
			"vigil.api-key: sourced from the same @ConfigurationProperties bean, auto-generated as a UUID via @PostConstruct at startup and held in memory only if left unset — this auto-generated, in-memory-only behavior is the intended design as-is, not a dev-mode default awaiting a production override. Accepted tradeoff of that design: a restart silently rotates it, breaking any external API client holding the old value with no warning, and a multi-instance deployment mints a different key per instance since nothing pins it identically everywhere",
			"Not tied to a users row, so it has no role of its own — treated as ADMIN-equivalent on every endpoint that accepts it, including ADMIN-only ones. It is an operator/service credential (used by external API clients, etc.), not a per-person credential — anyone holding it has full API access regardless of the endpoint's requiredRole",
		],
	},
	INTERNAL_ONLY: {
		id: "gw-strat-internal-only",
		tag: "INTERNAL",
		tagType: "dedup",
		label: "Internal port only",
		items:
		[
			"Bound to an internal port; unreachable from outside the deployment network",
			"Called exclusively by trusted internal services",
		],
	},
	WS_AUTH_HANDSHAKE: {
		id: "gw-strat-ws-auth-handshake",
		tag: "WS AUTH",
		tagType: "sec",
		label: "WebSocket, JWT validated at handshake via HandshakeInterceptor",
		items:
		[
			{
				text: "Resolves role/identity identically, off the same signed claims — this is a JWT validated at a different point in the request lifecycle (HTTP Upgrade instead of every request's AuthFilter), not a distinct credential type or a fixed/implicit role",
				refs: ["gw-strat-jwt"],
			},
			"Token passed as ?token= on the upgrade request — same tradeoff as SSE (native WebSocket clients can't set an Authorization header either); accepted for this project",
			"Connection rejected during the HTTP Upgrade if the token is invalid or missing — an unauthenticated client never completes the handshake, so there's no post-connect auth window or frame protocol",
			"On token expiry, client reconnects with a fresh token; no mid-session re-auth frames",
		],
	},
};

// ─── GATEWAY INFRASTRUCTURE ───────────────────────────────────────────────────
// Infra layer documentation (startup sequence + gateway filter chain) —
// rendered by the INFRA card, not a security-specific section.
//
// Scope: this chain governs the PUBLIC port only. /internal/* routes are
// bound to a separate, network-isolated port on the same Spring Boot
// deployable and do not pass through
// CorsFilter, RateLimitFilter, or AuthFilter at all — isolation there is
// enforced at the network/port level, not by this chain.

// ─── STARTUP SEQUENCE ─────────────────────────────────────────────────────
// Boot-time order, runs once when the Spring Boot process starts — not
// triggered by any request, so this belongs here (infrastructure-wide)
// rather than folded into any single endpoint's fields. vigil.api-key must
// be generated before the filter chain assembles: AuthFilter checks
// incoming ApiKey headers against it from the moment the public port is
// reachable, so generating it first closes what would otherwise be a
// startup window where the port is open but AuthFilter has no value to
// check requests against. vigil.ingestion-key's own ordering concern is
// different and doesn't involve this process's ports at all — it's checked
// by the collector, an external process this API doesn't control the
// startup of, against services pushing it telemetry; the value reaches the
// collector by being written to a file on a volume mounted into both
// processes, which the collector's own bearertokenauth extension reads
// directly — not a manual hand-off, and not something this sequence
// enforces itself since it happens outside this process's ports. It still
// needs to exist before that file can be written, which is why key
// generation for both is grouped into one step below rather than split.
// vigil.jwt-secret (the same HMAC secret the JWT strategy signs access
// tokens with) is generated by the same
// @PostConstruct mechanism but isn't pictured below: JWT validation only
// applies to an already-logged-in caller, so it isn't a startup-ordering
// concern the way vigil.api-key is — nothing reachable at boot depends on
// it yet.
export const STARTUP_SEQUENCE =
[
	{
		tag: "KEYS",
		tagType: "rate",
		label: "Generate vigil.api-key + vigil.ingestion-key",
		sub: "Whichever key is unset on the config bean gets generated via UUID.randomUUID(). vigil.api-key stays in memory only; vigil.ingestion-key is also written to a shared file for the collector to read. Live values are fetched via a GET request.",
	},
	{
		tag: "CHAIN",
		tagType: "dedup",
		label: "Assemble filter chain",
		sub: "CorsFilter, RateLimitFilter (Bucket4j), and AuthFilter are wired in — AuthFilter checks incoming ApiKey headers against vigil.api-key, so it can only exist once that key is generated.",
	},
	{
		tag: "LISTEN",
		tagType: "crit",
		label: "Open public + internal ports",
		sub: "Public port opens after CHAIN, so AuthFilter is already enforcing vigil.api-key from the first request. Internal port opens at the same time, gated by network isolation rather than a key. vigil.ingestion-key's shared file is already written by this point, so the collector's own auth extension can start validating service pushes as soon as it comes up.",
	},
];

export const FILTER_CHAIN =
[
	{
		tag: "IN",
		tagType: "dedup",
		label: "CLIENT",
		sub: "inbound HTTP",
		muted: true,
	},
	{
		tag: "CORS",
		tagType: "dedup",
		label: "CorsFilter",
		sub: "Spring · preflight OPTIONS",
		muted: true,
	},
	{
		tag: "RL",
		tagType: "rate",
		label: "RateLimitFilter",
		sub: "Bucket4j · 10 req/min per IP · 429 on breach",
	},
	{
		tag: "AUTH",
		tagType: "sec",
		label: "AuthFilter",
		sub: "Spring Security · JWT or ApiKey → SecurityContext",
	},
	{
		tag: "CTRL",
		tagType: "crit",
		label: "Controller",
		sub: "identity already resolved",
		muted: true,
	},
];

export const RATE_LIMITING_INFO =
[
	{
		tag: "DEFAULT",
		tagType: "rate",
		label:
			"10 req/min per IP · token-bucket · applies to all routes unless noted below",
		items:
		[
			"Capacity: 10 tokens. Refill: +10 every 60 s.",
			"Keyed by client IP — shared bucket across all endpoints for that IP, not one bucket per route",
			"429 Too Many Requests + Retry-After header on exhaustion",
			"Rate check runs before auth — an exhausted IP never reaches AuthFilter",
			"Bucket counts requests, not rows: GET ?format=csv on the telemetry endpoints (metrics/traces/logs) ignores pagination and returns the full matching dataset as one unpaginated text/csv response, but still consumes exactly one token, same as a normal small page — this is what makes CSV export viable without a separate rate-limit carve-out",
			"Known simplification: a single page load can consume several tokens at once (e.g. Overview: 3 REST GETs + 3 SSE upgrades = 6 of 10), and the bucket is shared per-IP, so multiple users behind the same NAT/proxy draw from the same 10. Acceptable for project scope; a production system would key per-user and/or size buckets per-route.",
		],
	},
	{
		tag: "EXEMPT",
		tagType: "crit",
		label: "Routes excluded from rate limiting",
		items:
		[
			"/internal/ingest/** — internal port, network-isolated; no HTTP rate limiting applies",
			"The internal LLM-forwarding route — same internal port, same network isolation; no HTTP rate limiting applies",
		],
	},
	{
		tag: "SSE / WS",
		tagType: "realtime",
		label: "Rate limiting on the initial upgrade GET only",
		items:
		[
			"The HTTP GET opening the stream consumes one token at connection time",
			"Server-push frames over the established stream are not rate-limited",
			"The alerts WebSocket upgrade — single long-lived connection per client; the upgrade GET counts once against the DEFAULT bucket, subsequent frames do not",
		],
	},
];

export const ROLE_ENFORCEMENT_INFO =
{
	note: {
		text: 'The filter resolves identity only — it answers "who is this?". Role checks (@PreAuthorize or explicit) live in the controller or service layer, not the filter. The roles below describe JWT-authenticated callers; a valid API_KEY satisfies every tier including ADMIN, since it carries no role of its own.',
		refs: ["gw-strat-api-key"],
	},
	roles:
	[
		{
			tag: "ADMIN",
			tagType: "sec",
			label: "hasRole('ADMIN') required",
			items:
			[
				"GET /api/config/keys · POST /api/users · GET /api/users",
				"PATCH /api/users/{id} · DELETE /api/users/{id} (both 409 if the action would leave zero admins)",
				"GET + POST + DELETE /api/webhooks",
				{
					text: "POST /api/alerts/rules · PATCH /api/alerts/rules/{id} · DELETE /api/alerts/rules/{id}",
					refs: ["ep-alert-rules-create", "ep-alert-rules-update", "ep-alert-rules-delete"],
				},
			],
		},
		{
			tag: "ADMIN / VIEWER",
			tagType: "crit",
			label: "Any authenticated caller — JWT or API key, any role",
			items:
			[
				"All telemetry reads · GET + PATCH /api/users/me",
				"POST /api/llm/analyze · all SSE streams",
				{
					text: "GET /api/alerts · GET /api/alerts/rules · PUT /api/alerts/{id}",
					refs: ["ep-alerts-list", "ep-alert-rules-list", "ep-alert-ack"],
				},
				{
					text: "WS alerts stream — a WebSocket, not an SSE stream; grouped here rather than under \"all SSE streams\" above since it isn't one",
					refs: ["ep-alerts-ws"],
				},
			],
		},
		{
			tag: "NO AUTH",
			tagType: "permit",
			label: "No authentication required — permitAll()",
			items:
			[
				"POST /api/auth/setup · POST /api/auth/login",
				"POST /api/auth/refresh · POST /api/auth/logout",
				"GET /api/auth/sessions · DELETE /api/auth/sessions/{id}",
			],
		},
	],
};

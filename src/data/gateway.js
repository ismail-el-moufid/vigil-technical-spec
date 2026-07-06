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
			"Short-lived; frontend holds it in memory only — never written to a cookie or localStorage, so it can't be read by an XSS payload",
			"Lost on hard refresh — this is the expected missing-token case; the boot guard calls /api/auth/refresh on every page load and falls back to /login or /setup on 401",
			"AuthFilter validates signature and expiry only, then sets the SecurityContext principal — no DB hit on every request",
			"On expiry the next API call returns 401; frontend calls /api/auth/refresh which validates the refresh_token cookie against the refresh_tokens table, rotates the row, and reissues a new access token and refresh cookie",
			"Claims in a live access token are explicitly designed to lag DB state until the next refresh — the tradeoff for no DB hit on every request; privileged writes (admin endpoints) re-check role at request time rather than trust the token's claim",
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
			"generated at startup via @PostConstruct, held in memory",
			"vigil.api-key: accepted on all protected endpoints; same access level as a valid JWT",
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
	WS_AUTH_FRAME: {
		id: "gw-strat-ws-auth-frame",
		tag: "WS AUTH",
		tagType: "sec",
		label: "WebSocket, JWT validated at handshake via AuthFilter",
		items:
		[
			"Connection rejected if token is invalid or missing at handshake",
			"On token expiry, client reconnects with a fresh token; no mid-session re-auth frames",
		],
	},
};

// ─── GATEWAY INFRASTRUCTURE ───────────────────────────────────────────────────
// Security layer documentation

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
			"Keyed by client IP — shared bucket across all endpoints for that IP",
			"429 Too Many Requests + Retry-After header on exhaustion",
			"Rate check runs before auth — an exhausted IP never reaches AuthFilter",
		],
	},
	{
		tag: "EXEMPT",
		tagType: "crit",
		label: "Routes excluded from rate limiting",
		items:
		[
			"/internal/otlp/** — internal port, network-isolated; no HTTP rate limiting applies",
			"/api/alerts/ws upgrade — single long-lived connection per client; the upgrade GET counts once, frames do not",
		],
	},
	{
		tag: "SSE",
		tagType: "realtime",
		label: "Rate limiting on the initial upgrade GET only",
		items:
		[
			"The HTTP GET opening the stream consumes one token at connection time",
			"Server-push frames over the established stream are not rate-limited",
		],
	},
];

export const ROLE_ENFORCEMENT_INFO =
{
	note: 'The filter resolves identity only — it answers "who is this?". Role checks (@PreAuthorize or explicit) live in the controller or service layer, not the filter. Alerts endpoints document their own requiredRole directly on each endpoint in alerts.js, rather than being listed here — keeps that fact in exactly one place instead of two that can drift apart.',
	roles:
	[
		{
			tag: "ADMIN",
			tagType: "sec",
			label: "hasRole('ADMIN') required",
			items:
			[
				"GET /api/config/keys · POST /api/users · GET /api/users",
				"PUT /api/users/{id} · DELETE /api/users/{id} (409 if last admin)",
				"POST + DELETE /api/webhooks",
			],
		},
		{
			tag: "ADMIN / VIEWER",
			tagType: "crit",
			label: "Any authenticated caller — JWT or API key, any role",
			items:
			[
				"All telemetry reads · GET /api/webhooks · PUT /api/users/me",
				"POST /api/llm/analyze · all SSE streams",
			],
		},
		{
			tag: "NO AUTH",
			tagType: "permit",
			label: "No authentication required — permitAll()",
			items: [],
		},
	],
};

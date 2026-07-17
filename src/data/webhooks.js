// Delivery payload shape: the full spec for it lives on the create-webhook
// endpoint below, in its own criteria, rather than as a module-level export
// — EndpointComponents.jsx only ever renders an endpoint's own fields, and
// nothing resolves a bare export name back to a card.
//
// Shape matches Grafana OnCall's "Formatted Webhook" inbound integration
// (POST .../integrations/v1/formatted_webhook/<id>/) field-for-field, so a
// webhooks.url pointed at an OnCall Formatted Webhook integration URL works
// with zero translation layer. As of March 2026 Grafana OnCall OSS is
// archived (grafana/oncall is read-only; active development moved to
// Grafana Cloud IRM), but the OSS integration endpoint and this payload
// shape remain usable for self-hosted OnCall, which is what this
// compatibility targets.

export const WEBHOOKS_ENDPOINTS =
[
	{
		route: "/api/webhooks",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "GET",
		request: { query: [], body: null },
		response:
		{
			200: "[{ id: '<uuid>', url: '<url>' }]",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Webhooks",
		tables: ["webhooks"],
		tables_actions: { webhooks: "Read" },
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
		id: "ep-webhooks-list",
	},
	{
		route: "/api/webhooks",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "POST",
		request:
		{
			query: [],
			body:
			[
				{
					name: "url",
					type: "string (must be a well-formed https:// URL)",
					required: true
				},
			],
		},
		response:
		{
			201: "{ id: '<uuid>', url: '<url>' }",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			409: "{ error: 'webhook url already registered' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Webhooks",
		tables: ["webhooks"],
		tables_actions: { webhooks: "Insert" },
		constraints: {
			criteria: [
				"400 if url isn't a well-formed https:// URL",
				"409 if url collides with the existing unique constraint on webhooks.url — checked before insert, not left as an unhandled DB constraint violation",
				"Delivery payload POSTed to url on alert (previously unspecified): { alert_uid: '<alert_history.id>', title: '<severity> alert: <metric_name> on <service>', message: '<llm_analysis>', state: 'alerting', link_to_upstream_details: '<vigil.frontend-base-url>/alerts?id=<alert_history.id>', service, metric_name, threshold: number | null, severity: info | warning | critical, triggered_at, signal_type: logs | metrics | traces | null, window_seconds: number | null, aggregation: string | null }. First five fields match Grafana OnCall's Formatted Webhook inbound integration field-for-field — a url pointed at an OnCall Formatted Webhook URL needs no translation layer (OnCall OSS has been archived since March 2026, grafana/oncall is read-only with development continuing in Grafana Cloud IRM, but the OSS integration endpoint and this payload shape remain usable for self-hosted OnCall). The rest are Vigil-native, appended for receivers that aren't OnCall — signal_type/window_seconds/aggregation are null for silence-watchdog alerts, same reasoning as everywhere else these columns appear",
				"Fires once, after LLM completion — or after FastAPI's 30-second analysis timeout, at which point Spring Boot writes 'Analysis unavailable' as llm_analysis and proceeds to webhooks anyway — not at initial trigger, since llm_analysis is the payload's message body",
				"state is always 'alerting', never 'ok': Vigil alerts are closed by a person acknowledging or resolving them (PUT /api/alerts/{id} with { status: acknowledged | resolved }, or the equivalent WS ack frame), not by any automatic condition clearing, so there is no resolve event this pipeline could ever send",
				"link_to_upstream_details requires a new Spring Boot @ConfigurationProperties value, vigil.frontend-base-url (operator-provided, e.g. the deployed frontend's origin) — nothing else in the spec previously required the backend to know its own frontend's URL",
			],
			security: [
				"ADMIN-gated, which bounds who can register a target; server additionally resolves the hostname at registration time and rejects (400) targets resolving to private/loopback/link-local ranges or the cloud metadata address (169.254.169.254) — this narrows but does not eliminate SSRF risk (DNS can still change post-registration), which remains an accepted residual scope limitation for this project",
			],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "Delivery failures are silent — no retry, no backoff, no dead-letter, no delivery-status surfaced anywhere in the API. Accepted scope decision for this project: webhook delivery is fire-and-forget by design, same treatment as the SSRF residual-risk note above. A production system would want at minimum a retry-with-backoff policy and a visible delivery-failure indicator per webhooks row.",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-webhooks-create",
	},
	{
		route: "/api/webhooks/{id}",
		service: "Spring Boot + PostgreSQL",
		owner: "Backend Lead",
		method: "DELETE",
		request: { query: [], body: null },
		response:
		{
			204: "Empty response",
			400: "{ error: '<validation message>' }",
			401: "{ error: 'unauthorized' }",
			403: "{ error: 'admin role required' }",
			404: "{ error: 'webhook not found' }",
			429: "{ error: 'rate limited' }",
			500: "{ error: 'server error' }",
		},
		group: "Webhooks",
		tables: ["webhooks"],
		tables_actions: { webhooks: "Delete" },
		constraints: {
			criteria: [
				"400 returned if the {id} path segment isn't a syntactically valid UUID — malformed path params are rejected the same way as malformed query params or body fields elsewhere in this spec, not left to fall through to an unhandled 500 or a misleading 404",
			],
			security: [],
			rateLimit: "10 req/min",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-webhooks-delete",
	},
];

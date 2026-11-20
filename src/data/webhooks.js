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
			401: "{ message: '<authentication failure message>' }",
			403: "{ message: 'access denied' }",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
		},
		group: "Webhooks",
		tables: ["webhooks"],
		tables_actions: { webhooks: "Read" },
		constraints: {
			criteria:
			[
				"Unpaginated by design, unlike the telemetry/alerts list endpoints: this is an admin-managed list of registered webhook targets, not a continuously-inserted table, so it's expected to stay small enough that a bare array with no page size, offset, or has_more is an accepted scope decision rather than an oversight",
			],
			security: [],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
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
			400: "{ message: 'invalid request' } for body/Bean Validation errors; { message: '<URL/DNS validation message>' } for service validation",
			401: "{ message: '<authentication failure message>' }",
			403: "{ message: 'access denied' }",
			409: "{ message: 'webhook url already registered' } for precheck; { message: 'resource already exists' } for DataIntegrityViolationException",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
		},
		group: "Webhooks",
		tables: ["webhooks"],
		tables_actions: { webhooks: "Insert" },
		constraints: {
			criteria: [
				"WebhookUrlValidator requires HTTPS with a hostname, no embedded credentials or fragment, and a valid port (not zero or above 65535). Paths/query strings are allowed. Resolve all DNS addresses and reject nonpublic destinations (including loopback/private/link-local/multicast and shared address space). Unresolvable hosts return 400.",
				"WebhooksService checks exact URL-string equality before insert and returns 409 webhook url already registered for an existing match. URLs are not canonicalized. The database also declares URL uniqueness, but a concurrent-insert race can still hit that constraint; GlobalExceptionsHandler maps DataIntegrityViolationException to 409 resource already exists, not the precheck message. The shared request/response DTO also accepts optional id (UUID), but creation ignores it and generates the ID; unknown JSON fields are rejected.",
				"Delivery payload POSTed to url on alert (previously unspecified): { alert_uid: '<alert_history.id>', title: '<severity> alert: <metric_name> on <service>', message: '<llm_analysis>', state: 'alerting', link_to_upstream_details: '<vigil.frontend-base-url>/alerts?id=<alert_history.id>', service, metric_name, threshold: number | null, severity: info | warning | critical, triggered_at, signal_type: logs | metrics | traces | null, window_seconds: number | null, aggregation: string | null }. First five fields match Grafana OnCall's Formatted Webhook inbound integration field-for-field — a url pointed at an OnCall Formatted Webhook URL needs no translation layer (OnCall OSS has been archived since March 2026, grafana/oncall is read-only with development continuing in Grafana Cloud IRM, but the OSS integration endpoint and this payload shape remain usable for self-hosted OnCall). The rest are Vigil-native, appended for receivers that aren't OnCall — signal_type/window_seconds/aggregation are null for silence-watchdog alerts, same reasoning as everywhere else these columns appear",
				"One best-effort delivery attempt per registered target is queued after automatic analysis persistence and WebSocket broadcast, not at initial trigger or after interactive ask. FastAPI inference timeout defaults to 25s; Spring LlmClient defaults to 30s. Context/inference failures (not just timeout) persist Analysis unavailable and then follow the same delivery path. Missing history or save/broadcast failures can stop scheduling; this is not guaranteed exactly-once delivery.",
				"state is always 'alerting', never 'ok': users change shared history through PATCH /api/alerts/history/{id}?status=acknowledged|resolved|sent or the equivalent WS ack action. This webhook pipeline runs only on initial trigger/LLM completion, not on manual history or notification updates; manual resolution/reopening does not send a webhook",
				"WebhookDeliveryService snapshots all currently registered targets and serializes one JSON payload before enqueueing a sequential fan-out on its own single-thread executor. Deleting a target does not cancel an already queued snapshot, and new targets do not join that snapshot. Requests set Content-Type: application/json; there is no configured signing secret, signature header, receiver authorization header or delivery receipt store.",
				"Implemented link base: VigilProperties.frontendBaseUrl, falling back to frontEndUrl then http://localhost:3000 when unset. Known frontend mismatch: delivery currently generates /alerts?id=<uuid>, but App.tsx/AlertsPage read ?alert=<uuid>. The link opens the page without targeting the alert until these are aligned.",
			],
			security: [
				"ADMIN-gated. WebhooksService validates URL/DNS before registration and WebhookDeliveryService revalidates immediately before every send. DNS is not pinned to the validated address for the subsequent HTTP connection, so a residual resolution/connect race remains; do not describe this as complete SSRF elimination.",
			],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
			realtime: "None",
			fallback: "Best-effort single-threaded delivery queue with 5s connect and read timeouts. Failures/non-2xx responses are logged using webhook ID, alert ID and status/exception class, not target URLs or credentials. No retry/backoff/dead-letter or API/UI delivery status exists; failures are not silent in server logs.",
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
			400: "{ message: 'Invalid value for parameter: id' }",
			401: "{ message: '<authentication failure message>' }",
			403: "{ message: 'access denied' }",
			404: "{ message: 'webhook not found' }",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			500: "Unhandled server/framework failure; no catch-all message-envelope guarantee",
		},
		group: "Webhooks",
		tables: ["webhooks"],
		tables_actions: { webhooks: "Delete" },
		constraints: {
			criteria: [
				"400 returned if the {id} path segment isn't a syntactically valid UUID — malformed path params are rejected the same way as malformed query params or body fields elsewhere in this spec, not left to fall through to an unhandled 500 or a misleading 404",
			],
			security: [],
			rateLimit: "JWT: 60/min per user + method + URI; anonymous: 60/min per IP + method + URI; login: 10/min per IP; ApiKey: shared 10/min per IP",
			realtime: "None",
			fallback: "None",
			dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"],
		requiredRole: "ADMIN",
		id: "ep-webhooks-delete",
	},
];

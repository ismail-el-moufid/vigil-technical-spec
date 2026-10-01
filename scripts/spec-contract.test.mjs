import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import formatShape from "../src/utils/formatShape.js";
import * as spec from "../src/data/index.js";
import { ARCHITECTURE_SECTIONS } from "../src/data/architecture.js";
import { PAGES } from "../src/data/pages.js";

function response(id, status, endpoints = spec.ENDPOINTS)
{
	const endpoint = endpoints.find((entry) => entry.id === id);
	assert.ok(endpoint, `Missing endpoint: ${id}`);
	return endpoint.response[status];
}


for (const { id, status, alternatives } of [
	{
		id: "ep-users-update",
		route: "/api/users/{id}",
		status: 409,
		alternatives: [
			["cannot demote the last remaining admin", "LAST_ADMIN"],
			["email already registered", "EMAIL_TAKEN"],
		],
	},
	{
		id: "ep-alert-rules-update",
		route: "/api/alerts/rules/{id}",
		status: 403,
		alternatives: [
			["admin role required", "ADMIN_REQUIRED"],
			["cannot modify service, metric_name, aggregation, window_seconds, threshold, or severity on a default rule", "DEFAULT_RULE_PROTECTED"],
		],
	},
	{
		id: "ep-alert-rules-delete",
		route: "/api/alerts/rules/{id}",
		status: 403,
		alternatives: [
			["admin role required", "ADMIN_REQUIRED"],
			["cannot delete a default rule", "DEFAULT_RULE_PROTECTED"],
		],
	},
])
{
	test(`${id} preserves every ${status} error alternative`, () =>
	{
		assert.equal(response(id, status), alternatives.map(([message]) => message).join(" | "));
	});
}

test("path-only validation errors name the id field", () =>
{
	for (const [id] of [
		["ep-auth-sessions-revoke", "/api/auth/sessions/{id}"],
		["ep-users-delete", "/api/users/{id}"],
		["ep-alert-rules-delete", "/api/alerts/rules/{id}"],
	])
	{
		assert.equal(response(id, 400), "<validation message>");
	}
});

test("setup routes return a boolean status and string errors", () =>
{
	assert.equal(response("ep-setup-status", 200), "true | false — setupRequired (raw JSON boolean)");
	assert.equal(response("ep-setup-status", 429), "rate limited; retry in <seconds> seconds");
	assert.equal(spec.ENDPOINTS.find((entry) => entry.id === "ep-auth-setup").route, "/api/setup");
});

test("alert acknowledgment route and rule creation body match the backend", () =>
{
	assert.equal(spec.ENDPOINTS.find((entry) => entry.id === "ep-alert-ack").route, "/api/alerts/ack/{id}");
	const create = spec.ENDPOINTS.find((entry) => entry.id === "ep-alert-rules-create");
	assert.deepEqual(create.request.body.find((field) => field.name === "service"),
		{ name: "service", type: "string", required: true });
});

test("rate-limit responses combine the reason and retry delay in one message", () =>
{
	for (const endpoint of spec.ENDPOINTS.filter((entry) => entry.response?.[429]))
	{
		assert.equal(endpoint.response[429], "rate limited; retry in <seconds> seconds");
	}
	assert.equal(response("ep-alerts-ws", "rateLimited"),
		"{ type: 'error', message: 'rate limited; retry in <seconds> seconds' }");
	assert.match(JSON.stringify(spec.RATE_LIMITING_INFO), /Do not send a Retry-After header or a separate retry field/);
});

test("first-admin setup creates the persisted API-key admin in the same transaction", () =>
{
	const setup = spec.ENDPOINTS.find((entry) => entry.id === "ep-auth-setup");
	const criteria = setup.constraints.criteria.join(" ");
	assert.match(criteria, /two users rows are inserted atomically/);
	assert.match(criteria, /mustbe@api.email.*cryptographically random password.*salted bcrypt hash.*role admin/);
	assert.match(criteria, /session row and one refresh_tokens row are created for the human admin only/);
	assert.match(criteria, /mustbe@api.email is reserved/);
	const strategy = spec.AUTH_STRATEGIES.API_KEY.items.join(" ");
	assert.match(strategy, /SecurityContext principal/);
	assert.match(strategy, /Before setup creates the user, API-key authentication cannot succeed/);
	assert.doesNotMatch(strategy, /Not tied to a users row|ADMIN-equivalent/);
	assert.doesNotMatch(spec.ROLE_ENFORCEMENT_INFO.note.text, /no role of its own/);
});

test("onboarding defines post-setup navigation, lifecycle and filtered view links", () =>
{
	const page = PAGES.find((entry) => entry.id === "page-onboarding");
	assert.ok(page);
	assert.equal(page.path, "/onboarding");
	assert.match(page.desc, /Admin-only/);
	for (const id of ["ep-config-keys", "ep-telemetry-traces-live", "ep-telemetry-logs-live", "ep-telemetry-metrics-live", "ep-auth-refresh", "ep-auth-logout"])
	{
		assert.ok(page.endpointIds.includes(id), `Onboarding must reference ${id}`);
		assert.ok(spec.ENDPOINTS.some((entry) => entry.id === id));
	}
	const requirements = page.requirements.join(" ");
	assert.match(requirements, /independently of key loading and configuration copying/);
	assert.match(requirements, /Empty name means idle with no live connections/);
	assert.match(requirements, /any one stream/);
	assert.match(requirements, /invalidate the old monitoring session/);
	assert.match(requirements, /retain the deployment ingestion key/);
	assert.match(requirements, /traces-only, logs-only and metrics-only each detect success/);
	for (const signal of ["traces", "logs", "metrics"])
	{
		assert.ok(requirements.includes(`/${signal}?service=<encodedServiceName>`));
		assert.match(PAGES.find((entry) => entry.id === `page-${signal}`).desc, /Accepts \?service=/);
	}
	const setup = spec.ENDPOINTS.find((entry) => entry.id === "ep-auth-setup");
	assert.match(setup.constraints.criteria.join(" "), /After a 201 response.*navigates to \/onboarding/);
});

test("live telemetry supports name with a compatible service alias and required read token", () =>
{
	for (const signal of ["traces", "logs", "metrics"])
	{
		const endpoint = spec.ENDPOINTS.find((entry) => entry.id === `ep-telemetry-${signal}-live`);
		assert.equal(endpoint.method, "SSE");
		const params = endpoint.request.query;
		assert.match(params.find((param) => param.name === "name").type, /exact OTel service.name.*takes precedence.*empty name returns 400/);
		assert.match(params.find((param) => param.name === "service").type, /backward-compatible alias/);
		assert.equal(params.find((param) => param.name === "token").required, true);
		assert.match(JSON.stringify(endpoint.constraints.realtime), /no replay guarantee/);
	}
	const criteria = spec.ENDPOINTS.find((entry) => entry.id === "ep-telemetry-logs-live").constraints.criteria.join(" ");
	assert.match(criteria, /any one of logs, traces or metrics is sufficient/);
	assert.match(criteria, /heartbeats and stale callbacks/);
	assert.match(criteria, /one three-stream opening consumes three tokens/);
	assert.match(JSON.stringify(spec.AUTH_STRATEGIES.JWT.items), /single in-flight session refresh shared across subscribers/);
});

test("onboarding configuration uses the ingestion key without a demo fallback", () =>
{
	const endpoint = spec.ENDPOINTS.find((entry) => entry.id === "ep-config-keys");
	assert.equal(endpoint.requiredRole, "ADMIN");
	const criteria = JSON.stringify(endpoint.constraints.criteria);
	for (const variable of ["OTEL_SERVICE_NAME", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_PROTOCOL", "OTEL_EXPORTER_OTLP_HEADERS"])
	{
		assert.ok(criteria.includes(variable));
	}
	assert.match(criteria, /never substitute a demo key/);
	assert.match(criteria, /returned api_key is not included/);
	const deployment = ARCHITECTURE_SECTIONS.find((section) => section.id === "deployment");
	assert.ok(deployment.items.some((item) => item.title === "Onboarding OTLP address" && item.text.includes("/v1/traces")));
});

test("setup, login and refresh issue a readable hint alongside the HttpOnly refresh token", () =>
{
	for (const [id, status] of [["ep-auth-setup", 201], ["ep-auth-login", 200], ["ep-auth-refresh", 200]])
	{
		const cookies = response(id, status).cookies;
		assert.deepEqual(cookies.map((cookie) => cookie.name), ["refresh_token", "session_hint"]);
		const [refresh, hint] = cookies;
		assert.equal(refresh.httpOnly, true);
		assert.equal(refresh.path, "/api/auth");
		assert.equal(hint.httpOnly, false);
		assert.equal(hint.path, "/");
		assert.equal(hint.secure, true);
		assert.equal(hint.sameSite, "Strict");
		assert.equal(hint.maxAge, refresh.maxAge);
		assert.match(hint.note, /Value=1/);
	}
});

test("logout and rejected refresh clear both cookies, but temporary errors do not", () =>
{
	for (const [id, status] of [["ep-auth-logout", 204], ["ep-auth-logout", 401], ["ep-auth-refresh", 401]])
	{
		assert.deepEqual(response(id, status).clears, ["refresh_token", "session_hint"]);
	}
	for (const id of ["ep-auth-refresh", "ep-auth-logout"])
	{
		for (const status of [429, 500]) assert.equal(response(id, status).clears, undefined);
	}
});

test("session revocation clears both cookies only for the current session", () =>
{
	const clears = response("ep-auth-sessions-revoke", 204).clears;
	assert.deepEqual(clears.map((cookie) => cookie.name), ["refresh_token", "session_hint"]);
	for (const cookie of clears) assert.match(cookie.note, /only if revoking the caller's current session/);
	assert.match(clears[0].note, /Path=\/api\/auth, Max-Age=0/);
	assert.match(clears[1].note, /Path=\/, Max-Age=0/);
});

const sourceEndpoints = Object.entries(spec)
	.filter(([name]) => name.endsWith("_ENDPOINTS"))
	.flatMap(([, endpoints]) => endpoints);

test("contextual source errors publish string messages", () =>
{
	let checked = 0;
	for (const endpoint of sourceEndpoints)
	{
		for (const [status, value] of Object.entries(endpoint.response ?? {}))
		{
			if (typeof value === "string" && value.startsWith("{ timestamp:"))
			{
				assert.equal(typeof response(endpoint.id, status), "string", `${endpoint.id}: ${status}`);
				assert.ok(!response(endpoint.id, status).startsWith("{"), `${endpoint.id}: ${status}`);
				checked++;
			}
		}
	}
	assert.ok(checked > 0, "Expected contextual source envelopes");
});

test("successful responses, cookie metadata and stream frames are unchanged", () =>
{
	for (const endpoint of sourceEndpoints)
	{
		for (const [status, value] of Object.entries(endpoint.response ?? {}))
		{
			if (!/^[45]\d\d$/.test(status))
			{
				assert.strictEqual(response(endpoint.id, status), value, `${endpoint.id}: ${status}`);
			}
		}
	}
});

test("extra contract shapes normalize through exported ENDPOINTS", async (t) =>
{
	const suffix = " — { error: 'example only' } is explanatory text.";
	const route = "/api/spec-test/{id}/{scope}/{id}/{parent_id}";
	const fixtures = [
		{
			name: "preserves explanatory suffixes after error alternatives",
			endpoint: {
				id: "spec-test-suffix",
				route: "/api/users/{id}",
				response: { 409: response("ep-users-update", 409, spec.USERS_ENDPOINTS) + suffix },
			},
			status: 409,
			expected: response("ep-users-update", 409) + suffix,
		},
		{
			name: "preserves validation message alternatives without error codes",
			endpoint: {
				id: "spec-test-validation",
				route,
				request: {
					body: [{ name: "id" }, { name: "email" }, { name: "id" }],
					query: [{ name: "email" }, { name: "scope" }, { name: "id" }],
				},
				response: {
					400: "{ error: 'invalid input', code: 'INVALID_INPUT' } | { error: 'missing input', code: 'MISSING_INPUT' }",
				},
			},
			status: 400,
			expected: "invalid input | missing input",
		},
	];

	// Re-import only the barrel so in-memory fixtures exercise the published
	// contract without exposing the private normalizer as a public API.
	const originalLength = spec.AUTH_ENDPOINTS.length;
	spec.AUTH_ENDPOINTS.push(...fixtures.map(({ endpoint }) => endpoint));
	try
	{
		const { ENDPOINTS } = await import("../src/data/index.js?spec-contract-fixtures");
		for (const { name, endpoint, status, expected } of fixtures)
		{
			await t.test(name, () =>
			{
				assert.equal(response(endpoint.id, status, ENDPOINTS), expected);
			});
		}
	}
	finally
	{
		spec.AUTH_ENDPOINTS.splice(originalLength, fixtures.length);
	}
});


test("one unversioned metadata callback replaces the signal-specific ingest routes", () =>
{
	const callbacks = spec.INTERNAL_ENDPOINTS.filter((endpoint) => endpoint.group === "Alert Telemetry Evaluation");
	assert.equal(callbacks.length, 1);
	const [callback] = callbacks;
	assert.equal(callback.id, "ep-alerts-trigger-evaluation");
	assert.equal(callback.route, "/internal/alerts/trigger-evaluation");
	assert.equal(callback.method, "POST");
	assert.equal(callback.internal, true);
	assert.deepEqual(callback.authStrategy, ["INTERNAL_ONLY"]);
	assert.deepEqual(Object.keys(callback.request.body), ["notification_id", "signal_type", "stored_at", "services"]);
	assert.deepEqual(Object.keys(callback.request.body.services[0]), ["service", "latest_timestamp"]);
	assert.match(callback.request.body.signal_type, /logs \| metrics \| traces/);
	assert.match(callback.response[204], /synchronous evaluation and alert persistence/);
	assert.equal(callback.response[202], undefined);
	assert.equal(callback.response[409], undefined);
	assert.match(response(callback.id, 400), /services\[0\]\.latest_timestamp/);
	for (const table of ["logs", "metrics", "traces"]) assert.equal(callback.tables_actions[table], "Read");
});

test("evaluation is synchronous and notifications are not persisted", () =>
{
	const callback = spec.ENDPOINTS.find((endpoint) => endpoint.id === "ep-alerts-trigger-evaluation");
	assert.equal(spec.SCHEMA.evaluation_notifications, undefined);
	assert.ok(!callback.tables.includes("evaluation_notifications"));
	assert.equal(callback.tables_actions.evaluation_notifications, undefined);
	const criteria = JSON.stringify(callback.constraints.criteria);
	assert.match(criteria, /Synchronous processing/);
	assert.match(criteria, /Return 204 only after evaluation succeeds/);
	assert.match(criteria, /does not deduplicate callbacks/);
	assert.match(criteria, /duplicate alert_history rows/);
	assert.match(criteria, /NOT restricted to vigil.notification_id/);
	assert.match(criteria, /last_seen = max\(stored_at\)/);
	assert.match(criteria, /Logs:.*Metrics:.*Traces:/);
	assert.doesNotMatch(JSON.stringify({ spec, architecture: ARCHITECTURE_SECTIONS }), /evaluation_notifications|durable inbox|returning 202/);
});

test("live telemetry and rule schema references resolve to the unified callback", () =>
{
	const callback = spec.ENDPOINTS.find((endpoint) => endpoint.id === "ep-alerts-trigger-evaluation");
	for (const signal of ["logs", "metrics", "traces"])
	{
		const stream = spec.ENDPOINTS.find((endpoint) => endpoint.id === `ep-telemetry-${signal}-live`);
		assert.deepEqual(stream.constraints.realtime.refs, [callback.id]);
		assert.match(stream.constraints.realtime.text, /\/internal\/alerts\/trigger-evaluation/);
		assert.match(stream.constraints.realtime.text, /vigil\.notification_id/);
		assert.ok(callback.constraints.realtime.refs.includes(stream.id));
	}
	const signalColumn = spec.SCHEMA.alert_rules.columns.find((column) => column.name === "signal_type");
	assert.ok(signalColumn.notes.refs.includes(callback.id));
});

test("published spec and architecture contain no obsolete ingest routes or IDs", () =>
{
	const published = JSON.stringify({ spec, architecture: ARCHITECTURE_SECTIONS });
	assert.doesNotMatch(published, /\/internal\/ingest|ep-ingest-(logs|metrics|traces)/);
	assert.match(JSON.stringify(ARCHITECTURE_SECTIONS), /POST \/internal\/alerts\/trigger-evaluation/);
	assert.match(JSON.stringify(spec.RATE_LIMITING_INFO), /\/internal\/alerts\/trigger-evaluation/);
	const endpointIds = spec.ENDPOINTS.map((endpoint) => endpoint.id);
	const routes = spec.ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.route}`);
	assert.equal(new Set(endpointIds).size, endpointIds.length);
	assert.equal(new Set(routes).size, routes.length);
});


test("callback services render as formatted JSON rather than object children", () =>
{
	const callback = spec.ENDPOINTS.find((endpoint) => endpoint.id === "ep-alerts-trigger-evaluation");
	const services = callback.request.body.services;
	const formatted = formatShape(services);
	assert.equal(typeof formatted, "string");
	assert.deepEqual(JSON.parse(formatted), services);
	const markup = renderToStaticMarkup(createElement("pre", null, formatted));
	assert.match(markup, /latest_timestamp/);
	assert.match(markup, /service/);
});

test("structured shapes and primitive values are safe preformatted React children", () =>
{
	for (const value of [{ nested: [{ message: "<script>test</script>" }] }, [], {}, null, false, 0])
	{
		const formatted = formatShape(value);
		assert.equal(typeof formatted, "string");
		assert.deepEqual(JSON.parse(formatted), value);
		const markup = renderToStaticMarkup(createElement("pre", null, formatted));
		assert.doesNotMatch(markup, /<script>/);
	}
	for (const endpoint of spec.ENDPOINTS)
	{
		for (const value of [endpoint.request?.body, ...Object.values(endpoint.response ?? {})])
		{
			assert.doesNotThrow(() => renderToStaticMarkup(createElement("pre", null, formatShape(value))), endpoint.id);
		}
	}
});

test("shape formatter preserves shorthand and nested string contracts", () =>
{
	assert.equal(formatShape("  Empty response  "), "Empty response");
	assert.equal(formatShape("{ id, status: ok | error }"), "{\n\tid,\n\tstatus: ok | error\n}");
	assert.equal(formatShape("{ context: { logs: [] }, optional?: null }"), "{\n\tcontext: {\n\t\tlogs: []\n\t},\n\toptional?: null\n}");
});


test("JSON export includes architecture and its shared diagram without classifying it as security", () =>
{
	const root = fileURLToPath(new URL("../", import.meta.url));
	const outDir = mkdtempSync(join(root, ".architecture-export-test-"));
	try
	{
		execFileSync(process.execPath, ["scripts/export-json.mjs", outDir], { cwd: root, timeout: 15000 });
		const read = (name) => JSON.parse(readFileSync(join(outDir, name), "utf8"));
		const architecture = read("Architecture.json");
		assert.deepEqual(architecture.map(({ lastUpdated, ...section }) =>
		{
			assert.ok(Number.isFinite(Date.parse(lastUpdated)));
			return section;
		}), ARCHITECTURE_SECTIONS);
		assert.deepEqual(read("FullSpec.json").Architecture, architecture);
		assert.deepEqual(read("Backend.json").Architecture, architecture);
		assert.equal(read("Frontend.json").Architecture, undefined);
		assert.ok(!Object.keys(read("Security.json")).some((key) => /architecture/i.test(key)));
		const delivery = architecture.find((section) => section.id === "delivery");
		assert.match(delivery.diagram, /^flowchart TD/);
		assert.match(delivery.diagram, /Custom Collector exporter/);
		assert.match(delivery.diagram, /Return 204 No Content/);
		const deployment = architecture.find((section) => section.id === "deployment");
		assert.equal(deployment.status, undefined);
		assert.match(JSON.stringify(deployment), /custom Docker image/);
		assert.strictEqual(spec.ARCHITECTURE_SECTIONS, ARCHITECTURE_SECTIONS);
	}
	finally
	{
		rmSync(outDir, { recursive: true, force: true });
	}
});


test("component directory indexes export every current default component", () =>
{
	for (const directory of ["src/views", "src/components/ui"])
	{
		const path = new URL(`../${directory}/`, import.meta.url);
		const index = readFileSync(new URL("index.js", path), "utf8");
		for (const file of readdirSync(path).filter((name) => name.endsWith(".jsx")))
		{
			const name = file.slice(0, -4);
			assert.ok(index.includes(`export { default as ${name} } from "./${file}";`), `${directory}: missing ${name}`);
		}
	}
});

test("data index exposes the shared architecture diagram", () =>
{
	const delivery = ARCHITECTURE_SECTIONS.find((section) => section.id === "delivery");
	assert.equal(spec.ARCHITECTURE_DELIVERY_DIAGRAM, delivery.diagram);
	assert.equal(typeof spec.ARCHITECTURE_DELIVERY_DIAGRAM, "string");
});


test("architecture states the operating design without pending alternatives", () =>
{
	for (const section of ARCHITECTURE_SECTIONS) assert.equal(section.status, undefined);
	const architecture = JSON.stringify(ARCHITECTURE_SECTIONS);
	assert.doesNotMatch(architecture, /decision pending|remain open|remain implementation decisions|not selected|Option [AB]|proposed requirements/i);
	for (const setting of ["1,000", "5 seconds", "5,000", "memory limiter", "maximum of 10 connections", "30-day TTL", "7 days", "26 hours", "80% for 5 minutes", "90%", "below 2 seconds", "300 seconds", "30 seconds"])
	{
		assert.ok(architecture.includes(setting), setting);
	}
	const callback = spec.ENDPOINTS.find((endpoint) => endpoint.id === "ep-alerts-trigger-evaluation");
	for (const text of [architecture, JSON.stringify(callback.constraints.criteria)])
	{
		assert.match(text, /10-second timeout/);
		assert.match(text, /3 attempts total/);
		assert.match(text, /1 second and then 2 seconds/);
		assert.match(text, /do not retry 4xx/i);
		assert.match(text, /(?:in memory only|only in memory)/);
		assert.match(text, /retryable whole-export failure/);
	}
	for (const [table, order] of [["logs", "service, timestamp"], ["metrics", "service, name, timestamp"], ["traces", "service, timestamp, trace_id, span_id"]])
	{
		const notes = spec.SCHEMA[table].notes;
		assert.ok(notes.includes(`ORDER BY (${order})`));
		assert.match(notes, /PARTITION BY toYYYYMM\(timestamp\)/);
		assert.match(notes, /TTL timestamp \+ INTERVAL 30 DAY DELETE/);
		assert.match(notes, /Synchronous inserts/);
	}
	assert.match(spec.SCHEMA.alert_history.notes, /No automatic expiry/);
	assert.match(JSON.stringify(callback.constraints.security), /not published/);
	assert.match(JSON.stringify(callback.constraints.security), /No additional callback credential or internal TLS/);
});

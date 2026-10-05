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
		assert.equal(response(id, status), alternatives.map(([message]) => `{ message: '${message}' }`).join(" | "));
	});
}

test("path-only validation errors return one message", () =>
{
	for (const [id] of [
		["ep-auth-sessions-revoke", "/api/auth/sessions/{id}"],
		["ep-users-delete", "/api/users/{id}"],
		["ep-alert-rules-delete", "/api/alerts/rules/{id}"],
	])
	{
		assert.match(response(id, 400), /^\{ message: '<(?:single )?validation message>' \}$/, id);
	}
});

test("setup routes return a boolean status and message errors", () =>
{
	assert.equal(response("ep-setup-status", 200), "true | false — setupRequired (raw JSON boolean)");
	assert.equal(response("ep-setup-status", 429), "{ message: 'rate limited; retry in <seconds> seconds' }");
	assert.equal(spec.ENDPOINTS.find((entry) => entry.id === "ep-auth-setup").route, "/api/setup");
});

test("alert history update replaces the old acknowledgment route and preserves rule creation", () =>
{
	const update = endpoint("ep-alert-history-update");
	assert.equal(update.route, "/api/alerts/history/{id}");
	assert.equal(update.method, "PATCH");
	assert.ok(!spec.ENDPOINTS.some((entry) => entry.id === "ep-alert-ack" || entry.route === "/api/alerts/ack/{id}"));
	const create = spec.ENDPOINTS.find((entry) => entry.id === "ep-alert-rules-create");
	assert.deepEqual(create.request.body.find((field) => field.name === "service"),
		{ name: "service", type: "string", required: true });
});

test("rate-limit responses combine the reason and retry delay in one message", () =>
{
	for (const endpoint of spec.ENDPOINTS.filter((entry) => entry.response?.[429]))
	{
		assert.equal(endpoint.response[429], "{ message: 'rate limited; retry in <seconds> seconds' }");
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

function endpoint(id)
{
	const value = spec.ENDPOINTS.find((entry) => entry.id === id);
	assert.ok(value, `Missing endpoint: ${id}`);
	return value;
}

function shape(value)
{
	return typeof value === "string" ? value : JSON.stringify(value);
}

test("barrel publishes every source endpoint and response unchanged", () =>
{
	assert.equal(spec.ENDPOINTS.length, sourceEndpoints.length);
	for (const source of sourceEndpoints)
	{
		assert.strictEqual(endpoint(source.id), source, source.id);
		for (const [status, value] of Object.entries(source.response ?? {}))
		{
			assert.strictEqual(response(source.id, status), value, `${source.id}: ${status}`);
		}
	}
});

test("all custom HTTP errors contain only a single message, preserving cookie metadata", () =>
{
	let checked = 0;
	for (const source of sourceEndpoints)
	{
		for (const [status, value] of Object.entries(source.response ?? {}))
		{
			if (!/^[45]\d\d$/.test(status)) continue;
			const body = typeof value === "object" && value !== null ? value.body : value;
			assert.equal(typeof body, "string", `${source.id}: ${status}`);
			assert.match(body, /^\{ message: '[^']*' \}(?: \| \{ message: '[^']*' \})*$/, `${source.id}: ${status}`);
			checked++;
		}
	}
	assert.ok(checked > 0);
});

test("shared history status is updated with a required query and database optimistic locking", () =>
{
	const update = endpoint("ep-alert-history-update");
	assert.deepEqual(update.request.query.map(({ name }) => name), ["status"]);
	const status = update.request.query[0];
	assert.equal(status.required, true);
	for (const state of ["acknowledged", "resolved", "sent"]) assert.ok(shape(status.type).includes(state));
	assert.ok(update.request.body == null || (Array.isArray(update.request.body) && update.request.body.length === 0));
	assert.doesNotMatch(shape(update.request), /version/);
	assert.match(shape(update.constraints), /optimistic/i);
	assert.match(shape(update.constraints), /version/i);
	const history = shape(update.response[200]);
	for (const field of ["status", "owner_id", "acked_at", "acked_by", "resolved_at", "resolved_by", "rule"])
	{
		assert.match(history, new RegExp(`\\b${field}\\b`));
	}
	assert.match(history, /rule\s*["']?\s*:\s*\{/);
	assert.ok(update.tables.includes("alert_history"));
});

test("REST and WebSocket history transitions enforce ownership and preserve historical actors", () =>
{
	for (const id of ["ep-alert-history-update", "ep-alerts-ws"])
	{
		const criteria = shape(endpoint(id).constraints.criteria);
		assert.match(criteria, /Only the acknowledging owner.*owner_id is non-null.*403.*no administrator bypass/, id);
		assert.match(criteria, /Resolve caller identity from authentication, never from a supplied owner or actor email/, id);
		assert.match(criteria, /Acknowledging unowned history claims owner_id for the caller/, id);
		assert.match(criteria, /Re-acknowledging by the owner resets acked_at to now.*current email in acked_by.*status becomes acknowledged and resolved_at\/resolved_by are cleared/, id);
		assert.match(criteria, /owner can resolve or re-acknowledge.*including a previously resolved record/, id);
		assert.match(criteria, /Unowned history may be resolved directly without acknowledging first.*status resolved, resolved_at now and resolved_by to the caller email.*leave owner_id and acknowledgment fields unchanged/, id);
		assert.match(criteria, /Resolving owned history preserves acknowledgment\/ownership fields/, id);
		assert.match(criteria, /Returning to sent reopens history and clears owner_id and all acknowledgment\/resolution fields.*only be reopened by its owner/, id);
		assert.match(criteria, /Deleting an owner sets owner_id to null without deleting history or clearing status, action timestamps or recorded actor emails/, id);
		assert.match(criteria, /Actor emails are snapshots, not read-time joins/, id);
		assert.match(criteria, /increment version on successful updates.*409.*Do not broadcast failed or rolled-back changes/, id);
	}
	assert.equal(response("ep-alert-history-update", 403), "{ message: 'only the acknowledging owner may change this history' }");
	assert.equal(response("ep-alert-history-update", 409), "{ message: 'conflicting history update' }");
	for (const name of ["acked_by", "resolved_by"])
	{
		const column = spec.SCHEMA.alert_history.columns.find((entry) => entry.name === name);
		assert.equal(column.type, "TEXT");
		assert.equal(column.fk, undefined, `${name} must survive actor deletion`);
		assert.match(shape(column.notes), /snapshot retained on deletion\/email change/);
	}
});

test("recipient notifications have cursor pagination and a required boolean seen query", () =>
{
	const list = endpoint("ep-alert-notifications-list");
	assert.equal(list.method, "GET");
	assert.equal(list.route, "/api/alerts/notifications");
	assert.deepEqual(list.request.query.map(({ name }) => name), ["count", "before"]);
	assert.match(shape(list.response[200]), /notifications/);
	assert.match(shape(list.response[200]), /has_more/);
	assert.ok(list.tables.includes("alert_notifications"));
	const update = endpoint("ep-alert-notification-update");
	assert.equal(update.method, "PUT");
	assert.equal(update.route, "/api/alerts/notifications/{historyId}");
	assert.deepEqual(update.request.query.map(({ name }) => name), ["seen"]);
	assert.equal(update.request.query[0].required, true);
	assert.match(shape(update.request.query[0].type), /bool/i);
	assert.ok(update.request.body == null || (Array.isArray(update.request.body) && update.request.body.length === 0));
	assert.ok(update.tables.includes("alert_notifications"));
});

test("notification updates are caller-scoped and preserve the first seen timestamp", () =>
{
	for (const id of ["ep-alert-notification-update", "ep-alerts-ws"])
	{
		const criteria = shape(endpoint(id).constraints.criteria);
		assert.match(criteria, /keyed by \(user_id, alert_history_id\).*Resolve user_id from authentication, never client input/, id);
		assert.match(criteria, /First marking seen sets seen_at to now; repeating seen=true preserves the existing seen_at/, id);
		assert.match(criteria, /Marking seen=false clears seen_at/, id);
		assert.match(criteria, /create a missing caller notification for existing history, including seen=false with seen_at=null/, id);
		assert.match(criteria, /Unknown history returns 404 without creating a row/, id);
		assert.match(criteria, /Commit the notification update before broadcasting Notification only to all connected sessions of that recipient.*never broadcast personal seen state to other users/, id);
	}
	const update = endpoint("ep-alert-notification-update");
	assert.match(shape(update.constraints.criteria), /Atomic upsert keyed by caller user_id and alert_history_id preserves first seen_at across concurrent seen=true requests/);
	assert.match(shape(endpoint("ep-alert-notifications-list").constraints.criteria), /Return only authenticated user notifications.*Shared history status and ownership never filter personal notification visibility/);
	assert.equal(update.tables_actions.alert_notifications, "Upsert (caller only)");
	assert.equal(endpoint("ep-alert-notifications-list").tables_actions.alert_notifications, "Read (caller only)");
});

test("schema separates shared history from per-recipient seen state", () =>
{
	assert.equal(spec.SCHEMA.alert_acks, undefined);
	const notifications = spec.SCHEMA.alert_notifications;
	assert.ok(notifications);
	assert.deepEqual(notifications.columns.filter((column) => column.pk).map(({ name }) => name).sort(), ["alert_history_id", "user_id"]);
	for (const [name, table] of [["user_id", "users"], ["alert_history_id", "alert_history"]])
	{
		assert.deepEqual(notifications.columns.find((column) => column.name === name).fk,
			{ table, column: "id", onDelete: "CASCADE" });
	}
	for (const name of ["seen", "seen_at"]) assert.ok(notifications.columns.some((column) => column.name === name));
	const columns = spec.SCHEMA.alert_history.columns;
	for (const name of ["status", "owner_id", "acked_at", "acked_by", "resolved_at", "resolved_by", "version"])
	{
		assert.ok(columns.some((column) => column.name === name), name);
	}
	assert.deepEqual(columns.find((column) => column.name === "owner_id").fk,
		{ table: "users", column: "id", onDelete: "SET NULL" });
});

test("WebSocket shares history updates and sends capitalized Notification frames without status frames", () =>
{
	const socket = endpoint("ep-alerts-ws");
	for (const status of ["acknowledged", "resolved", "sent"]) assert.ok(shape(socket.request.ack).includes(status));
	assert.match(shape(socket.request.notif), /seen/);
	assert.match(shape(socket.request.notif), /bool/i);
	for (const field of ["alert_history_id", "status", "acked_at", "acked_by", "resolved_at", "resolved_by"])
	{
		assert.ok(shape(socket.response.alert).includes(field), field);
	}
	assert.equal(socket.response.status, undefined);
	assert.match(shape(socket.response), /type["']?\s*:\s*['"]Notification['"]/);
	assert.doesNotMatch(shape(socket.response), /type["']?\s*:\s*['"]status['"]/);
});

test("alert and telemetry pagination detect an additional row rather than a full page", () =>
{
	for (const id of ["ep-alerts-list", "ep-alert-notifications-list", "ep-telemetry-metrics", "ep-telemetry-traces", "ep-telemetry-logs"])
	{
		const list = endpoint(id);
		assert.match(shape(list.response[200]), /has_more/);
		assert.match(shape(list.constraints.criteria), /count\s*\+\s*1|additional row|extra row/i);
		assert.doesNotMatch(shape(list.constraints.criteria), /returned\.length === count/);
	}
	assert.doesNotMatch(shape(endpoint("ep-alerts-list")), /my_ack/);
});

test("raw telemetry count bounds are 1-500 and sorted offsets accept 0-500", () =>
{
	for (const id of ["ep-telemetry-metrics", "ep-telemetry-traces", "ep-telemetry-logs"])
	{
		const list = endpoint(id);
		assert.ok(list.request.query.some((param) => param.name === "count"), id);
		assert.match(shape(list.constraints.criteria), /400 returned if count is present but non-numeric or outside 1-500/, id);
		if (id === "ep-telemetry-metrics") continue;
		const offset = list.request.query.find((param) => param.name === "offset");
		assert.ok(offset, id);
		assert.equal(offset.required, false, id);
		assert.match(shape(offset.type), /0-500.*non-default field/, id);
		assert.match(shape(list.constraints.criteria), /offset is present but non-numeric or outside 0-500 \(zero is valid\)/, id);
	}
});

test("JWT uses the current database role and rejects deleted users immediately", () =>
{
	const jwt = shape(spec.AUTH_STRATEGIES.JWT.items);
	assert.match(jwt, /every authenticated HTTP request/i);
	assert.match(jwt, /current database user\/role|current.*database.*role/i);
	assert.match(jwt, /Missing\/deleted user returns 401/i);
	assert.match(jwt, /not stale JWT claims/);
});

test("setup checks the current ADMIN count on every request and inside creation", () =>
{
	const status = shape(endpoint("ep-setup-status").constraints.criteria);
	assert.match(status, /Every GET \/api\/setup request/);
	assert.match(status, /countByRole\(ADMIN\) == 0/);
	assert.match(status, /Existing non-admin users do not prevent setup/);
	assert.match(shape(endpoint("ep-auth-setup").constraints.criteria), /countByRole\(ADMIN\).*creation transaction/);
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
	assert.equal(response(callback.id, 400), "{ message: '<validation message>' }");
	for (const table of ["logs", "metrics", "traces"]) assert.equal(callback.tables_actions[table], "Read");
});

test("evaluation is synchronous and callback metadata is not persisted, unlike recipient notifications", () =>
{
	const callback = spec.ENDPOINTS.find((endpoint) => endpoint.id === "ep-alerts-trigger-evaluation");
	assert.ok(spec.SCHEMA.alert_notifications, "Recipient notifications must be persisted");
	assert.ok(callback.tables.includes("alert_notifications"));
	assert.equal(callback.tables_actions.alert_notifications, "Insert (recipient rows on trigger)");
	assert.equal(spec.SCHEMA.evaluation_notifications, undefined);
	assert.ok(!callback.tables.includes("evaluation_notifications"));
	assert.equal(callback.tables_actions.evaluation_notifications, undefined);
	const criteria = JSON.stringify(callback.constraints.criteria);
	assert.match(criteria, /Synchronous processing/);
	assert.match(criteria, /alert_history and recipient alert_notifications rows in one PostgreSQL transaction/);
	assert.match(criteria, /status=sent, owner_id\/acked_at\/acked_by\/resolved_at\/resolved_by=null and version=0/);
	assert.match(criteria, /create alert_notifications for current recipient users with seen=false and seen_at=null in the same transaction/);
	assert.match(criteria, /No callback-metadata table, background evaluation queue, or persisted evaluation-processing status/);
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


test("page endpoint IDs and nested endpoint references resolve without stale routes", () =>
{
	const ids = new Set(spec.ENDPOINTS.map(({ id }) => id));
	for (const page of PAGES)
	{
		for (const id of page.endpointIds) assert.ok(ids.has(id), `${page.id}: missing endpoint ${id}`);
	}
	function checkRefs(value, path)
	{
		if (value === null || typeof value !== "object") return;
		for (const [key, child] of Object.entries(value))
		{
			if (key === "refs")
			{
				assert.ok(Array.isArray(child), `${path}.refs must be an array`);
				for (const id of child)
				{
					if (id.startsWith("ep-")) assert.ok(ids.has(id), `${path}.refs: missing endpoint ${id}`);
				}
			}
			checkRefs(child, `${path}.${key}`);
		}
	}
	checkRefs(spec, "spec");
	assert.doesNotMatch(shape(spec), /ep-alert-ack|\/api\/alerts\/ack\//);
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

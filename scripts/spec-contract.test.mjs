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

// These are documentation-contract tests, not backend/deployment acceptance tests.
// Check structured fields directly; prose checks protect specific audit findings
// without requiring entire explanatory paragraphs to remain byte-for-byte equal.
const sourceEndpoints = Object.entries(spec)
	.filter(([name]) => name.endsWith("_ENDPOINTS"))
	.flatMap(([, endpoints]) => endpoints);
const SPRING_RATE_ERROR = "{ message: 'rate limited. Try again in <seconds> seconds.' }";
const FASTAPI_RATE_ERROR = "{ message: 'rate limited; retry in <seconds> seconds' }";

function endpoint(id)
{
	const value = spec.ENDPOINTS.find((entry) => entry.id === id);
	assert.ok(value, `Missing endpoint: ${id}`);
	return value;
}

function response(id, status)
{
	const value = endpoint(id).response[status];
	assert.notEqual(value, undefined, `${id}: missing response ${status}`);
	return value;
}

function page(id)
{
	const value = PAGES.find((entry) => entry.id === id);
	assert.ok(value, `Missing page: ${id}`);
	return value;
}

function column(table, name)
{
	assert.ok(spec.SCHEMA[table], `Missing logical table: ${table}`);
	const value = spec.SCHEMA[table].columns.find((entry) => entry.name === name);
	assert.ok(value, `Missing column: ${table}.${name}`);
	return value;
}

function parameter(id, location, name)
{
	const value = endpoint(id).request[location]?.find((entry) => entry.name === name);
	assert.ok(value, `${id}: missing ${location} parameter ${name}`);
	return value;
}

function shape(value)
{
	return typeof value === "string" ? value : JSON.stringify(value);
}

function text(value)
{
	if (typeof value === "string") return value;
	if (value === null || typeof value !== "object") return "";
	return Object.values(value).map(text).join(" ");
}

function assertFields(value, fields, label = "contract")
{
	for (const field of fields)
	{
		assert.match(shape(value), new RegExp(`\\b${field}\\b`), `${label}: missing ${field}`);
	}
}

function assertEndpointRefs(value, path = "spec")
{
	if (value === null || typeof value !== "object") return;
	const ids = new Set(spec.ENDPOINTS.map(({ id }) => id));
	for (const [key, child] of Object.entries(value))
	{
		if (key === "refs")
		{
			assert.ok(Array.isArray(child), `${path}.refs must be an array`);
			for (const reference of child)
			{
				const id = typeof reference === "string" ? reference : reference?.id;
				assert.equal(typeof id, "string", `${path}.refs: missing reference ID`);
				if (id.startsWith("ep-")) assert.ok(ids.has(id), `${path}.refs: missing endpoint ${id}`);
			}
		}
		assertEndpointRefs(child, `${path}.${key}`);
	}
}

for (const { id, status, messages } of [
	{ id: "ep-users-update", status: 409, messages: ["cannot demote the last remaining admin", "email already registered"] },
	{ id: "ep-alert-rules-update", status: 403, messages: ["access denied"] },
	{ id: "ep-alert-rules-delete", status: 403, messages: ["access denied"] },
	{ id: "ep-alert-history-update", status: 403, messages: ["forbidden", "not the acknowledging user"] },
])
{
	test(`${id} preserves its current ${status} message alternatives`, () =>
	{
		assert.equal(response(id, status), messages.map((message) => `{ message: '${message}' }`).join(" | "));
	});
}

test("path-only mutations document malformed UUID validation", () =>
{
	for (const id of ["ep-auth-sessions-revoke", "ep-users-delete", "ep-alert-rules-delete"])
	{
		assert.match(response(id, 400), /^\{ message: '<(?:single )?validation message>' \}$/, id);
		assert.match(text(endpoint(id).constraints.criteria), /(?:malformed|syntactically valid) UUID/i, id);
	}
});

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

test("endpoint identities and method/route pairs remain unique", () =>
{
	const ids = spec.ENDPOINTS.map(({ id }) => id);
	const routes = spec.ENDPOINTS.map(({ method, route }) => `${method} ${route}`);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(new Set(routes).size, routes.length);
	assert.ok(!spec.ENDPOINTS.some(({ id, route }) => id === "ep-alert-ack" || route === "/api/alerts/ack/{id}"));
});

test("HTTP errors use message envelopes except for explicitly audited exceptions", () =>
{
	// An explicit allowlist prevents a new arbitrary error shape from silently
	// passing just because it does not start with a message object.
	const exceptions = new Map();
	for (const id of [
		"ep-setup-status", "ep-auth-setup", "ep-auth-login", "ep-auth-refresh", "ep-auth-logout",
		"ep-auth-sessions-list", "ep-auth-sessions-revoke", "ep-users-list", "ep-users-create",
		"ep-users-me-get", "ep-users-me", "ep-users-update", "ep-users-delete",
		"ep-webhooks-list", "ep-webhooks-create", "ep-webhooks-delete",
	])
	{
		exceptions.set(`${id}:500`, "Unhandled server/framework failure; no catch-all message-envelope guarantee");
	}
	exceptions.set("ep-alerts-trigger-evaluation:404", "Empty response — controller rejects requests arriving on a port other than 8081");
	exceptions.set("ep-alerts-trigger-evaluation:500", "Empty response — runtime failure is logged by IngestController");
	const seen = new Set();
	let envelopes = 0;
	for (const source of sourceEndpoints)
	{
		for (const [status, value] of Object.entries(source.response ?? {}))
		{
			if (!/^[45]\d\d$/.test(status)) continue;
			const key = `${source.id}:${status}`;
			const body = typeof value === "object" && value !== null ? value.body : value;
			assert.equal(typeof body, "string", key);
			if (exceptions.has(key))
			{
				assert.equal(body, exceptions.get(key), key);
				seen.add(key);
			}
			else if (key === "ep-config-tls-addresses:409")
			{
				assert.equal(body, source.response[200], key);
				assertFields(body, ["address", "configured", "status", "tls_mode"], key);
				assert.match(body, /status: 'verified'/);
				seen.add(key);
			}
			else
			{
				assert.match(body, /^\{ message: '[^']*' \}(?: \| \{ message: '[^']*' \})*$/, key);
				envelopes++;
			}
		}
	}
	assert.deepEqual([...seen].sort(), [...exceptions.keys(), "ep-config-tls-addresses:409"].sort());
	assert.ok(envelopes > 0);
	assert.match(text(spec.RATE_LIMITING_INFO), /no catch-all/i);
	assert.match(text(spec.AUTH_STRATEGIES.WS_AUTH_HANDSHAKE), /without writing a JSON error body/);
});

test("Spring and FastAPI retain distinct rate-error messages without separate retry fields", () =>
{
	for (const source of spec.ENDPOINTS.filter((entry) => entry.response?.[429]))
	{
		assert.equal(source.response[429], source.id === "ep-fastapi-ask" ? FASTAPI_RATE_ERROR : SPRING_RATE_ERROR, source.id);
	}
	assert.equal(response("ep-alerts-ws", "rateLimited"), "{ type: 'error', message: 'rate limited. Try again in <seconds> seconds.' }");
	const limits = text(spec.RATE_LIMITING_INFO);
	assert.match(limits, /floors Duration\.toSeconds\(\)/);
	assert.match(limits, /may be zero/);
	assert.match(limits, /no Retry-After header/i);
});

test("HTTP rate buckets distinguish JWT, anonymous, login and API-key callers", () =>
{
	const limits = text(spec.RATE_LIMITING_INFO);
	assert.match(limits, /60 requests\/min per identity \+ method \+ exact URI/);
	assert.match(limits, /JWT uses user:/);
	assert.match(limits, /unauthenticated requests use ip:/);
	assert.match(limits, /Login uses 10\/min keyed by IP \+ method \+ URI/);
	assert.match(limits, /ApiKey requests instead share one 10\/min IP bucket across all methods\/routes/);
	const chain = spec.FILTER_CHAIN.map(({ label }) => label);
	assert.ok(chain.includes("JjwtAuthFilter"));
	assert.ok(chain.includes("RateLimiter"));
	assert.ok(chain.indexOf("JjwtAuthFilter") < chain.indexOf("RateLimiter"));
	assert.match(limits, /opening GETs consume one token/);
	assert.match(limits, /Every incoming text frame|every incoming text frame/);
	assert.match(text(endpoint("ep-alerts-ws").constraints.rateLimit), /separate capacity-10 bucket/);
});

test("setup GET reports a fresh admin count while POST's different eligibility remains explicit", () =>
{
	const status = endpoint("ep-setup-status");
	assert.equal(status.route, "/api/setup");
	assert.equal(status.method, "GET");
	assert.equal(response(status.id, 200), "true | false — setupRequired (raw JSON boolean)");
	assert.equal(status.requiredRole, "NO_AUTH");
	assert.match(text(status.constraints), /countByRole\(ADMIN\) == 0/);
	assert.match(text(status.constraints), /No startup cache/);
	assert.match(text(status.constraints), /viewer-only database.*rejects creation with 409/);
	const create = endpoint("ep-auth-setup");
	assert.equal(create.route, status.route);
	assert.equal(create.method, "POST");
	assert.match(text(create.constraints), /userRepository\.count\(\) > 0/);
	assert.match(text(create.constraints), /no in-process synchronization is implemented/);
	assert.equal(response(create.id, 409), "{ message: 'setup already completed' }");
});

test("setup creates two admins atomically but does not reserve the API-account email", () =>
{
	const criteria = text(endpoint("ep-auth-setup").constraints.criteria);
	assert.match(criteria, /two users rows are inserted atomically/);
	assert.match(criteria, /mustbe@api\.email.*cryptographically random password.*salted bcrypt hash.*role admin/);
	assert.match(criteria, /session row and one refresh_tokens row are created for the human admin only/);
	assert.match(criteria, /generated API-key user password is not returned or logged/i);
	assert.match(criteria, /SetupDto does not reserve mustbe@api\.email/);
	assert.match(criteria, /not a dedicated validation-400 path/);
	assert.match(criteria, /GET \/api\/users\/me/);
	assert.match(criteria, /navigates to \/service-onboarding/);
});

test("API-key credentials are persistent file-backed values tied to a database principal", () =>
{
	const strategy = text(spec.AUTH_STRATEGIES.API_KEY);
	assert.match(strategy, /ApiKeyFile\.loadOrCreate/);
	assert.match(strategy, /only a missing file generates a 32-byte random base64url key/);
	assert.match(strategy, /0700/);
	assert.match(strategy, /0600/);
	assert.match(strategy, /Invalid\/inaccessible files fail startup/);
	assert.match(strategy, /not hot-reloaded/);
	assert.match(strategy, /mustbe@api\.email as the persisted principal/);
	assert.match(strategy, /No backing user means API-key auth fails/);
	assert.match(strategy, /not a roleless administrator bypass/);
	assertFields(response("ep-config-keys", 200), ["api_key", "ingestion_key"]);
	assert.doesNotMatch(response("ep-config-keys", 200), /<uuid>/);
});

test("setup, login and refresh issue a readable hint alongside the HttpOnly refresh token", () =>
{
	for (const [id, status] of [["ep-auth-setup", 201], ["ep-auth-login", 200], ["ep-auth-refresh", 200]])
	{
		const cookies = response(id, status).cookies;
		assert.deepEqual(cookies.map(({ name }) => name), ["refresh_token", "session_hint"]);
		const [refresh, hint] = cookies;
		assert.equal(refresh.httpOnly, true);
		assert.equal(refresh.path, "/api/auth");
		assert.equal(hint.httpOnly, false);
		assert.equal(hint.path, "/");
		for (const cookie of cookies)
		{
			assert.equal(cookie.secure, true);
			assert.equal(cookie.sameSite, "Strict");
			assert.equal(cookie.maxAge, "30d");
		}
		assert.match(hint.note, /Value=1/);
	}
});

test("refresh hashes opaque tokens, rotates state and revokes all sessions on reuse", () =>
{
	assert.deepEqual(endpoint("ep-auth-refresh").request.cookies, ["refresh_token"]);
	const security = text(endpoint("ep-auth-refresh").constraints.security);
	assert.match(security, /opaque 32-byte random values, not signed JWTs/);
	assert.match(security, /SHA-256/);
	assert.match(security, /Missing cookies fail before lookup; an empty string is hashed and looked up/);
	assert.match(security, /superseded = true.*new row inserted.*one transaction/);
	assert.match(security, /every refresh_tokens row and every sessions row sharing that user_id are revoked/);
	assert.equal(column("refresh_tokens", "token_hash").unique, true);
	assert.match(text(column("refresh_tokens", "token_hash").notes), /raw token never stored/);
});

test("initial session recovery uses a hint but in-session 401 retry does not recheck it", () =>
{
	const jwt = text(spec.AUTH_STRATEGIES.JWT);
	assert.match(jwt, /On initial load.*only if session_hint is present.*GET \/api\/users\/me/);
	assert.match(jwt, /No hint skips recovery/);
	assert.match(jwt, /In-session apiFetch retries a 401.*without checking the hint/);
	assert.match(jwt, /no timer-based refresh is implemented/);
	assert.match(jwt, /does not make tokens inaccessible to an active XSS payload/);
});

test("logout and rejected refresh clear server cookies without asserting successful revocation on network failure", () =>
{
	for (const [id, status] of [["ep-auth-logout", 204], ["ep-auth-logout", 401], ["ep-auth-refresh", 401]])
	{
		assert.deepEqual(response(id, status).clears, ["refresh_token", "session_hint"]);
	}
	for (const id of ["ep-auth-refresh", "ep-auth-logout"])
	{
		for (const status of [429, 500]) assert.equal(response(id, status).clears, undefined);
	}
	const security = text(endpoint("ep-auth-logout").constraints.security);
	assert.match(security, /every refresh_tokens row for that session/);
	assert.match(security, /AuthProvider\.signOut always clears.*in finally/);
	assert.match(security, /even when logout fails/);
});

test("session revocation clears only current-session cookies and documents delayed frontend cleanup", () =>
{
	const clears = response("ep-auth-sessions-revoke", 204).clears;
	assert.deepEqual(clears.map(({ name }) => name), ["refresh_token", "session_hint"]);
	for (const cookie of clears) assert.match(cookie.note, /only if revoking the caller's current session/);
	assert.match(clears[0].note, /Path=\/api\/auth, Max-Age=0/);
	assert.match(clears[1].note, /Path=\/, Max-Age=0/);
	const security = text(endpoint("ep-auth-sessions-revoke").constraints.security);
	assert.match(security, /all refresh tokens sharing session_id/);
	assert.match(security, /useSessions only invalidates the list/);
	assert.match(security, /AuthFilter does not consult session revocation/);
	assert.match(security, /list\/revoke do not catch service 401 to clear cookies/);
	assertFields(response("ep-auth-sessions-list", 200), ["sessions", "id", "user_agent", "ip_address", "last_used_at", "current"]);
});

test("JWT reloads current database identity by email without promising push-time reauthentication", () =>
{
	const jwt = text(spec.AUTH_STRATEGIES.JWT);
	assert.match(jwt, /every authenticated HTTP request/);
	assert.match(jwt, /Missing\/deleted user returns 401/);
	assert.match(jwt, /roles come from the current database row/);
	assert.match(jwt, /by email from the JWT subject/);
	assert.match(jwt, /changing email invalidates the old subject until refresh/);
	assert.match(jwt, /recreating the same email is a security-review gap/);
	assert.match(jwt, /authenticated at opening, not on every push/);
	assert.match(jwt, /Existing connections are not closed automatically/);
});

test("onboarding uses current admin routes, TLS steps and bare success links rather than planned safeguards", () =>
{
	assert.equal(page("page-setup").path, "/auth/setup");
	assert.equal(page("page-login").path, "/auth/login");
	const onboarding = page("page-onboarding");
	assert.equal(onboarding.path, "/service-onboarding");
	assert.match(onboarding.desc, /admin-only/);
	for (const id of ["ep-config-keys", "ep-config-tls-addresses", "ep-config-tls-ca", "ep-auth-refresh", "ep-users-me-get", "ep-auth-logout"])
	{
		assert.ok(onboarding.endpointIds.includes(id), id);
	}
	assert.ok(!onboarding.endpointIds.includes("ep-alerts-ws"));
	const requirements = text(onboarding.requirements);
	assert.match(requirements, /only at step 11/);
	assert.match(requirements, /any one signal is enough/);
	assert.match(requirements, /Streams stay open/);
	assert.match(requirements, /monitoring is not independent of key loading/);
	assert.match(requirements, /Current success links are bare/);
	assert.match(requirements, /not service-filtered links/);
	assert.match(requirements, /Planned hardening/);
	assert.match(requirements, /reconstructs the wizard from step 1/);
	assert.match(requirements, /retaining cached keys/);
	assert.equal(page("page-add-service").path, "/add-service");
	assert.ok(page("page-add-service").endpointIds.includes("ep-alerts-ws"));
	for (const signal of ["traces", "logs", "metrics"])
	{
		assert.ok(onboarding.endpointIds.includes(`ep-telemetry-${signal}-live`));
		assert.match(page(`page-${signal}`).desc, /service query initializes/i);
	}
});

test("live telemetry filters by service only, with JWT query auth and signal-specific filters", () =>
{
	for (const signal of ["traces", "logs", "metrics"])
	{
		const id = `ep-telemetry-${signal}-live`;
		const stream = endpoint(id);
		assert.equal(stream.method, "SSE");
		assert.deepEqual(stream.request.query.map(({ name }) => name), signal === "logs" ? ["service", "severity", "token"] : ["service", "token"]);
		assert.equal(parameter(id, "query", "service").required, false);
		assert.equal(parameter(id, "query", "token").required, true);
		assert.match(text(stream.constraints.security), /Query token is JWT-only/);
		assert.match(text(stream.constraints.security), /API keys require Authorization: ApiKey/);
		assert.match(text(stream.constraints.criteria), /no name parameter/);
		assert.match(text(stream.constraints.criteria), /empty-string filter, not a validation-400 path/);
		assert.match(text(stream.constraints.criteria), /no replay, heartbeat, event ID or Last-Event-ID/);
		assert.match(text(stream.constraints.criteria), /Dashboard live hooks instead close on errors/);
		assert.match(text(stream.constraints.criteria), /does not parse\/validate payloads/);
	}
	assert.match(response("ep-telemetry-metrics-live", "event"), /value: number \| null/);
});

test("onboarding configuration uses deployment ingestion credentials without claiming a completed key handoff", () =>
{
	const keys = endpoint("ep-config-keys");
	assert.equal(keys.requiredRole, "ADMIN");
	const criteria = text(keys.constraints.criteria);
	for (const variable of ["OTEL_SERVICE_NAME", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_PROTOCOL", "OTEL_EXPORTER_OTLP_HEADERS"])
	{
		assert.ok(criteria.includes(variable), variable);
	}
	assert.match(criteria, /embeds only ingestion_key/);
	assert.match(criteria, /no demo-key fallback/);
	assert.match(criteria, /\/otlp/);
	assert.match(criteria, /Bearer%20<ingestion_key>/);
	assert.match(criteria, /except for the recommended Go setup/);
	assert.match(criteria, /no Java writer publishes it to a shared Collector file/);
	assert.match(criteria, /Shared-file handoff remains planned/);
	assert.match(criteria, /Safe shell escaping.*follow-up work/);
	assert.match(text(keys.constraints.security), /does not set Cache-Control: no-store/);
});

test("TLS address configuration distinguishes verified success, pending state and sanitized failure", () =>
{
	const id = "ep-config-tls-addresses";
	assert.equal(endpoint(id).route, "/api/config/tls/addresses");
	assert.equal(endpoint(id).method, "POST");
	assert.equal(endpoint(id).requiredRole, "ADMIN");
	assert.deepEqual(endpoint(id).authStrategy, ["JWT", "API_KEY"]);
	assert.deepEqual(endpoint(id).request.body.map(({ name }) => name), ["address"]);
	assert.equal(parameter(id, "body", "address").required, true);
	assert.match(parameter(id, "body", "address").type, /512/);
	assert.match(response(id, 200), /status: 'verified'/);
	assert.equal(response(id, 409), response(id, 200));
	assert.match(response(id, 202), /status: 'pending'/);
	assert.match(response(id, 202), /retry_after_seconds: 3/);
	assert.doesNotMatch(response(id, 202), /tls_mode/);
	const criteria = text(endpoint(id).constraints.criteria);
	assert.match(criteria, /8-second transport deadline/);
	assert.match(criteria, /Cache-Control: no-store/);
	assert.match(criteria, /no automatic polling/);
	assert.match(criteria, /sets local mode client-side without calling this endpoint/);
	assert.match(response(id, 503), /^\{ message: /);
});

test("public CA download exposes certificates and no private key", () =>
{
	const id = "ep-config-tls-ca";
	assert.equal(endpoint(id).route, "/api/config/tls/ca");
	assert.equal(endpoint(id).method, "GET");
	assert.equal(endpoint(id).requiredRole, "ADMIN");
	assert.match(response(id, 200), /application\/x-pem-file/);
	assert.match(response(id, 200), /vigil-ca\.crt/);
	assert.match(response(id, 200), /Cache-Control: no-store/);
	assert.match(text(endpoint(id).constraints), /CA-only X\.509 PEM/);
	assert.match(text(endpoint(id).constraints), /64KiB/);
	assert.match(text(endpoint(id).constraints.security), /Does not return a private key/);
	assert.match(response(id, 503), /^\{ message: /);
});

test("settings are nested routes and absent full-page features remain explicitly planned", () =>
{
	for (const [id, path, used] of [
		["page-settings-account", "/settings/account", "ep-users-me"],
		["page-settings-sessions", "/settings/sessions", "ep-auth-sessions-revoke"],
		["page-settings-users", "/settings/users", "ep-users-list"],
		["page-settings-api-keys", "/settings/api-keys", "ep-config-keys"],
		["page-settings-webhooks", "/settings/webhooks", "ep-webhooks-list"],
	])
	{
		assert.equal(page(id).path, path);
		assert.ok(page(id).endpointIds.includes(used));
		assert.ok(page(id).endpointIds.includes("ep-auth-logout"));
	}
	assert.match(page("page-settings").desc, /index redirects to \/settings\/account/);
	assert.match(page("page-settings").desc, /Config import\/export is not implemented/);
	for (const id of ["page-ai", "page-status"]) assert.match(page(id).desc, /Planned only:/);
	assert.equal(page("page-ai").path, "/ai-insights");
	assert.ok(page("page-ai").endpointIds.includes("ep-alert-ask"));
	assert.ok(!page("page-ai").endpointIds.includes("ep-llm-analyze"));
	assert.equal(page("page-status").path, "/status");
	assert.deepEqual(page("page-status").endpointIds, []);
	assert.equal(page("page-static").path, "/legal#privacy + /legal#terms");
});

test("overview and metrics pages reference their actual data sources", () =>
{
	const overview = page("page-overview");
	for (const id of ["ep-alerts-list", "ep-alert-history-update", "ep-telemetry-logs", "ep-telemetry-traces", "ep-alert-ask"])
	{
		assert.ok(overview.endpointIds.includes(id), id);
	}
	assert.ok(!overview.endpointIds.includes("ep-telemetry-metrics"));
	assert.ok(!overview.endpointIds.includes("ep-llm-analyze"));
	assert.match(overview.desc, /client-generated PDF/);
	for (const id of ["ep-telemetry-metrics", "ep-telemetry-metrics-series", "ep-telemetry-metrics-live"])
	{
		assert.ok(page("page-metrics").endpointIds.includes(id), id);
	}
	assert.match(page("page-metrics").desc, /polls series every 60s/);
	assert.equal(page("page-alert-rules").path, "/alert-rules");
	assert.match(page("page-alert-rules").desc, /admin-only/);
	assert.equal(endpoint("ep-alert-rules-list").requiredRole, "ADMIN_/_VIEWER");
});

test("telemetry uses hasMore while alert pages retain has_more and fetch an additional row", () =>
{
	for (const [id, field, absent] of [
		["ep-telemetry-metrics", "hasMore", "has_more"],
		["ep-telemetry-traces", "hasMore", "has_more"],
		["ep-telemetry-logs", "hasMore", "has_more"],
		["ep-alerts-list", "has_more", "hasMore"],
		["ep-alert-rules-list", "has_more", "hasMore"],
		["ep-alert-notifications-list", "has_more", "hasMore"],
	])
	{
		assertFields(response(id, 200), [field], id);
		assert.doesNotMatch(response(id, 200), new RegExp(`\\b${absent}\\b`), id);
		assert.match(text(endpoint(id).constraints.criteria), /count\s*\+\s*1|additional row|extra row/i, id);
		assert.doesNotMatch(text(endpoint(id).constraints.criteria), /returned\.length === count/);
	}
});

test("raw telemetry count, cursor, sorted offsets and CSV are distinct contracts", () =>
{
	for (const signal of ["metrics", "traces", "logs"])
	{
		const id = `ep-telemetry-${signal}`;
		assert.match(parameter(id, "query", "count").type, /1-500.*default 50/);
		assert.equal(parameter(id, "query", "count").required, false);
		assert.match(parameter(id, "query", "before").type, /ISO8601/);
		assert.match(parameter(id, "query", "format").type, /json \| csv/);
		const criteria = text(endpoint(id).constraints.criteria);
		assert.match(criteria, /CSV|csv/);
		assert.match(criteria, /ignoring pagination and sort/);
		assert.match(criteria, /no Content-Disposition header/);
		assert.match(criteria, /same timestamp/);
		if (signal !== "metrics") assert.match(parameter(id, "query", "offset").type, /0-500.*non-default/);
	}
	assert.match(text(endpoint("ep-telemetry-logs").constraints.criteria), /validates both supplied before and offset/);
	assert.match(text(endpoint("ep-telemetry-traces").constraints.criteria), /Only the active pagination mode is service-validated/);
	assert.match(parameter("ep-telemetry-metrics", "query", "vigil.internal").type, /attributes\['internal'\]/);
});

test("raw metrics do not advertise the planned metric_name/interval/aggregation mode", () =>
{
	const raw = endpoint("ep-telemetry-metrics");
	assert.deepEqual(raw.request.query.map(({ name }) => name), ["period", "service", "count", "before", "vigil.internal", "format"]);
	assertFields(raw.response[200], ["service", "timestamp", "name", "value", "attributes", "hasMore"]);
	assert.match(raw.response[200], /value: number \| null/);
	assert.match(text(raw.constraints.criteria), /not implemented query parameters/);
	assert.match(text(raw.constraints.criteria), /separate \/api\/telemetry\/metrics\/series route/);
});

test("metric series require a period, use fixed intervals and expose kind/unit/internal metadata", () =>
{
	const id = "ep-telemetry-metrics-series";
	assert.equal(endpoint(id).route, "/api/telemetry/metrics/series");
	assert.equal(endpoint(id).method, "GET");
	assert.equal(endpoint(id).requiredRole, "ADMIN_/_VIEWER");
	assert.deepEqual(endpoint(id).request.query.map(({ name }) => name), ["period", "service", "vigil.internal"]);
	assert.equal(parameter(id, "query", "period").required, true);
	assert.equal(parameter(id, "query", "period").type, "1h | 24h | 7d | 30d");
	assertFields(response(id, 200), ["interval_seconds", "series", "name", "service", "unit", "kind", "internal", "points", "bucket", "value"]);
	assert.match(response(id, 200), /gauge \| counter \| histogram/);
	assert.match(response(id, 200), /value: number \| null/);
	assert.doesNotMatch(response(id, 200), /hasMore|has_more/);
	for (const interval of ["1h=60", "24h=1800", "7d=10800", "30d=43200"])
	{
		assert.ok(text(endpoint(id).constraints.criteria).includes(interval), interval);
	}
});

test("metric chart aggregation documents implemented math and reset/mixed-series limitations", () =>
{
	const criteria = text(endpoint("ep-telemetry-metrics-series").constraints.criteria);
	assert.match(criteria, /avg\(value\)/);
	assert.match(criteria, /monotonic sums use increases divided by the fixed bucket duration/);
	assert.match(criteria, /histogram-sum increases \/ summed count increases/);
	assert.match(criteria, /lag per series_id/);
	assert.match(criteria, /no pre-range baseline read/);
	assert.match(criteria, /start_timestamp reset handling/);
	assert.match(criteria, /mixed-unit\/type rejection/);
	assert.match(criteria, /unit\/kind\/internal use any\(\)/);
	assert.match(text(column("metrics", "start_timestamp").notes), /does not use it for reset detection/);
	assert.match(text(column("metrics", "series_id").notes), /not preserved in its final series identity/);
});

test("attributes enumerate map keys rather than a backend-validated metric-name directory", () =>
{
	const attributes = endpoint("ep-telemetry-attributes");
	assertFields(attributes.response[200], ["key", "values"]);
	assert.equal(attributes.requiredRole, "ADMIN_/_VIEWER");
	for (const signal of ["logs", "metrics", "traces"])
	{
		assert.equal(attributes.tables_actions[signal], "Read (last 7 days)");
	}
	const criteria = text(attributes.constraints.criteria);
	assert.match(criteria, /does not enumerate metrics\.name/);
	assert.match(criteria, /no attribute membership check is implemented/);
	assert.match(criteria, /Telemetry pages currently do not use this endpoint/);
	assert.match(text(endpoint("ep-alert-rules-create").constraints.criteria), /membership validation is TODO/);
	assert.match(text(column("alert_rules", "metric_name").notes), /TODO/);
});

test("rule creation preserves signal-specific validation and immutable signal_type on patch", () =>
{
	const create = endpoint("ep-alert-rules-create");
	assert.equal(create.method, "POST");
	assert.equal(create.requiredRole, "ADMIN");
	for (const name of ["service", "signal_type", "metric_name", "window_seconds", "threshold", "severity", "enabled"])
	{
		assert.equal(parameter(create.id, "body", name).required, true, name);
	}
	assert.match(parameter(create.id, "body", "service").type, /nonblank string/);
	assert.match(parameter(create.id, "body", "window_seconds").type, /minimum 10/);
	assert.match(parameter(create.id, "body", "metric_name").type, /error_count.*error_rate.*arbitrary nonblank metric name/);
	assert.match(parameter(create.id, "body", "aggregation").type, /latest.*p99.*required for metrics.*null\/omitted for logs\/traces/);
	assert.ok(!create.request.body.some(({ name }) => name === "is_default"));
	assert.doesNotMatch(create.response[201], /is_default/);
	const update = endpoint("ep-alert-rules-update");
	assert.ok(update.request.body.every(({ required }) => required === false));
	assert.ok(!update.request.body.some(({ name }) => name === "signal_type"));
	assert.match(text(update.constraints.criteria), /unknown fields return 400/);
	assert.doesNotMatch(update.response[200], /is_default/);
	assert.match(text(endpoint("ep-alert-rules-delete").constraints), /preserves history/);
});

test("shared history PATCH is a required status query and is not the full GET response", () =>
{
	const update = endpoint("ep-alert-history-update");
	assert.equal(update.route, "/api/alerts/history/{id}");
	assert.equal(update.method, "PATCH");
	assert.deepEqual(update.request.query.map(({ name }) => name), ["status"]);
	assert.equal(parameter(update.id, "query", "status").required, true);
	assert.equal(parameter(update.id, "query", "status").type, "sent | acknowledged | resolved");
	assert.equal(update.request.body, null);
	assert.doesNotMatch(shape(update.request), /version/);
	assertFields(update.response[200], ["id", "rule", "status", "acked_at", "acked_by", "resolved_at", "resolved_by"]);
	assert.doesNotMatch(update.response[200], /\b(?:owner_id|rule_id|version|is_default)\b/);
	assertFields(response("ep-alerts-list", 200), ["owner_id", "rule_id", "version"]);
	assert.match(text(update.constraints), /@Version optimistic locking/);
	assert.equal(response(update.id, 409), "{ message: 'resource is being used by another user' }");
});

test("REST and socket history actions preserve ownership and historical actor semantics", () =>
{
	for (const id of ["ep-alert-history-update", "ep-alerts-ws"])
	{
		const criteria = text(endpoint(id).constraints.criteria);
		assert.match(criteria, /Acknowledging unowned history claims the caller/i, id);
		assert.match(criteria, /re-acknowledging by the owner resets acked_at/, id);
		assert.match(criteria, /no admin bypass/, id);
		assert.match(criteria, /Unowned history can be resolved directly/, id);
		assert.match(criteria, /Returning to sent clears owner and all action timestamps\/emails/, id);
		assert.match(criteria, /Actor emails are snapshots, not read-time joins/, id);
		assert.match(criteria, /deleting an owner sets the user reference null without deleting history or actor snapshots/, id);
		assert.match(criteria, /before commit; failed commits can already have emitted frames/, id);
		assert.match(criteria, /After-commit delivery remains planned/, id);
	}
	for (const name of ["acked_by", "resolved_by"])
	{
		assert.equal(column("alert_history", name).type, "VARCHAR(255)");
		assert.equal(column("alert_history", name).fk, undefined);
		assert.match(text(column("alert_history", name).notes), /snapshot retained on deletion\/email change/);
	}
});

test("WebSocket trigger snapshots, status deltas, personal Notification and llm frames stay distinct", () =>
{
	const socket = endpoint("ep-alerts-ws");
	assert.deepEqual(socket.authStrategy, ["WS_AUTH_HANDSHAKE"]);
	assert.equal(parameter(socket.id, "query", "token").required, true);
	for (const status of ["acknowledged", "resolved", "sent"]) assert.ok(socket.request.ack.includes(status));
	assertFields(socket.request.notif, ["alert_id", "seen"]);
	assertFields(socket.response.alert, ["alert_history_id", "rule_id", "owner_id", "version", "metric_name"]);
	assertFields(socket.response.alertUpdate, ["alert_history_id", "status", "acked_at", "acked_by", "resolved_at", "resolved_by"]);
	assert.doesNotMatch(socket.response.alertUpdate, /\b(?:owner_id|rule_id|version|service|metric_name)\b/);
	assert.match(socket.response.alertUpdate, /type: 'alert'/);
	assert.match(socket.response.Notification, /type: 'Notification'/);
	assertFields(socket.response.Notification, ["alert_history_id", "metric_name", "seen", "seen_at"]);
	assertFields(socket.response.llm, ["id", "llm_analysis"]);
	assert.equal(socket.response.status, undefined);
	assert.doesNotMatch(text(socket.response), /type: 'status'/);
	assert.match(socket.constraints.fallback, /No replay/);
	assert.match(text(socket.constraints.criteria), /socket error, not a structured status code/);
});

test("recipient notification list and seen updates remain caller-scoped with current wire identifiers", () =>
{
	const list = endpoint("ep-alert-notifications-list");
	assert.equal(list.route, "/api/alerts/notifications");
	assert.equal(list.method, "GET");
	assert.deepEqual(list.request.query.map(({ name }) => name), ["count", "before"]);
	assert.match(parameter(list.id, "query", "count").type, /1-100.*default 20/);
	assertFields(list.response[200], ["notifications", "alert_history_id", "metric_name", "seen", "seen_at", "has_more"]);
	assert.match(text(list.constraints.criteria), /Only the caller's notifications/);
	assert.match(text(list.constraints.criteria), /Shared status\/ownership does not hide notifications/);
	assert.equal(list.tables_actions.alert_notifications, "Read (caller only)");
	const update = endpoint("ep-alert-notification-update");
	assert.equal(update.method, "PUT");
	assert.equal(update.route, "/api/alerts/notifications/{historyId}");
	assert.deepEqual(update.request.query.map(({ name }) => name), ["seen"]);
	assert.equal(parameter(update.id, "query", "seen").required, true);
	assert.match(parameter(update.id, "query", "seen").type, /boolean/);
	assert.equal(update.request.body, null);
	assertFields(update.response[200], ["alert_id", "seen", "seen_at"]);
	assert.doesNotMatch(update.response[200], /alert_history_id/);
	assert.equal(update.tables_actions.alert_notifications, "Read + Insert/Update (caller only)");
});

test("notification sequential idempotence is not a concurrent atomic-upsert guarantee", () =>
{
	for (const id of ["ep-alert-notification-update", "ep-alerts-ws"])
	{
		const criteria = text(endpoint(id).constraints.criteria);
		assert.match(criteria, /keyed by \(user_id, alert_history_id\)/, id);
		assert.match(criteria, /Resolve user from authentication/, id);
		assert.match(criteria, /nonexistent history returns 404/, id);
		assert.match(criteria, /seen=true preserves the original seen_at on sequential repeats/, id);
		assert.match(criteria, /seen=false clears seen_at/, id);
		assert.match(criteria, /not an atomic database upsert/, id);
		assert.match(criteria, /Concurrent creation can conflict/, id);
		assert.match(criteria, /only to that recipient's connected sessions/, id);
		assert.match(criteria, /not an after-commit hook/, id);
	}
	assert.equal(response("ep-alert-notification-update", 409), "{ message: 'resource already exists' }");
});

test("schema keeps logical recipient-table references while documenting physical naming and ownership aliases", () =>
{
	assert.equal(spec.SCHEMA.alert_acks, undefined);
	assert.equal(spec.SCHEMA.alert_notification, undefined);
	const notifications = spec.SCHEMA.alert_notifications;
	assert.match(notifications.notes, /physical alert_notification \(singular\), not alert_notifications/);
	assert.deepEqual(notifications.columns.filter(({ pk }) => pk).map(({ name }) => name).sort(), ["alert_history_id", "user_id"]);
	for (const [name, table] of [["user_id", "users"], ["alert_history_id", "alert_history"]])
	{
		assert.deepEqual(column("alert_notifications", name).fk, { table, column: "id", onDelete: "CASCADE" });
	}
	assertFields(shape(notifications.columns), ["seen", "seen_at"]);
	assert.ok(!spec.SCHEMA.alert_history.columns.some(({ name }) => name === "owner_id"));
	assert.deepEqual(column("alert_history", "user_id").fk, { table: "users", column: "id", onDelete: "SET NULL" });
	assert.equal(column("alert_history", "user_id").nullable, true);
	assert.match(text(column("alert_history", "user_id").notes), /exposed as owner_id by the API/);
	assert.deepEqual(column("alert_history", "rule_id").fk, { table: "alert_rules", column: "id", onDelete: "SET NULL" });
});

test("PostgreSQL schema describes Hibernate mappings rather than invented SQL defaults and types", () =>
{
	for (const table of ["users", "sessions", "refresh_tokens", "alert_rules", "alert_history", "webhooks"])
	{
		assert.equal(column(table, "id").type, "UUID");
		assert.match(text(column(table, "id").notes), /Hibernate-generated UUID/);
	}
	assert.equal(column("users", "email").type, "VARCHAR(255)");
	assert.equal(column("users", "email").unique, true);
	assert.match(text(column("users", "role").notes), /ADMIN \| VIEWER.*admin \| viewer/);
	assert.equal(column("webhooks", "url").type, "VARCHAR(255)");
	assert.equal(column("webhooks", "url").unique, true);
	for (const table of ["alert_rules", "alert_history"]) assert.equal(column(table, "threshold").type, "DOUBLE PRECISION");
	assert.equal(column("alert_history", "threshold").nullable, true);
	assert.equal(column("alert_history", "llm_analysis").type, "TEXT");
	assert.equal(column("alert_history", "version").type, "BIGINT");
	assert.match(text(column("alert_history", "version").notes), /no SQL DEFAULT 0/);
	assert.match(text(column("alert_history", "version").notes), /LLM analysis update explicitly increments version/);
	assert.match(spec.SCHEMA.alert_history.notes, /ddl-auto=update is not a versioned migration strategy/);
});

test("session and refresh-token physical foreign keys cascade without persisting raw credentials", () =>
{
	for (const table of ["sessions", "refresh_tokens"])
	{
		assert.deepEqual(column(table, "user_id").fk, { table: "users", column: "id", onDelete: "CASCADE" });
	}
	assert.deepEqual(column("refresh_tokens", "session_id").fk, { table: "sessions", column: "id", onDelete: "CASCADE" });
	assert.ok(!spec.SCHEMA.refresh_tokens.columns.some(({ name }) => name === "refresh_token" || name === "token"));
	assert.equal(column("refresh_tokens", "token_hash").type, "VARCHAR(255)");
	assert.equal(column("sessions", "user_agent").nullable, true);
	assert.equal(column("sessions", "ip_address").nullable, true);
	assert.match(spec.SCHEMA.sessions.notes, /No session cleanup scheduler/);
});

test("ClickHouse storage metadata is richer than raw DTOs without claiming full OTLP fidelity", () =>
{
	assert.ok(!spec.SCHEMA.logs.columns.some(({ name }) => name === "trace_id"));
	assert.match(text(column("logs", "attributes").notes), /No dedicated log trace_id column/);
	assert.match(text(column("logs", "attributes").notes), /intrinsic TraceID/);
	assert.equal(column("metrics", "value").type, "Nullable(Float64)");
	assert.equal(column("metrics", "value").nullable, true);
	for (const name of ["metric_type", "unit", "aggregation_temporality", "is_monotonic", "start_timestamp", "series_id", "histogram_sum", "histogram_count"])
	{
		column("metrics", name);
		assert.doesNotMatch(response("ep-telemetry-metrics", 200), new RegExp(`\\b${name}\\b`), name);
	}
	assert.match(text(column("metrics", "metric_type").notes), /unsupported OTLP types reject the incoming batch/);
	assert.match(spec.SCHEMA.metrics.notes, /histogram bucket distributions\/exemplars are not persisted/);
	assert.equal(column("traces", "duration_ms").type, "UInt32");
	assert.equal(column("traces", "parent_span_id").type, "Nullable(String)");
	assert.equal(column("traces", "parent_span_id").nullable, true);
	assert.match(text(column("traces", "status").notes), /unset \| ok \| error/);
	for (const table of ["logs", "metrics", "traces"])
	{
		assert.equal(column(table, "timestamp").type, "DateTime64(3, 'UTC')");
		assert.equal(column(table, "attributes").type, "Map(String, String)");
	}
});

test("one unversioned metadata callback replaces signal-specific ingest controllers", () =>
{
	const callbacks = spec.INTERNAL_ENDPOINTS.filter(({ group }) => group === "Alert Telemetry Evaluation");
	assert.equal(callbacks.length, 1);
	const [callback] = callbacks;
	assert.equal(callback.id, "ep-alerts-trigger-evaluation");
	assert.equal(callback.route, "/internal/alerts/trigger-evaluation");
	assert.equal(callback.method, "POST");
	assert.equal(callback.internal, true);
	assert.deepEqual(callback.authStrategy, ["INTERNAL_ONLY"]);
	assert.deepEqual(Object.keys(callback.request.body), ["notification_id", "signal_type", "stored_at", "services"]);
	assert.deepEqual(Object.keys(callback.request.body.services[0]), ["service", "latest_timestamp"]);
	assert.equal(callback.request.body.signal_type, "logs | metrics | traces");
	assert.match(callback.response[204], /synchronous evaluation and alert persistence/);
	assert.equal(callback.response[202], undefined);
	assert.equal(callback.response[409], undefined);
	assert.match(callback.response[404], /Empty response.*8081/);
	assert.match(callback.response[500], /Empty response/);
	for (const table of ["logs", "metrics", "traces"]) assert.equal(callback.tables_actions[table], "Read");
	assert.ok(!spec.ENDPOINTS.some(({ route }) => route.startsWith("/internal/ingest")));
	// A documented legacy filter exemption is not a mounted controller.
	assert.match(text(spec.RATE_LIMITING_INFO), /legacy \/internal\/ingest prefix exemption, but no such controller exists/);
});

test("evaluation persists alerts synchronously but early SSE/watchdog effects are not transactional", () =>
{
	const callback = endpoint("ep-alerts-trigger-evaluation");
	assert.ok(spec.SCHEMA.alert_notifications);
	assert.equal(callback.tables_actions.alert_notifications, "Insert (recipient rows on trigger)");
	assert.equal(spec.SCHEMA.evaluation_notifications, undefined);
	assert.ok(!callback.tables.includes("evaluation_notifications"));
	const criteria = text(callback.constraints.criteria);
	assert.match(criteria, /Implemented synchronous order/);
	assert.match(criteria, /SSE broadcast.*watchdog timers.*query\/evaluate.*one PostgreSQL transaction/);
	assert.match(criteria, /Return 204 after this work/);
	assert.match(criteria, /No callback-metadata table, evaluation queue or processing status is persisted/);
	assert.match(criteria, /SSE\/watchdog effects precede evaluation and are not rolled back/);
	assert.match(criteria, /seen=false and seen_at=null in the same transaction/);
	assert.match(criteria, /Only after commit initiate best-effort external delivery/);
	assert.match(callback.constraints.fallback, /returns an empty 500/);
});

test("open-alert suppression is distinct from notification-ID callback idempotency", () =>
{
	const criteria = text(endpoint("ep-alerts-trigger-evaluation").constraints.criteria);
	assert.match(criteria, /aggregate >= threshold only if no existing history for that rule has status sent or acknowledged/);
	assert.match(criteria, /synchronized per instance/);
	assert.match(criteria, /no notification_id idempotency store/);
	assert.match(criteria, /resolved prior alert, multiple instances or other races can still retrigger/i);
	assert.match(criteria, /full window history, not only notification_id rows/);
	assert.match(criteria, /last_seen = max\(stored_at\)/);
	assert.match(criteria, /Timer\/fired\/last_seen state is lost on restart/);
	assert.match(criteria, /service_silent/);
	assert.match(text(spec.SCHEMA.alert_rules.notes), /not callback-ID deduplication/);
});

test("live telemetry and rule-schema references resolve to the unified callback", () =>
{
	const callback = endpoint("ep-alerts-trigger-evaluation");
	for (const signal of ["logs", "metrics", "traces"])
	{
		const stream = endpoint(`ep-telemetry-${signal}-live`);
		assert.deepEqual(stream.constraints.realtime.refs, [callback.id]);
		assert.match(stream.constraints.realtime.text, /vigil\.notification_id/);
		assert.match(stream.constraints.realtime.text, /independently of alert evaluation/);
		assert.ok(callback.constraints.realtime.refs.includes(stream.id));
	}
	assert.ok(column("alert_rules", "signal_type").notes.refs.includes(callback.id));
});

test("callback retry and visibility recovery are bounded and volatile rather than durable replay", () =>
{
	const architecture = text(ARCHITECTURE_SECTIONS);
	for (const value of [architecture, text(endpoint("ep-alerts-trigger-evaluation").constraints.criteria)])
	{
		assert.match(value, /10-second timeout/);
		assert.match(value, /3 attempts total/);
		assert.match(value, /1 second and then 2 seconds/);
		assert.match(value, /do not retry 4xx/i);
		assert.match(value, /(?:in memory only|only in memory)/);
		assert.match(value, /retryable whole-export failure/);
	}
	assert.match(architecture, /only 204 succeeds/);
	assert.match(architecture, /SELECT count\(\)/);
	assert.match(architecture, /no autonomous recovery worker/);
	assert.match(architecture, /does not guarantee|do not guarantee/);
});

test("public alert ask accepts only a bounded question and uses trusted telemetry context", () =>
{
	const ask = endpoint("ep-alert-ask");
	assert.equal(ask.route, "/api/alerts/{id}/ask");
	assert.equal(ask.method, "POST");
	assert.equal(ask.requiredRole, "ADMIN_/_VIEWER");
	assert.deepEqual(ask.authStrategy, ["JWT", "API_KEY"]);
	assert.deepEqual(ask.request.query, []);
	assert.deepEqual(ask.request.body.map(({ name }) => name), ["question"]);
	assert.equal(parameter(ask.id, "body", "question").required, true);
	assert.match(parameter(ask.id, "body", "question").type, /nonblank.*500/);
	for (const table of ["alert_history", "logs", "metrics", "traces"])
	{
		assert.ok(ask.tables.includes(table));
		assert.match(ask.tables_actions[table], /^Read/);
	}
	const criteria = text(ask.constraints.criteria);
	assert.match(criteria, /No client-supplied context or user ID is accepted/);
	assert.match(criteria, /X-Vigil-User-Id from authentication/);
	assert.match(criteria, /previous_analysis \(up to 5000 characters\)/);
	assert.match(criteria, /silence timeout when the rule window is null/);
	assert.match(criteria, /sends \{ question, history \}.*Jackson rejects unknown properties/);
	assert.match(criteria, /Follow-up answers are not saved/);
});

test("public and internal ask use named SSE events with empty done data and post-open errors", () =>
{
	for (const id of ["ep-alert-ask", "ep-fastapi-ask", "ep-fastapi-analyze"])
	{
		assert.equal(response(id, "token"), "event: token; data: { token: '<text>' }");
		assert.equal(response(id, "done"), "event: done; data: {}");
		assert.match(response(id, "error"), /event: error; data: \{ message: 'Analysis unavailable' \}/);
		assert.doesNotMatch(response(id, "done"), /done: true/);
	}
	const ask = endpoint("ep-alert-ask");
	assert.equal(ask.response[503], undefined);
	assert.match(ask.response.error, /status: <upstream HTTP status>/);
	assert.match(text(ask.constraints.criteria), /SSE over an authenticated POST.*not native EventSource/);
	assert.match(text(ask.constraints.criteria), /after opening are error events, not a replacement HTTP 503/);
	assert.match(ask.constraints.rateLimit, /upstream 429 is relayed as an SSE error with status=429/);
});

test("FastAPI forward and ask are separate private inference contracts with independent limits", () =>
{
	const forward = endpoint("ep-fastapi-analyze");
	const ask = endpoint("ep-fastapi-ask");
	assert.equal(forward.route, "/internal/llm/forward");
	assert.equal(ask.route, "/internal/llm/ask");
	for (const entry of [forward, ask])
	{
		assert.equal(entry.internal, true);
		assert.equal(entry.method, "POST");
		assert.deepEqual(entry.authStrategy, ["INTERNAL_ONLY"]);
		assert.deepEqual(entry.tables, []);
		assertFields(entry.request.body, ["alert_id", "service", "triggered_at", "rule", "context", "logs", "metrics", "traces"]);
		assert.match(entry.constraints.fallback, /25s/);
		assert.match(entry.constraints.fallback, /30s/);
	}
	assertFields(ask.request.body, ["question", "previous_analysis"]);
	assert.match(ask.request.body, /X-Vigil-User-Id/);
	assert.match(text(ask.constraints.criteria), /forbids unknown top-level fields/);
	assert.match(text(forward.constraints.criteria), /unknown fields are ignored/);
	assert.match(ask.constraints.rateLimit, /5\/min.*fixed window/);
	assert.match(ask.constraints.rateLimit, /concurrency=1.*queue wait=0.5s/);
	assert.match(text(ask.constraints.security), /not a service authentication credential/);
	assert.match(text(forward.constraints.criteria), /not a Spring internal-port controller/);
});

test("the general conversation API remains a roadmap entry, not an implemented controller", () =>
{
	const planned = endpoint("ep-llm-analyze");
	assert.equal(planned.route, "/api/llm/analyze");
	assert.match(planned.service, /Planned.*not implemented/);
	assert.deepEqual(Object.keys(planned.response), ["planned"]);
	assert.deepEqual(planned.tables, []);
	assert.equal(planned.constraints.rateLimit, "Not implemented");
	assert.ok(!PAGES.some(({ endpointIds }) => endpointIds.includes(planned.id)));
});

test("account DTOs distinguish create validation from optional self-update fields", () =>
{
	const create = endpoint("ep-users-create");
	assert.equal(create.requiredRole, "ADMIN");
	for (const name of ["email", "password", "role"]) assert.equal(parameter(create.id, "body", name).required, true);
	assert.equal(parameter(create.id, "body", "role").type, "admin | viewer");
	assert.match(text(create.constraints.criteria), /Create uses @NotBlank and @Email/);
	assert.match(text(create.constraints.criteria), /update\/self-update use @Email without @NotBlank/);
	assert.match(text(create.constraints.criteria), /at least 8 characters/);
	const self = endpoint("ep-users-me");
	assert.equal(self.route, "/api/users/me");
	assert.equal(self.method, "PATCH");
	assert.equal(self.requiredRole, "ADMIN_/_VIEWER");
	assert.deepEqual(self.request.body.map(({ name }) => name), ["email", "password"]);
	assert.ok(self.request.body.every(({ required }) => required === false));
	assert.match(text(self.constraints.criteria), /empty PATCH \{\} is accepted as a no-op/);
	assert.match(text(self.constraints.security), /No current-password confirmation, session revocation or token reissue/);
	assert.match(text(self.constraints.security), /email changes require refresh/);
	assert.equal(endpoint("ep-users-me-get").requiredRole, "ADMIN_/_VIEWER");
	assertFields(response("ep-users-me-get", 200), ["id", "email", "role"]);
});

test("user directory and last-admin safeguards include the API account without promising concurrency safety", () =>
{
	const directory = endpoint("ep-users-list");
	assert.equal(directory.requiredRole, "ADMIN");
	assert.deepEqual(directory.request.query, []);
	assert.match(text(directory.constraints.criteria), /unpaginated.*mustbe@api\.email/);
	const deletion = endpoint("ep-users-delete");
	assert.equal(deletion.requiredRole, "ADMIN");
	assert.equal(response(deletion.id, 204), "Empty response");
	const criteria = text(deletion.constraints.criteria);
	assert.match(criteria, /count all admin rows, including the API-key backing user/);
	assert.match(criteria, /not serialized or protected by explicit locking/);
	assert.match(criteria, /no cookie-clearing headers/);
	assert.match(criteria, /no explicit immediate self-deletion logout path/);
	assert.equal(deletion.tables_actions.sessions, "Cascade Delete");
	assert.equal(deletion.tables_actions.refresh_tokens, "Cascade Delete");
	assert.match(deletion.tables_actions.alert_history, /retain history and actor emails/);
	assert.match(deletion.tables_actions.alert_notifications, /Cascade Delete/);
});

test("internal callback protection is a local-port check, not a separate filter-free application", () =>
{
	const strategy = text(spec.AUTH_STRATEGIES.INTERNAL_ONLY);
	assert.match(strategy, /connector 8081/);
	assert.match(strategy, /same servlet application\/filter chain/);
	assert.match(strategy, /not a separate filter-free server/);
	assert.match(strategy, /Only the POST callback is explicitly permitAll and rate-limit-exempt/);
	assert.match(strategy, /FastAPI.*separate LLM service, not the Spring 8081 connector/);
	assert.match(strategy, /does not restrict every public controller/);
});

test("webhook targets are revalidated and delivery logs failures without promising retries", () =>
{
	const webhook = endpoint("ep-webhooks-create");
	assert.equal(webhook.requiredRole, "ADMIN");
	assert.deepEqual(webhook.request.body.map(({ name }) => name), ["url"]);
	assert.match(text(webhook.constraints.criteria), /requires HTTPS.*no embedded credentials or fragment/);
	assert.match(text(webhook.constraints.security), /before registration.*revalidates immediately before every send/);
	assert.match(text(webhook.constraints.security), /DNS is not pinned/);
	assert.match(webhook.constraints.fallback, /5s connect and read timeouts/);
	assert.match(webhook.constraints.fallback, /Failures\/non-2xx responses are logged/);
	assert.match(webhook.constraints.fallback, /No retry\/backoff\/dead-letter/);
	assert.match(text(webhook.constraints.criteria), /state is always 'alerting'/);
	assert.match(text(webhook.constraints.criteria), /manual resolution\/reopening does not send a webhook/);
	assert.match(text(webhook.constraints.criteria), /\/alerts\?id=<uuid>.*\?alert=<uuid>/);
	assert.match(page("page-alerts").desc, /\?alert=<uuid>/);
});

test("page, endpoint, auth and schema links retain valid logical targets", () =>
{
	const ids = new Set(spec.ENDPOINTS.map(({ id }) => id));
	assert.equal(new Set(PAGES.map(({ id }) => id)).size, PAGES.length);
	for (const entry of PAGES)
	{
		assert.equal(new Set(entry.endpointIds).size, entry.endpointIds.length, entry.id);
		for (const id of entry.endpointIds) assert.ok(ids.has(id), `${entry.id}: missing endpoint ${id}`);
	}
	for (const entry of spec.ENDPOINTS)
	{
		for (const table of entry.tables) assert.ok(spec.SCHEMA[table], `${entry.id}: missing logical table ${table}`);
		for (const table of Object.keys(entry.tables_actions)) assert.ok(entry.tables.includes(table), `${entry.id}: unlisted table action ${table}`);
		for (const strategy of entry.authStrategy) assert.ok(spec.AUTH_STRATEGIES[strategy], `${entry.id}: missing auth strategy ${strategy}`);
	}
	assertEndpointRefs(spec);
});

test("reference validation supports field-target objects and rejects stale endpoint IDs", () =>
{
	assert.doesNotThrow(() => assertEndpointRefs({ refs: [{ id: "ep-alerts-list", field: "response[200]" }] }));
	assert.doesNotThrow(() => assertEndpointRefs({ refs: ["ep-alerts-list"] }));
	assert.throws(() => assertEndpointRefs({ refs: ["ep-missing-contract"] }), /missing endpoint ep-missing-contract/);
	assert.throws(() => assertEndpointRefs({ refs: [{}] }), /missing reference ID/);
});

test("callback services render as formatted JSON rather than object children", () =>
{
	const services = endpoint("ep-alerts-trigger-evaluation").request.body.services;
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
	for (const entry of spec.ENDPOINTS)
	{
		for (const value of [entry.request?.body, ...Object.values(entry.response ?? {})])
		{
			assert.doesNotThrow(() => renderToStaticMarkup(createElement("pre", null, formatShape(value))), entry.id);
		}
	}
});

test("shape formatter preserves shorthand and nested string contracts", () =>
{
	assert.equal(formatShape("  Empty response  "), "Empty response");
	assert.equal(formatShape("{ id, status: ok | error }"), "{\n\tid,\n\tstatus: ok | error\n}");
	assert.equal(formatShape("{ context: { logs: [] }, optional?: null }"), "{\n\tcontext: {\n\t\tlogs: []\n\t},\n\toptional?: null\n}");
});

test("JSON export preserves audited endpoints, pages, schema and architecture without mutating source objects", () =>
{
	const root = fileURLToPath(new URL("../", import.meta.url));
	const outDir = mkdtempSync(join(root, ".architecture-export-test-"));
	const before = JSON.stringify({ endpoints: spec.ENDPOINTS, pages: PAGES, schema: spec.SCHEMA, architecture: ARCHITECTURE_SECTIONS });
	try
	{
		execFileSync(process.execPath, ["scripts/export-json.mjs", outDir], { cwd: root, timeout: 15000 });
		const read = (name) => JSON.parse(readFileSync(join(outDir, name), "utf8"));
		const unstamped = ({ lastUpdated, ...value }) =>
		{
			assert.ok(Number.isFinite(Date.parse(lastUpdated)));
			return value;
		};
		const architecture = read("Architecture.json");
		assert.deepEqual(architecture.map(unstamped), ARCHITECTURE_SECTIONS);
		assert.deepEqual(read("FullSpec.json").Architecture, architecture);
		assert.deepEqual(read("Backend.json").Architecture, architecture);
		assert.equal(read("Frontend.json").Architecture, undefined);
		assert.ok(!Object.keys(read("Security.json")).some((key) => /architecture/i.test(key)));
		assert.deepEqual(read("Pages.json").map(unstamped), PAGES);
		assert.deepEqual(Object.fromEntries(Object.entries(read("Schema.json")).map(([key, value]) => [key, unstamped(value)])), spec.SCHEMA);
		const exported = Object.values(read("Endpoints.json")).flat().map(unstamped);
		assert.equal(exported.length, spec.ENDPOINTS.length);
		for (const entry of exported) assert.deepEqual(entry, endpoint(entry.id), entry.id);
		const delivery = architecture.find(({ id }) => id === "delivery");
		assert.match(delivery.diagram, /^flowchart TD/);
		assert.match(delivery.diagram, /Custom Collector exporter/);
		assert.match(delivery.diagram, /Return 204 No Content/);
		assert.strictEqual(spec.ARCHITECTURE_SECTIONS, ARCHITECTURE_SECTIONS);
		assert.equal(JSON.stringify({ endpoints: spec.ENDPOINTS, pages: PAGES, schema: spec.SCHEMA, architecture: ARCHITECTURE_SECTIONS }), before);
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

test("data index exposes the shared audited architecture diagram", () =>
{
	const delivery = ARCHITECTURE_SECTIONS.find(({ id }) => id === "delivery");
	assert.equal(spec.ARCHITECTURE_DELIVERY_DIAGRAM, delivery.diagram);
	assert.equal(typeof spec.ARCHITECTURE_DELIVERY_DIAGRAM, "string");
	assert.match(delivery.diagram, /no open alert for rule/);
});

test("architecture separates active Vault-rendered ingestion config from the image fallback", () =>
{
	const architecture = text(ARCHITECTURE_SECTIONS);
	assert.match(architecture, /not a verified running installation/);
	assert.match(architecture, /--config \/run\/secrets\/collector-config\.yaml/);
	assert.match(architecture, /bearertokenauth reading the ingestion-key file/);
	assert.match(architecture, /runtime\/config\.yaml is not the Compose runtime configuration/);
	assert.match(architecture, /targets 1,000 items.*5 seconds.*5,000 items/);
	assert.match(architecture, /384 MiB with a 96 MiB spike/);
	assert.match(architecture, /no.*persistent queue/i);
});

test("retention and storage layout are implemented without inventing backup or migration guarantees", () =>
{
	for (const [table, order] of [["logs", "service, timestamp"], ["metrics", "service, name, timestamp"], ["traces", "service, timestamp, trace_id, span_id"]])
	{
		const notes = spec.SCHEMA[table].notes;
		assert.ok(notes.includes(`ORDER BY (${order})`));
		assert.match(notes, /PARTITION BY toYYYYMM\(timestamp\)/);
		assert.match(notes, /TTL timestamp \+ INTERVAL 30 DAY DELETE/);
		assert.match(notes, /Synchronous inserts/);
		assert.match(notes, /TTL cleanup is asynchronous/);
		assert.match(notes, /CREATE TABLE IF NOT EXISTS/);
	}
	assert.match(spec.SCHEMA.alert_history.notes, /No automatic expiry or backup job/);
	const architecture = text(ARCHITECTURE_SECTIONS);
	assert.match(architecture, /No Flyway\/Liquibase dependency/);
	assert.match(architecture, /Daily encrypted off-host backups.*not established/);
	assert.match(architecture, /maximum of 10 connections.*not an explicitly tuned host budget/);
	assert.match(architecture, /No enforced.*measured p95 callback latency target/);
});

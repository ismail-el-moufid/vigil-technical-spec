import assert from "node:assert/strict";
import test from "node:test";
import * as spec from "../src/data/index.js";

function response(id, status, endpoints = spec.ENDPOINTS)
{
	const endpoint = endpoints.find((entry) => entry.id === id);
	assert.ok(endpoint, `Missing endpoint: ${id}`);
	return endpoint.response[status];
}

function envelope(status, path, error, code)
{
	const codeField = code === undefined ? "" : `, code: '${code}'`;
	return `{ timestamp: '<iso8601>', status: ${status}, path: '${path}', error: ${error}${codeField} }`;
}

for (const { id, route, status, alternatives } of [
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
		const expected = alternatives.map(([message, code]) =>
			envelope(status, route, `{ message: '${message}' }`, code)).join(" | ");
		assert.equal(response(id, status), expected);
	});
}

test("path-only validation errors name the id field", () =>
{
	for (const [id, route] of [
		["ep-auth-sessions-revoke", "/api/auth/sessions/{id}"],
		["ep-users-delete", "/api/users/{id}"],
		["ep-alert-rules-delete", "/api/alerts/rules/{id}"],
	])
	{
		assert.equal(response(id, 400), envelope(400, route, "{ id: '<validation message>' }"));
	}
});

test("GET /api/setup declares a contextual rate-limit response", () =>
{
	assert.equal(response("ep-setup-status", 429),
		envelope(429, "/api/setup", "{ message: 'rate limited' }"));
});

const sourceEndpoints = Object.entries(spec)
	.filter(([name]) => name.endsWith("_ENDPOINTS"))
	.flatMap(([, endpoints]) => endpoints);

test("already-contextual envelopes are unchanged", () =>
{
	let checked = 0;
	for (const endpoint of sourceEndpoints)
	{
		for (const [status, value] of Object.entries(endpoint.response ?? {}))
		{
			if (typeof value === "string" && value.startsWith("{ timestamp:"))
			{
				assert.equal(response(endpoint.id, status), value, `${endpoint.id}: ${status}`);
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
	const suffix = " — branch on code; { error: 'example only' } is explanatory text.";
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
			name: "deduplicates body/query/path fields and preserves validation alternatives",
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
			expected: [
				envelope(400, route, "{ id: 'invalid input', email: 'invalid input', scope: 'invalid input', parent_id: 'invalid input' }", "INVALID_INPUT"),
				envelope(400, route, "{ id: 'missing input', email: 'missing input', scope: 'missing input', parent_id: 'missing input' }", "MISSING_INPUT"),
			].join(" | "),
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

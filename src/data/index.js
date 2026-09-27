// ─── BARREL ──────────────────────────────────────────────────────────────────
// Single entry point

import { AUTH_ENDPOINTS }       from "./auth.js";
import { CONFIG_ENDPOINTS }     from "./config.js";
import { TELEMETRY_ENDPOINTS }  from "./telemetry.js";
import { ALERT_ENDPOINTS }      from "./alerts.js";
import { USERS_ENDPOINTS }      from "./users.js";
import { WEBHOOKS_ENDPOINTS }   from "./webhooks.js";
import { AI_ENDPOINTS }         from "./ai.js";
import { INTERNAL_ENDPOINTS }   from "./internal.js";

export { AUTH_STRATEGIES, FILTER_CHAIN, STARTUP_SEQUENCE, RATE_LIMITING_INFO, ROLE_ENFORCEMENT_INFO } from "./gateway.js";
export { AUTH_ENDPOINTS }       from "./auth.js";
export { CONFIG_ENDPOINTS }     from "./config.js";
export { TELEMETRY_ENDPOINTS }  from "./telemetry.js";
export { ALERT_ENDPOINTS }      from "./alerts.js";
export { USERS_ENDPOINTS }      from "./users.js";
export { WEBHOOKS_ENDPOINTS }   from "./webhooks.js";
export { AI_ENDPOINTS }         from "./ai.js";
export { INTERNAL_ENDPOINTS }   from "./internal.js";
export { PAGES }                from "./pages.js";
export { SCHEMA }               from "./schema.js";
export { ARCHITECTURE_SECTIONS, ARCHITECTURE_DELIVERY_DIAGRAM } from "./architecture.js";

// Legacy endpoint declarations contain compact `{ error: 'message' }` values.
// The published contract adds request context to every error, and exposes
// validation failures as a field-to-message map for direct form consumption.
function normalizeErrorResponse(endpoint, status, value)
{
	if (typeof value !== "string" || !value.trim().startsWith("{ error:")) return value;

	const fieldNames =
	[
	   ...new Set([
			...(Array.isArray(endpoint.request?.body) ? endpoint.request.body : []),
			...(Array.isArray(endpoint.request?.query) ? endpoint.request.query : []),
			...Array.from(endpoint.route.matchAll(/\{([^{}]+)\}/g), (match) => ({
			   name: match[1]
			})),
		].map(({ name }) => name))
	];

	// Sticky matching stops at explanatory suffixes, leaving any examples in
	// that text untouched while preserving each leading alternative's details.
	return value.replace(
		/(\s*(?:\|\s*)?)\{\s*error:\s*'((?:\\.|[^'\\])*)'(?:\s*,\s*code:\s*'((?:\\.|[^'\\])*)')?\s*\}/gy,
		(_match, separator, message, code) =>
		{
			const error = String(status) === "400"
				? `{ ${(fieldNames.length ? fieldNames : [
				   "field"
				]).map((name) => `${name}: '${message}'`).join(", ")} }`
				: `{ message: '${message}' }`;
			const codeField = code === undefined ? "" : `, code: '${code}'`;

			return `${separator}{ timestamp: '<iso8601>', status: ${status}, path: '${endpoint.route}', error: ${error}${codeField} }`;
		},
	);
}

function normalizeEndpointErrors(endpoint)
{
	if (!endpoint.response || typeof endpoint.response !== "object") return endpoint;

	return {
		...endpoint,
		response: Object.fromEntries(
			Object.entries(endpoint.response).map(([status, value]) =>
				[status, normalizeErrorResponse(endpoint, status, value)])
		),
	};
}

export const ENDPOINTS =
[
	...AUTH_ENDPOINTS,
	...CONFIG_ENDPOINTS,
	...TELEMETRY_ENDPOINTS,
	...ALERT_ENDPOINTS,
	...USERS_ENDPOINTS,
	...WEBHOOKS_ENDPOINTS,
	...AI_ENDPOINTS,
	...INTERNAL_ENDPOINTS,
].map(normalizeEndpointErrors);

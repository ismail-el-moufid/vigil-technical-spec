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

// HTTP errors carry a string message, not a structured error envelope.
// Keep the source declarations' explanatory suffixes and 401 cookie metadata.
function normalizeErrorBody(value)
{
	if (typeof value !== "string") return value;
	const alternatives = value.match(/^(?:\s*\{\s*error:\s*'[^']*'(?:,\s*code:\s*'[^']*')?\s*\}(?:\s*\|\s*)?)+/);
	if (alternatives)
	{
		const messages = Array.from(
			alternatives[0].matchAll(/error:\s*'([^']*)'/g),
			(match) => match[1]
		);
		return messages.join(" | ") + value.slice(alternatives[0].length);
	}
	if (!value.startsWith("{ timestamp:")) return value;
	const message = value.match(/message:\s*'([^']*)'/);
	if (message) return message[1] + value.slice(value.indexOf("} }", message.index) + 3);
	const validation = value.match(/error:\s*\{[^}]*?:\s*'([^']*)'/);
	return validation ? validation[1] + value.slice(value.indexOf("} }", validation.index) + 3) : value;
}

function normalizeEndpointErrors(endpoint)
{
	if (!endpoint.response || typeof endpoint.response !== "object") return endpoint;

	return {
		...endpoint,
		response: Object.fromEntries(
			Object.entries(endpoint.response).map(([status, value]) =>
			{
				if (!/^[45]\d\d$/.test(status)) return [status, value];
				return [
				   status,
				   typeof value === "object" && value !== null
						? { ...value, body: normalizeErrorBody(value.body) }
						: normalizeErrorBody(value)
				];
			})
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

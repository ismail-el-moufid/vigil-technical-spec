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

export { AUTH_STRATEGIES, FILTER_CHAIN, RATE_LIMITING_INFO, ROLE_ENFORCEMENT_INFO } from "./gateway.js";
export { AUTH_ENDPOINTS }       from "./auth.js";
export { CONFIG_ENDPOINTS }     from "./config.js";
export { TELEMETRY_ENDPOINTS }  from "./telemetry.js";
export { ALERT_ENDPOINTS }      from "./alerts.js";
export { USERS_ENDPOINTS }      from "./users.js";
export { WEBHOOKS_ENDPOINTS }   from "./webhooks.js";
export { AI_ENDPOINTS }         from "./ai.js";
export { INTERNAL_ENDPOINTS }   from "./internal.js";
export { PAGES }                from "./pages.js";

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
];


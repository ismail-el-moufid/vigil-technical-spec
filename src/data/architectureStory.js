// The incident is illustrative. checkout-api and /work are the Compose mock sender.
export const INCIDENT =
[
	{
		section: 'telemetry',
	   place: 'Checkout',
	   title: 'The fifth error.',
		text: 'Four checkout requests have failed in the last minute. Now a fifth returns 500. The Collector writes the logs to ClickHouse and checks that every retained row is visible before it tells the API.',
		next: 'Count the errors'
	},
	{
		section: 'delivery',
	   place: 'Rule evaluation',
	   title: 'Five errors. One alert.',
		text: 'You set a rule for five checkout errors in sixty seconds. The API counts by event time. This rule has no open alert, so Vigil saves one alert and its recipients’ notifications together in PostgreSQL.',
		next: 'Follow the alert'
	},
	{
		section: 'alert-connection',
	   place: 'Dashboard',
	   title: 'Your teammate missed it.',
		text: 'The alert went out over WebSocket while their dashboard was disconnected. They select Retry. When the socket opens, the dashboard fetches history and notifications again. The checkout alert is waiting.',
		next: 'Read the follow-up'
	},
	{
		section: 'ai',
	   place: 'On call',
	   title: 'Enough to act.',
		text: 'Your teammate can acknowledge the alert while the local model works. Tonight the model is offline. The worker records the failed analysis on the same alert. The five errors are still there to investigate.',
		next: 'Explore the system atlas'
	}
];

export const TOPICS =
{
	overview: ['System overview', 'vigil'],
	deployment: ['Ingress', 'operations'],
	vault: ['Secrets', 'operations-volumes'],
	startup: ['Startup', 'operations-startup'],
	telemetry: ['Telemetry', 'ingestion'],
	delivery: ['Alert evaluation', 'alerting-thresholds'],
	databases: ['Storage', 'ingestion-clickhouse'],
	'alert-connection': ['Live dashboard', 'experience-live'],
	'offline-navigation': ['Offline navigation', 'experience-spa'],
	ai: ['Local analysis', 'analysis'],
	decisions: ['Operations', 'operations']
};

// Each pair is a documented relationship. The same constraint is shown from
// either endpoint, so a reader following it can always find the way back.
export const CONNECTIONS =
[
	[
	   'deployment',
	   'telemetry',
	   'Ingress',
	   'Caddy strips /otlp. The Collector receives OTLP over HTTP on port 4318.'
	],
	[
	   'vault',
	   'telemetry',
	   'Credential',
	   'The Collector reads the ingestion key from the file rendered by its Vault agent.'
	],
	[
	   'startup',
	   'telemetry',
	   'Readiness',
	   'Collector startup waits for its agent and a successful ClickHouse initialization.'
	],
	[
	   'databases',
	   'telemetry',
	   'Visibility',
	   'The exporter checks the retained row count in ClickHouse using the batch notification ID.'
	],
	[
	   'telemetry',
	   'delivery',
	   'Two clocks',
	   'Rule windows end at the latest event time. Only a newer storage time advances the silence timer.'
	],
	[
	   'telemetry',
	   'decisions',
	   'Recovery',
	   'Deduplication keys and pending visibility checks live in Collector memory and disappear on restart.'
	],
	[
	   'overview',
	   'deployment',
	   'Public entry',
	   'The Compose host exposes Caddy. The dashboard API and telemetry follow different routes behind it.'
	],
	[
	   'deployment',
	   'vault',
	   'Configuration',
	   'The bearer token sent through Caddy must match the ingestion key rendered for the Collector.'
	],
	[
	   'vault',
	   'startup',
	   'Readiness',
	   'Agent health checks establish that the rendered files exist before dependent services start.'
	],
	[
	   'startup',
	   'databases',
	   'Schema',
	   'A healthy ClickHouse starts the one-shot table initializer. The API waits for initialization to finish.'
	],
	[
	   'deployment',
	   'delivery',
	   'Callback',
	   'The exporter calls the API on its internal listener at port 8081.'
	],
	[
	   'databases',
	   'delivery',
	   'Commit',
	   'ClickHouse holds the rows being counted. A separate PostgreSQL transaction saves alert history and recipient notifications.'
	],
	[
	   'delivery',
	   'alert-connection',
	   'Dispatch',
	   'The API commits the alert before attempting the shared WebSocket alert and the recipient-specific notification.'
	],
	[
	   'delivery',
	   'ai',
	   'Queue',
	   'The API submits analysis after saving the alert. Its 204 response can return while the job is waiting.'
	],
	[
	   'decisions',
	   'delivery',
	   'Retry budget',
	   'The exporter allows three callback attempts. Once exhausted, a stored batch can go unevaluated.'
	],
	[
	   'databases',
	   'alert-connection',
	   'Catch-up',
	   'Opening the socket refreshes saved history and personal notifications. Missed frames have no replay buffer.'
	],
	[
	   'deployment',
	   'alert-connection',
	   'Transport',
	   'The browser opens /api/alerts/ws through the public proxy using its access token.'
	],
	[
	   'offline-navigation',
	   'alert-connection',
	   'Offline boundary',
	   'The cached offline page covers navigation. Fetching saved alerts still needs a connection.'
	],
	[
	   'ai',
	   'alert-connection',
	   'Update',
	   'Saving the analysis lets the API send an llm frame for the existing alert.'
	],
	[
	   'ai',
	   'databases',
	   'Context',
	   'The API reads the service window from ClickHouse and writes the result onto the PostgreSQL alert.'
	],
	[
	   'startup',
	   'ai',
	   'Model readiness',
	   'The model pull gates FastAPI startup. Alert ingestion can run independently.'
	],
	[
	   'ai',
	   'decisions',
	   'Delivery',
	   'The webhook follows the saved analysis and broadcast. It gets one send attempt per destination.'
	],
	[
	   'overview',
	   'ai',
	   'Local inference',
	   'The API supplies context to FastAPI, which calls Ollama on the Compose network.'
	],
	[
	   'overview',
	   'databases',
	   'Persistence',
	   'Telemetry and application state use separate databases, volumes and commits.'
	],
	[
	   'overview',
	   'offline-navigation',
	   'Browser entry',
	   'Caddy serves the bundled SPA. Its service worker caches the offline page during installation.'
	],
	[
	   'startup',
	   'decisions',
	   'Recovery',
	   'Compose checks prerequisites at startup. Restarts do not rebuild process-local timers or jobs.'
	],
	[
	   'databases',
	   'decisions',
	   'Retention',
	   'ClickHouse TTL runs during background merges. Recovery from a lost volume depends on an external backup.'
	],
	[
	   'deployment',
	   'startup',
	   'Public readiness',
	   'Compose starts the reverse proxy after the API and Collector have started and the WAF is healthy.'
	],
	[
	   'vault',
	   'databases',
	   'Database credentials',
	   'PostgreSQL and ClickHouse each wait for their own Vault agent to render credentials.'
	],
	[
	   'telemetry',
	   'ai',
	   'Event window',
	   'Automatic analysis reads telemetry for the alert’s service and rule window. A silence alert uses the silence timeout instead.'
	],
	[
	   'deployment',
	   'databases',
	   'Network boundary',
	   'Both databases have unpublished ports. Browser reads go through the API behind Caddy.'
	],
	[
	   'alert-connection',
	   'decisions',
	   'Recovery',
	   'The API keeps live sessions in process memory. Saved alert history is the recovery path after a disconnect.'
	],
	[
	   'deployment',
	   'offline-navigation',
	   'Cache installation',
	   'The browser must first fetch the offline page and its assets from the web service to populate the fallback cache.'
	],
	[
	   'alert-connection',
	   'telemetry',
	   'Separate streams',
	   'The dashboard receives new alerts over WebSocket. Live telemetry views receive stored rows over SSE.'
	],
	[
	   'overview',
	   'delivery',
	   'Two API listeners',
	   'Dashboard traffic enters on the public-facing API listener behind the proxy. The Collector sends evaluation callbacks to the internal listener.'
	],
	[
	   'overview',
	   'startup',
	   'Independent services',
	   'The API and Collector share database initialization gates. Compose can start both while the model is still being pulled.'
	]
];

// The route and page catalogs own their labels and cross-references. Group the
// implementation reasons here so shared dashboard dependencies remain visible.
const callback = 'ep-alerts-trigger-evaluation';
export function contractGroups(sectionId, endpoints)
{
	const implemented = endpoints.filter(endpoint => endpoint.id !== 'ep-llm-analyze');
	const group = (label, match) => ({
	   label,
	   endpoints: implemented.filter(match)
	});
	const ids = (label, ...values) => group(label, endpoint => values.includes(endpoint.id));
	const publicRoutes = () => group('Public API via Caddy', endpoint => endpoint.route.startsWith('/api/'));
	switch (sectionId)
	{
	case 'overview': return [
		ids('Stored telemetry and alerts', callback, 'ep-alerts-list'),
		ids('Local inference', 'ep-fastapi-analyze', 'ep-fastapi-ask')
	];
	case 'telemetry': return [
		ids('Stored batch callback', callback),
		group('Historical, live and attribute queries', endpoint => endpoint.group === 'Telemetry')
	];
	case 'delivery': return [
		ids('Collector callback', callback),
		group('Rules and alert lifecycle', endpoint => endpoint.id.startsWith('ep-alert-rules-') || endpoint.id === 'ep-alert-history-update'),
		ids('Live dispatch', 'ep-alerts-ws')
	];
	case 'databases': return [
		...new Set(implemented.flatMap(endpoint => endpoint.tables))
	].map(table => group(table, endpoint => endpoint.tables.includes(table)));
	case 'deployment': return [
		publicRoutes(),
		group('Internal listeners', endpoint => endpoint.route.startsWith('/internal/'))
	];
	case 'vault': return [ids('Read provisioned keys', 'ep-config-keys')];
	case 'alert-connection': return [
		ids('Live frames', 'ep-alerts-ws'),
		ids('Read on reconnect', 'ep-alerts-list', 'ep-alert-notifications-list')
	];
	case 'ai': return [
		ids('Automatic analysis', 'ep-fastapi-analyze', 'ep-alerts-ws'),
		ids('Alert-scoped question · drawer request rejected', 'ep-alert-ask', 'ep-fastapi-ask'),
		group('Webhook destinations', endpoint => endpoint.group === 'Webhooks')
	];
	case 'decisions': return [ids('Callback retry budget', callback)];
	default: return [];
	}
}

export function connectedPages(sectionId, groups, pages)
{
	const implemented = pages.filter(page => page.id !== 'page-ai' && page.id !== 'page-status');
	if (sectionId === 'offline-navigation') return implemented;
	const endpoints = new Set(groups.flatMap(group => group.endpoints.map(endpoint => endpoint.id)));
	return implemented.filter(page => page.endpointIds.some(id => endpoints.has(id)));
}

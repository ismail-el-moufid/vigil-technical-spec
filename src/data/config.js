export const CONFIG_ENDPOINTS =
[
	{
		route: "/api/config/keys",
		service: "Spring Boot",
		owner: "Backend Lead",
		method: "GET",
		request: { query: [], body: null },
		response: {
			200: "{ api_key: '<opaque credential>', ingestion_key: '<ingestion credential>' }",
			401: "{ message: '<authentication failure message>' }",
			403: "{ message: 'access denied' }",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
		},
		group: "Config Keys", tables: [], tables_actions: {},
		constraints: {
			criteria: [
				{ text: "Implemented by ConfigController and VigilProperties. Read-only current runtime values, not necessarily UUIDs: api_key is loaded from an owner-private credential file and is generated only when that file is missing.", refs: ["gw-strat-api-key"] },
				"Admin API Keys settings displays both values. Onboarding fetches them through authenticated apiFetch /config/keys and embeds only ingestion_key in service export configuration. Never publish real credentials in documentation or logs.",
				"Current wizard blocks progression to configuration/verification while keys are loading, failed or empty; it has no demo-key fallback. Keys are held in the React Query config-keys cache; signOut clears that cache. They are not persisted to localStorage by the onboarding hook.",
				"Generated OTLP configuration uses OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT=<verified HTTPS address>/otlp and OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20<ingestion_key>. OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf is emitted except for the recommended Go setup, which uses the guide's HTTP exporter. Local TLS additionally requires exporter CA trust. The ingestion key does not authenticate API reads.",
								"Current TelemetryConfigStep directly interpolates service/address/path values into double-quoted Bash and awaits clipboard.writeText without a fallback/error handler. Safe shell escaping and manual-copy failure guidance remain follow-up work, not implemented guarantees.",
				"Deployment distinction: VigilProperties still generates ingestionKey in memory when unset; that fallback is not published to the Collector. Current docker-compose.yml instead imports API configtree:/run/secrets/ and starts the Collector with /run/secrets/collector-config.yaml. Vault init seeds the same VIGIL_INGESTION_KEY into API and Collector secret documents; agent templates render separate key files, and the Collector template uses bearertokenauth.filename. The repository runtime/config.yaml environment-based configuration is not the Compose-selected runtime. Independent secret updates can diverge; no Java-generated-key handoff or coordinated hot rotation is implemented.",
			], security: ["ADMIN only; response contains live credentials. ConfigController currently does not set Cache-Control: no-store (unlike TLS config responses)."],
			rateLimit: "JWT: 60/min per user + method + URI; ApiKey: shared 10/min per IP",
			realtime: "None", fallback: "None", dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN", id: "ep-config-keys",
	},
	{
		route: "/api/config/tls/addresses", service: "Spring Boot + TLS control helper (Unix socket)", owner: "Backend Lead", method: "POST",
		request: { query: [], body: [{ name: "address", type: "string (nonblank, max 512; HTTPS origin)", required: true }] },
		response: {
			200: "{ address, configured: true, status: 'verified', tls_mode: local | public, otlp_endpoint?, ca_download_url?: '/api/config/tls/ca' | null, code? }",
			202: "{ address, configured: boolean, status: 'pending', retry_after_seconds: 3, otlp_endpoint?, ca_download_url?, code? }",
			409: "{ address, configured: true, status: 'verified', tls_mode: local | public, otlp_endpoint?, ca_download_url?: '/api/config/tls/ca' | null, code? }",
			400: "{ message: 'invalid request' } | { message: 'Invalid TLS address. Use an HTTPS origin such as https://host[:port].' }",
			401: "{ message: '<authentication failure message>' }", 403: "{ message: 'access denied' }",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			503: "{ message: 'TLS configuration is unavailable. Check that the TLS control helper is running and accessible, then retry.' }",
		},
		group: "Config TLS", tables: [], tables_actions: {},
		constraints: {
			criteria: [
				"Implemented by TlsConfigController and TlsConfigService: send one bounded newline-delimited configure command over the local Unix control socket, default /run/vigil-tls/control.sock. 8-second transport deadline, 4KiB request/64KiB response limits; reject malformed helper replies and expose only allowlisted fields.",
				"200 and 409 are verified results; the frontend explicitly accepts verified 409. 202 is pending, not success, has retry_after_seconds=3 and no TLS mode. Frontend exposes the pending state and manual verification retry; no automatic polling is implemented.",
				"Configure results, CA success and the controller-local unavailable handler set Cache-Control: no-store. Global validation/auth/rate errors do not receive that header from this controller; do not promise it for every failure. Helper failures are sanitized to 503, not raw exception messages. This configures/verifies deployment TLS addressing; it does not register a monitored service or mark onboarding complete.",
				"Current wizard defaults to https://localhost; custom addresses must be verified before progression. Its Use localhost action sets local mode client-side without calling this endpoint. Do not describe that shortcut as server verification.",
			], security: ["ADMIN only, JWT or API key. No private certificate/key material is returned."],
			rateLimit: "JWT: 60/min per user + method + URI; ApiKey: shared 10/min per IP", realtime: "None", fallback: "503 on unavailable/invalid helper response", dedup: "Helper owns repeat-configuration semantics",
		},
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN", id: "ep-config-tls-addresses",
	},
	{
		route: "/api/config/tls/ca", service: "Spring Boot", owner: "Backend Lead", method: "GET",
		request: { query: [], body: null },
		response: {
			200: "Public CA PEM bytes; Content-Type: application/x-pem-file; attachment filename vigil-ca.crt; Cache-Control: no-store",
			401: "{ message: '<authentication failure message>' }", 403: "{ message: 'access denied' }",
			429: "{ message: 'rate limited. Try again in <seconds> seconds.' }",
			503: "{ message: 'The public TLS CA certificate is unavailable. Check that the public CA certificate is provisioned, then retry.' }",
		},
		group: "Config TLS", tables: [], tables_actions: {},
		constraints: {
			criteria: ["Implemented: read the configured public CA file (default /etc/vigil/ca/root.crt), validate CA-only X.509 PEM and a 64KiB limit, and return canonical public certificates only. Missing/invalid files return sanitized 503. Local-TLS onboarding downloads this as vigil-ca.crt and instructs the operator to configure exporter trust; browser trust alone is not exporter trust."],
			security: ["ADMIN only. Does not return a private key. CA validation checks X.509 parsing and basicConstraints, not certificate validity dates, chain trust or correspondence with the currently served TLS certificate."], rateLimit: "JWT: 60/min per user + method + URI; ApiKey: shared 10/min per IP", realtime: "None", fallback: "503 if public CA is unavailable", dedup: "None",
		},
		authStrategy: ["JWT", "API_KEY"], requiredRole: "ADMIN", id: "ep-config-tls-ca",
	},
];

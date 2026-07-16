// ─── DB SCHEMA ────────────────────────────────────────────────────────────────
// Canonical column definitions for every PostgreSQL table referenced across
// the endpoint data files. Consumed by the TablesRow component in
// EndpointComponents.jsx to render inline schema detail on each endpoint card.
//
// Column shape:
//   name        – column name
//   type        – PostgreSQL type (shown as-is)
//   pk          – true if primary key
//   fk          – { table, column, onDelete } if foreign key; onDelete states
//                 the ON DELETE behavior (CASCADE | SET NULL | RESTRICT) —
//                 every FK on a table whose parent row is actually deletable
//                 in this spec must declare one, so no path leaves a dangling
//                 FK or throws unhandled at the DB layer
//   nullable    – true if nullable (omit / false = NOT NULL)
//   unique      – true if has a unique constraint
//   notes       – short implementation note shown inline (optional)

export const SCHEMA =
{
	users:
	{
		db: "PostgreSQL",
		columns:
		[
			{
				name: "id",
				type: "UUID",
				pk: true,
				notes: "gen_random_uuid()"
			},
			{
				name: "email",
				type: "TEXT",
				unique: true
			},
			{
				name: "password_hash",
				type: "TEXT",
				notes: "bcrypt"
			},
			{
				name: "role",
				type: "TEXT",
				notes: "admin | viewer"
			},
		],
	},

	sessions:
	{
		db: "PostgreSQL",
		columns:
		[
			{
				name: "id",
				type: "UUID",
				pk: true,
				notes: "gen_random_uuid()"
			},
			{
				name: "user_id",
				type: "UUID",
				fk: {
					table: "users",
					column: "id",
					onDelete: "CASCADE"
				}
			},
			{
				name: "user_agent",
				type: "TEXT",
				nullable: true
			},
			{
				name: "ip_address",
				type: "TEXT",
				nullable: true
			},
			{
				name: "last_used_at",
				type: "TIMESTAMPTZ",
				notes: "updated in-place on every token rotation"
			},
			{
				name: "revoked",
				type: "BOOLEAN",
				notes: "DEFAULT false; true = session killed (logout or reuse detected)"
			},
		],
	},

	refresh_tokens:
	{
		db: "PostgreSQL",
		columns:
		[
			{
				name: "id",
				type: "UUID",
				pk: true,
				notes: "gen_random_uuid()"
			},
			{
				name: "user_id",
				type: "UUID",
				fk: { table: "users", column: "id", onDelete: "CASCADE" }
			},
			{
				name: "session_id",
				type: "UUID",
				fk: { table: "sessions", column: "id", onDelete: "CASCADE" }
			},
			{
				name: "token_hash",
				type: "TEXT",
				unique: true,
				notes: "SHA-256 of the raw token; raw value never stored. No application-level pre-insert uniqueness check is specified for this column, unlike users.email/webhooks.url: a collision would require two distinct randomly-generated tokens hashing identically, which is cryptographically negligible. Accepted scope decision — relies on the DB constraint alone, deliberately, rather than an oversight"
			},
			{
				name: "issued_at",
				type: "TIMESTAMPTZ",
				notes: "DEFAULT now()"
			},
			{
				name:"expires_at",
				type: "TIMESTAMPTZ"
			},
			{
				name: "superseded",
				type: "BOOLEAN",
				notes: "DEFAULT false; false = still the current token in chain, true = rotated away (set on the old row at the moment a refresh mints its replacement)"
			},
			{
				name: "revoked",
				type: "BOOLEAN",
				notes: "DEFAULT false; true = session killed (logout or reuse detected)"
			},
		],
	},

	alert_rules:
	{
		db: "PostgreSQL",
		columns:
		[
			{
				name: "id",
				type: "UUID",
				pk: true,
				notes: "gen_random_uuid()"
			},
			{
				name: "service",
				type: "TEXT"
			},
			{
				name: "signal_type",
				type: "TEXT",
				notes: "logs | metrics | traces — which ingest evaluator (ep-ingest-logs / ep-ingest-metrics / ep-ingest-traces) owns this rule. Each ingest endpoint only matches and evaluates alert_rules rows whose signal_type equals its own table; the other two skip the row entirely. This is what makes it well-defined for a rule to be evaluated by exactly one evaluator instead of being independently (and inconsistently) interpreted by all three. Set at creation, immutable thereafter — not accepted by ep-alert-rules-update's PATCH body under any circumstance, default-rule or not"
			},
			{
				name: "metric_name",
				type: "TEXT",
				notes: "meaning and validation depend on signal_type. metrics: open vocabulary, matched literally against the ingested point's own 'name' field — validated at create/update time against ep-telemetry-attributes' known key list (unchanged behavior from before signal_type existed). logs: closed enum, one of error_count | warning_count | critical_count | total_count — maps to a severity filter (total_count = no severity filter); any other value is a 400 at create/update. traces: closed enum, one of error_rate | span_count | avg_duration_ms | p50_duration_ms | p95_duration_ms | p99_duration_ms | max_duration_ms; any other value is a 400 at create/update. The logs/traces enums exist specifically so metric_name never depends on an undocumented mapping inside the evaluator — every value it can take is enumerated here and in ep-alert-rules-create/-update's 400 criteria"
			},
			{
				name: "aggregation",
				type: "TEXT",
				nullable: true,
				notes: "one of latest | avg | sum | min | max | count | p50 | p95 | p99. Required and meaningful only when signal_type = metrics: applied to 'value' across every point matching name = metric_name within the window, ending at the triggering batch's latest timestamp — 'latest' takes just the single most recent matching point (this is the direct equivalent of the old pre-windowing instantaneous check, so existing metrics-rule behavior is expressible, not lost). Must be null when signal_type = logs | traces, since the aggregation there is already baked into metric_name's closed enum (e.g. p95_duration_ms already says 'p95 of duration_ms' — a separate aggregation value would be redundant and could disagree with it). A non-null aggregation on a logs/traces rule, or a null aggregation on a metrics rule, is a 400 at create/update time"
			},
			{
				name: "window_seconds",
				type: "INTEGER",
				notes: "how far back from the triggering batch's latest timestamp the evaluator looks when computing this rule's aggregate, for all three signal_types uniformly — this is the field that makes logs/traces/metrics evaluation symmetric; previously logs/traces referenced an undefined 'configured time window' with no backing column, and metrics had no window concept at all. Required at create time, minimum 10 (400 below that). Not the same knob as vigil.silence-timeout-seconds: that config is how long a service can go without ANY batch before the separate silence watchdog fires; window_seconds is how far back a single threshold rule looks once a batch does arrive — the two are unrelated and can differ freely"
			},
			{
				name: "threshold",
				type: "NUMERIC",
				notes: "rule triggers when the aggregated value (per aggregation/metric_name above) is >= threshold; one direction only, no operator choice. Units follow metric_name: raw counts for *_count/span_count, a 0..1 fraction for error_rate (0.05 = 5%), milliseconds for *_duration_ms, and whatever unit the underlying point carries for signal_type = metrics"
			},
			{
				name: "severity",
				type: "TEXT",
				notes: "info | warning | critical"
			},
			{
				name: "enabled",
				type: "BOOLEAN",
				notes: "DEFAULT true"
			},
			{
				name: "is_default",
				type: "BOOLEAN",
				notes: "DEFAULT false; default rules not deletable"
			},
		],
	},

	alert_history:
	{
		db: "PostgreSQL",
		columns:
		[
			{
				name: "id",
				type: "UUID",
				pk: true,
				notes: "gen_random_uuid()"
			},
			{
				name: "rule_id",
				type: "UUID",
				fk: { table: "alert_rules", column: "id", onDelete: "SET NULL" },
				nullable: true,
				notes: "SET NULL, not CASCADE — alert_history is a historical record; deleting the rule that produced a past alert should not delete the alert. Non-default alert_rules rows are deletable (default rows can only be disabled, never deleted), so this is the one FK in this schema where the parent side actually needs a story. null is genuinely ambiguous on its own — it means EITHER 'rule since deleted' (this SET NULL firing) OR 'no rule ever matched' (a silence-watchdog alert — fired when a service goes quiet for too long, never backed by an alert_rules row to begin with). The two cases are distinguished by metric_name, not by rule_id: metric_name === 'service_silent' is the silence-watchdog case; any other metric_name with rule_id === null is the deleted-rule case. Consumers must branch on metric_name, not treat null rule_id as self-describing"
			},
			{
				name: "service",
				type: "TEXT"
			},
			{ name: "triggered_at", type: "TIMESTAMPTZ" },
			{
				name: "metric_name",
				type: "TEXT",
				notes: "snapshotted from the matching alert_rules row's own metric_name at insert time — not a live join, so the API can render this value on an alert straight off this table with no join to alert_rules, and it stays fixed even if that rule is later edited or has its own metric_name changed (rule_id going null via the SET NULL above covers the deleted case)"
			},
			{
				name: "signal_type",
				type: "TEXT",
				nullable: true,
				notes: "snapshotted from alert_rules at insert time, same reasoning as metric_name. Null specifically for a silence-watchdog alert (rule_id also null there) — a silence alert isn't produced by any one signal type's evaluator, since the shared watchdog timer resets on a batch of any signal type; treat signal_type === null the same way as metric_name === 'service_silent' (an expected, self-describing case), not as a missing/erroneous value"
			},
			{
				name: "window_seconds",
				type: "INTEGER",
				nullable: true,
				notes: "snapshotted from alert_rules at insert time, same reasoning as metric_name. Null for a silence-watchdog alert, same reasoning as signal_type above — there's no window to snapshot when no rule fired"
			},
			{
				name: "aggregation",
				type: "TEXT",
				nullable: true,
				notes: "snapshotted from alert_rules at insert time, same reasoning as metric_name. Null both for a silence-watchdog alert and for any logs/traces-sourced alert, since aggregation is only ever non-null on signal_type = metrics rules to begin with (see alert_rules.aggregation)"
			},
			{
				name: "threshold",
				type: "NUMERIC",
				notes: "snapshotted from alert_rules at insert time, same reasoning as metric_name"
			},
			{
				name: "severity",
				type: "TEXT",
				notes: "info | warning | critical; snapshotted from alert_rules at insert time, same reasoning as metric_name"
			},
			{
				name: "llm_analysis",
				type: "TEXT",
				nullable: true,
				notes: "null until FastAPI completes; 'Analysis unavailable' on timeout"
			},
		],
	},

	alert_acks:
	{
		db: "PostgreSQL",
		columns:
		[
			{
				name: "alert_id",
				type: "UUID",
				pk: true,
				fk: { table: "alert_history", column: "id" },
				notes: "no onDelete needed: no endpoint in this spec deletes alert_history rows (alerts are only acknowledged/resolved via ep-alert-ack, never removed), so this FK's parent is never actually deleted — unlike alert_rules, which is deletable and whose FK (alert_history.rule_id) does declare SET NULL"
			},
			{
				name: "user_id",
				type: "UUID",
				pk: true,
				fk: { table: "users", column: "id", onDelete: "CASCADE" },
				notes: "keyed on the immutable users.id, not email — a user changing their email (PATCH /api/users/me or /api/users/{id}) must not orphan their own ack history"
			},
			{
				name: "status",
				type: "TEXT",
				notes: "acknowledged | resolved"
			},
			{
				name: "acked_at",
				type: "TIMESTAMPTZ"
			},
		],
		notes: "PK is (alert_id, user_id) — per-user ack state, not a shared status. API responses still surface the acking user's email by joining to users.email at read time, since that's what the frontend displays; the join is just not the storage key.",
	},

	webhooks:
	{
		db: "PostgreSQL",
		columns:
		[
			{
				name: "id",
				type: "UUID",
				pk: true,
				notes: "gen_random_uuid()"
			},
			{ name: "url", type: "TEXT",  unique: true },
		],
	},

	logs:
	{
		db: "ClickHouse",
		columns:
		[
			{
				name: "service",
				type: "String"
			},
			{ name: "timestamp", type: "DateTime64(3)" },
			{ name: "severity",  type: "String" },
			{
				name: "message",
				type: "String"
			},
			{
				name: "attributes",
				type: "Map(String, String)",
				nullable: true
			},
		],
	},

	metrics:
	{
		db: "ClickHouse",
		columns:
		[
			{
				name: "service",
				type: "String"
			},
			{
				name: "timestamp",
				type: "DateTime64(3)"
			},
			{
				name: "name",
				type: "String"
			},
			{
				name: "value",
				type: "Float64"
			},
			{
				name: "attributes",
				type: "Map(String, String)",
				nullable: true,
				notes: "ep-telemetry-metrics' ?vigil.internal=true filter is implemented as attributes['internal'] = 'true' here — there is no dedicated 'internal' column"
			},
		],
	},

	traces:
	{
		db: "ClickHouse",
		columns:
		[
			{
				name: "trace_id",
				type: "String"
			},
			{
				name: "span_id",
				type: "String"
			},
			{ name: "parent_span_id",  type: "String",nullable: true },
			{
				name: "name",
				type: "String"
			},
			{
				name: "service",
				type: "String"
			},
			{
				name: "timestamp",
				type: "DateTime64(3)"
			},
			{
				name: "duration_ms",
				type: "UInt32"
			},
			{
				name: "status",
				type: "String"
			},
			{
				name: "attributes",
				type: "Map(String, String)",
				nullable: true
			},
		],
	},
};

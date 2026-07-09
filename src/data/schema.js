// ─── DB SCHEMA ────────────────────────────────────────────────────────────────
// Canonical column definitions for every PostgreSQL table referenced across
// the endpoint data files. Consumed by the TablesRow component in
// EndpointComponents.jsx to render inline schema detail on each endpoint card.
//
// Column shape:
//   name        – column name
//   type        – PostgreSQL type (shown as-is)
//   pk          – true if primary key
//   fk          – { table, column } if foreign key
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
					column: "id"
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
				fk: { table: "users", column: "id" }
			},
			{
				name: "session_id",
				type: "UUID",
				fk: { table: "sessions", column: "id" }
			},
			{
				name: "token_hash",
				type: "TEXT",
				unique: true,
				notes: "SHA-256 of the raw token; raw value never stored"
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
				name: "metric_name",
				type: "TEXT",
				notes: "which value the rule watches (e.g. 'error_count', 'avg_latency_ms', 'cpu_percent'); matched against the OTel payload's name/attributes by the evaluator"
			},
			{
				name: "threshold",
				type: "NUMERIC",
				notes: "rule triggers when the current metric_name value >= threshold; one direction only, no operator choice"
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
				fk: { table: "alert_rules", column: "id" }
			},
			{
				name: "service",
				type: "TEXT"
			},
			{ name: "triggered_at", type: "TIMESTAMPTZ" },
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
				fk: { table: "alert_history", column: "id" }
			},
			{
				name: "user_id",
				type: "UUID",
				fk: { table: "users", column: "id" },
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
				nullable: true
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

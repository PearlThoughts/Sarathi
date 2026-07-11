import { Pool, type PoolClient } from "pg";
import {
  type StrategyKernelRepository,
  strategyKernelMigrations,
} from "../../modules/strategy-kernel/index.ts";

type QueryResult = { readonly rows: readonly Record<string, unknown>[] };

export type StrategyKernelPostgresClient = {
  readonly query: (text: string, values?: readonly unknown[]) => Promise<QueryResult>;
};

export type StrategyKernelPostgresDatabase = StrategyKernelPostgresClient & {
  readonly connect: () => Promise<PoolClient>;
};

const nullableColumns: Readonly<Record<string, readonly string[]>> = {
  actor: ["external_principal_id"],
  external_system: ["base_url"],
  external_resource_mapping: ["external_url"],
  intent_node: [
    "owner_actor_id",
    "horizon_start",
    "horizon_end",
    "due_at",
    "success_signal",
    "origin_evidence_id",
  ],
  evidence_item: [
    "external_url",
    "actor_id",
    "consent_status",
    "consent_scope",
    "consent_recorded_at",
    "consent_recorded_by",
  ],
  extracted_claim: ["suggested_owner_id", "suggested_due_at", "ratified_node_id"],
  projection: ["target_id", "target_url", "last_published_hash", "last_verified_at"],
  accountability_action: ["due_at", "last_nudged_at", "completion_evidence_id"],
  kernel_event: ["actor_id"],
  drift_finding: ["related_entity_type", "related_entity_id", "resolved_at"],
};

const booleanColumns = new Set([
  "can_ratify_intent",
  "can_approve_sensitivity_downgrade",
  "evidence_required",
]);

const snakeCase = (value: string): string =>
  value.replace(/[A-Z]/g, (letter) => `_${letter}`.toLowerCase());
const camelCase = (value: string): string =>
  value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

const toRow = (table: string, value: Record<string, unknown>): Record<string, unknown> => {
  const row = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const column = snakeCase(key);
      return [
        column,
        booleanColumns.has(column) && typeof entry === "boolean" ? Number(entry) : entry,
      ];
    }),
  );
  for (const column of nullableColumns[table] ?? []) row[column] ??= null;
  return row;
};

const fromRow = <Result>(row: Record<string, unknown>): Result => {
  const value: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(row)) {
    if (entry === null) continue;
    value[camelCase(key)] =
      booleanColumns.has(key) && typeof entry === "number" ? entry === 1 : entry;
  }
  return value as Result;
};

const execute = async (
  database: StrategyKernelPostgresClient,
  text: string,
  values: readonly unknown[] = [],
): Promise<void> => {
  await database.query(text, values);
};

const save = async (
  database: StrategyKernelPostgresClient,
  table: string,
  value: Record<string, unknown>,
  conflict: readonly string[],
  update: readonly string[],
): Promise<void> => {
  const row = toRow(table, value);
  const columns = Object.keys(row);
  const values = columns.map((column) => row[column]);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const updates = update.map((column) => `${column} = excluded.${column}`).join(", ");
  await execute(
    database,
    `insert into ${table} (${columns.join(", ")}) values (${placeholders.join(", ")}) on conflict (${conflict.join(", ")}) do update set ${updates}`,
    values,
  );
};

const list = async <Result>(
  database: StrategyKernelPostgresClient,
  table: string,
  workspaceId: string,
  orderBy: string,
  extraWhere?: string,
): Promise<readonly Result[]> => {
  const where =
    extraWhere === undefined ? "workspace_id = $1" : `workspace_id = $1 and ${extraWhere}`;
  const result = await database.query(`select * from ${table} where ${where} order by ${orderBy}`, [
    workspaceId,
  ]);
  return result.rows.map((row) => fromRow<Result>(row));
};

export const openStrategyKernelPostgresDatabase = (connectionString: string): Pool =>
  new Pool({ connectionString });

export const closeStrategyKernelPostgresDatabase = async (database: {
  end: () => Promise<void>;
}): Promise<void> => {
  await database.end();
};

export const applyStrategyKernelPostgresMigrations = async (
  database: StrategyKernelPostgresDatabase,
): Promise<readonly string[]> => {
  const client = await database.connect();
  try {
    await execute(
      client,
      "create table if not exists schema_migration (id text primary key, description text not null, applied_at text not null)",
    );
    const applied: string[] = [];
    for (const migration of strategyKernelMigrations) {
      const existing = await client.query("select id from schema_migration where id = $1", [
        migration.id,
      ]);
      if (existing.rows.length > 0) continue;
      await execute(client, "begin");
      try {
        for (const statement of migration.sql) await execute(client, statement);
        await execute(
          client,
          "insert into schema_migration (id, description, applied_at) values ($1, $2, $3)",
          [migration.id, migration.description, new Date().toISOString()],
        );
        await execute(client, "commit");
        applied.push(migration.id);
      } catch (error) {
        await execute(client, "rollback");
        throw error;
      }
    }
    return applied;
  } finally {
    client.release();
  }
};

export const createPostgresStrategyKernelRepository = (
  database: StrategyKernelPostgresDatabase,
): StrategyKernelRepository => ({
  withTransaction: async (operation) => {
    const client = await database.connect();
    await execute(client, "begin");
    try {
      const result = await operation(
        createPostgresStrategyKernelRepository({
          query: (text, values) => client.query(text, values === undefined ? [] : [...values]),
          connect: async () => client,
        }),
      );
      await execute(client, "commit");
      return result;
    } catch (error) {
      await execute(client, "rollback");
      throw error;
    } finally {
      client.release();
    }
  },
  saveOrganization: (value) =>
    save(database, "organization", value, ["id"], ["name", "updated_at"]),
  saveWorkspace: (value) =>
    save(
      database,
      "workspace",
      value,
      ["organization_id", "key"],
      ["name", "kind", "default_sensitivity", "updated_at"],
    ),
  saveWorkspaceRelation: (value) =>
    save(database, "workspace_relation", value, ["id"], ["relation_type", "description"]),
  saveActor: (value) =>
    save(database, "actor", value, ["id"], ["display_name", "external_principal_id", "updated_at"]),
  saveWorkspaceActorRole: (value) =>
    save(
      database,
      "workspace_actor_role",
      value,
      ["workspace_id", "actor_id", "role"],
      ["can_ratify_intent", "can_approve_sensitivity_downgrade"],
    ),
  saveExternalSystem: (value) =>
    save(database, "external_system", value, ["id"], ["name", "base_url"]),
  saveExternalResourceMapping: (value) =>
    save(
      database,
      "external_resource_mapping",
      value,
      ["id"],
      ["external_id", "external_url", "purpose", "sensitivity"],
    ),
  saveEvidenceItem: (value) =>
    save(
      database,
      "evidence_item",
      value,
      ["workspace_id", "source_system", "external_id"],
      [
        "title",
        "body_excerpt",
        "content_hash",
        "sensitivity",
        "consent_status",
        "consent_scope",
        "consent_recorded_at",
        "consent_recorded_by",
        "ingested_at",
      ],
    ),
  saveExtractedClaim: (value) =>
    save(
      database,
      "extracted_claim",
      value,
      ["id"],
      [
        "text",
        "suggested_owner_id",
        "suggested_due_at",
        "confidence",
        "state",
        "sensitivity",
        "ratified_node_id",
        "updated_at",
      ],
    ),
  saveIntentNode: (value) =>
    save(
      database,
      "intent_node",
      value,
      ["id"],
      [
        "title",
        "body",
        "owner_actor_id",
        "state",
        "due_at",
        "success_signal",
        "sensitivity",
        "updated_at",
      ],
    ),
  saveIntentEdge: (value) => save(database, "intent_edge", value, ["id"], ["confidence"]),
  saveProjection: (value) =>
    save(
      database,
      "projection",
      value,
      ["id"],
      [
        "target_id",
        "target_url",
        "last_published_hash",
        "last_verified_at",
        "drift_status",
        "sensitivity",
      ],
    ),
  saveAccountabilityAction: (value) =>
    save(
      database,
      "accountability_action",
      value,
      ["id"],
      [
        "state",
        "due_at",
        "last_nudged_at",
        "escalation_level",
        "evidence_required",
        "completion_evidence_id",
        "sensitivity",
      ],
    ),
  saveKernelEvent: (value) => save(database, "kernel_event", value, ["id"], ["payload_json"]),
  saveDriftFinding: (value) =>
    save(database, "drift_finding", value, ["id"], ["title", "body", "state", "resolved_at"]),
  listWorkspaceEvidence: (workspaceId) =>
    list(database, "evidence_item", workspaceId, "occurred_at, id"),
  listWorkspaceIntent: (workspaceId) =>
    list(database, "intent_node", workspaceId, "created_at, id"),
  listPendingClaims: (workspaceId) =>
    list(database, "extracted_claim", workspaceId, "created_at, id", "state = 'pending'"),
  getExtractedClaim: async (id) => {
    const result = await database.query("select * from extracted_claim where id = $1", [id]);
    return result.rows[0] === undefined ? undefined : fromRow(result.rows[0]);
  },
  getIntentNode: async (id) => {
    const result = await database.query("select * from intent_node where id = $1", [id]);
    return result.rows[0] === undefined ? undefined : fromRow(result.rows[0]);
  },
  listWorkspaceProjections: (workspaceId) =>
    list(database, "projection", workspaceId, "target_system, target_type, id"),
  listWorkspaceAccountabilityActions: (workspaceId) =>
    list(database, "accountability_action", workspaceId, "due_at, id"),
  listWorkspaceDriftFindings: (workspaceId) =>
    list(database, "drift_finding", workspaceId, "created_at, id"),
  listWorkspaceKernelEvents: (workspaceId) =>
    list(database, "kernel_event", workspaceId, "occurred_at, id"),
});

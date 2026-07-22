import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect } from "effect";
import { Pool } from "pg";
import { RepositoryError } from "../../domain/errors.ts";
import { knowledgePostgresSchema } from "./knowledge-schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export type KnowledgePostgresDatabase = NodePgDatabase<typeof knowledgePostgresSchema>;

export type KnowledgeMigrationVerification = {
  readonly vectorExtensionVersion: string;
  readonly knowledgeTableCount: number;
  readonly deliveryTableCount: number;
  readonly protectedAuditTablesPresent: readonly string[];
};

export type KnowledgeMigrationStatus = {
  readonly vectorExtensionVersion: string | null;
  readonly knowledgeTableCount: number;
  readonly deliveryTableCount: number;
  readonly appliedMigrationCount: number;
  readonly checkpoints: readonly {
    readonly sourceId: string;
    readonly workspaceId: string;
    readonly cursor: string;
    readonly scopeHash: string;
    readonly documentsObserved: number;
    readonly passagesActive: number;
    readonly itemsDeleted: number;
    readonly checksum: string;
    readonly status: string;
    readonly indexedSourceRevision: string | null;
    readonly lastEventAt: string | null;
    readonly lastReconciledAt: string | null;
    readonly newestSourceUpdatedAt: string | null;
    readonly lastSucceededAt: string | null;
    readonly lagSeconds: number | null;
    readonly retryCount: number;
    readonly nextReconcileAt: string | null;
    readonly failureClass: string | null;
    readonly syncedAt: string;
  }[];
};

type RawKnowledgeCheckpoint = Omit<
  KnowledgeMigrationStatus["checkpoints"][number],
  | "lastEventAt"
  | "lastReconciledAt"
  | "newestSourceUpdatedAt"
  | "lastSucceededAt"
  | "nextReconcileAt"
  | "syncedAt"
> & {
  readonly lastEventAt: string | Date | null;
  readonly lastReconciledAt: string | Date | null;
  readonly newestSourceUpdatedAt: string | Date | null;
  readonly lastSucceededAt: string | Date | null;
  readonly nextReconcileAt: string | Date | null;
  readonly syncedAt: string | Date;
};

const isoTimestamp = (value: string | Date | null): string | null =>
  value instanceof Date ? value.toISOString() : value;

const protectedAuditTableNames = [
  "compliance_reminder_audit",
  "compliance_reminder_dry_run_evidence",
  "teams_mention_audit",
] as const;

export const knowledgeMigrationPlan = {
  migrationFolder: "drizzle",
  migrations: [
    "0000_enable-pgvector",
    "0001_knowledge-layer",
    "0002_delivery-intelligence-core",
    "0003_continuous-sync-control-plane",
    "0004_attributed-delivery-assertions",
    "0005_canonical-entity-time",
  ],
  additive: true,
  protectedTables: protectedAuditTableNames,
  applicationRollback:
    "Deploy the previous application revision; retain additive knowledge tables and checkpoints.",
  databaseRecovery:
    "Restore only from the pre-migration PostgreSQL backup if additive migration recovery is required.",
} as const;

export const knowledgePostgresPoolConfiguration = (
  connectionString: string,
  queryBudgetMs?: number,
) => ({
  connectionString,
  ...(queryBudgetMs === undefined
    ? {}
    : {
        connectionTimeoutMillis: queryBudgetMs,
        query_timeout: queryBudgetMs,
        statement_timeout: queryBudgetMs,
      }),
});

export const openKnowledgePostgresDatabase = (
  connectionString: string,
  queryBudgetMs?: number,
): { readonly pool: Pool; readonly database: KnowledgePostgresDatabase } => {
  const pool = new Pool(knowledgePostgresPoolConfiguration(connectionString, queryBudgetMs));
  return { pool, database: drizzle(pool, { schema: knowledgePostgresSchema }) };
};

const verifyMigration = async (pool: Pool): Promise<KnowledgeMigrationVerification> => {
  const [extension, tables] = await Promise.all([
    pool.query<{ readonly extversion: string }>(
      "select extversion from pg_extension where extname = 'vector'",
    ),
    pool.query<{ readonly table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and (table_name like 'knowledge_%' or table_name like 'delivery_%' or table_name = any($1::text[])) order by table_name",
      [protectedAuditTableNames],
    ),
  ]);
  const vectorExtensionVersion = extension.rows[0]?.extversion;
  if (vectorExtensionVersion === undefined)
    throw new Error("pgvector extension is not installed after migration.");
  const names = tables.rows.map(({ table_name }) => table_name);
  const knowledgeTableCount = names.filter((name) => name.startsWith("knowledge_")).length;
  if (knowledgeTableCount !== 11)
    throw new Error(`Expected 11 knowledge tables after migration; found ${knowledgeTableCount}.`);
  const deliveryTableCount = names.filter((name) => name.startsWith("delivery_")).length;
  if (deliveryTableCount !== 8)
    throw new Error(
      `Expected 8 delivery intelligence tables after migration; found ${deliveryTableCount}.`,
    );
  return {
    vectorExtensionVersion,
    knowledgeTableCount,
    deliveryTableCount,
    protectedAuditTablesPresent: protectedAuditTableNames.filter((name) => names.includes(name)),
  };
};

export const applyKnowledgePostgresMigrations = (
  connectionString: string,
): Effect.Effect<KnowledgeMigrationVerification, RepositoryError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => openKnowledgePostgresDatabase(connectionString)),
    ({ database, pool }) =>
      Effect.tryPromise({
        try: async () => {
          await migrate(database, {
            migrationsFolder,
            migrationsSchema: "drizzle",
            migrationsTable: "__drizzle_migrations",
          });
          return verifyMigration(pool);
        },
        catch: () =>
          new RepositoryError({
            message:
              "Knowledge migration failed; preserve the database backup and do not deploy the new runtime.",
            operation: "knowledge-migrate",
          }),
      }),
    ({ pool }) => Effect.promise(() => pool.end()),
  );

export const readKnowledgePostgresStatus = (
  connectionString: string,
): Effect.Effect<KnowledgeMigrationStatus, RepositoryError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => new Pool({ connectionString })),
    (pool) =>
      Effect.tryPromise({
        try: async () => {
          const [extension, tables, deliveryTables, journalExists] = await Promise.all([
            pool.query<{ readonly extversion: string }>(
              "select extversion from pg_extension where extname = 'vector'",
            ),
            pool.query<{ readonly count: string }>(
              "select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'knowledge_%'",
            ),
            pool.query<{ readonly count: string }>(
              "select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'delivery_%'",
            ),
            pool.query<{ readonly present: boolean }>(
              "select to_regclass('drizzle.__drizzle_migrations') is not null as present",
            ),
          ]);
          const appliedMigrationCount =
            journalExists.rows[0]?.present === true
              ? Number(
                  (
                    await pool.query<{ readonly count: string }>(
                      "select count(*) from drizzle.__drizzle_migrations",
                    )
                  ).rows[0]?.count ?? 0,
                )
              : 0;
          const knowledgeTableCount = Number(tables.rows[0]?.count ?? 0);
          const checkpoints =
            knowledgeTableCount === 11
              ? (
                  await pool.query<RawKnowledgeCheckpoint>(
                    'select source_id as "sourceId", workspace_id as "workspaceId", cursor, scope_hash as "scopeHash", documents_observed as "documentsObserved", passages_active as "passagesActive", items_deleted as "itemsDeleted", checksum, status, indexed_source_revision as "indexedSourceRevision", last_event_at as "lastEventAt", last_reconciled_at as "lastReconciledAt", newest_source_updated_at as "newestSourceUpdatedAt", last_succeeded_at as "lastSucceededAt", lag_seconds as "lagSeconds", retry_count as "retryCount", next_reconcile_at as "nextReconcileAt", failure_class as "failureClass", synced_at as "syncedAt" from knowledge_sync_checkpoint order by workspace_id, source_id',
                  )
                ).rows.map((checkpoint) => ({
                  ...checkpoint,
                  lastEventAt: isoTimestamp(checkpoint.lastEventAt),
                  lastReconciledAt: isoTimestamp(checkpoint.lastReconciledAt),
                  newestSourceUpdatedAt: isoTimestamp(checkpoint.newestSourceUpdatedAt),
                  lastSucceededAt: isoTimestamp(checkpoint.lastSucceededAt),
                  nextReconcileAt: isoTimestamp(checkpoint.nextReconcileAt),
                  syncedAt:
                    checkpoint.syncedAt instanceof Date
                      ? checkpoint.syncedAt.toISOString()
                      : checkpoint.syncedAt,
                }))
              : [];
          return {
            vectorExtensionVersion: extension.rows[0]?.extversion ?? null,
            knowledgeTableCount,
            deliveryTableCount: Number(deliveryTables.rows[0]?.count ?? 0),
            appliedMigrationCount,
            checkpoints,
          };
        },
        catch: () =>
          new RepositoryError({
            message: "Knowledge PostgreSQL status is unavailable.",
            operation: "knowledge-status",
          }),
      }),
    (pool) => Effect.promise(() => pool.end()),
  );

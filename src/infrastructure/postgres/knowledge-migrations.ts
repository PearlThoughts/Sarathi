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
  readonly protectedAuditTablesPresent: readonly string[];
};

const protectedAuditTableNames = [
  "compliance_reminder_audit",
  "compliance_reminder_dry_run_evidence",
  "teams_mention_audit",
] as const;

export const openKnowledgePostgresDatabase = (
  connectionString: string,
): { readonly pool: Pool; readonly database: KnowledgePostgresDatabase } => {
  const pool = new Pool({ connectionString });
  return { pool, database: drizzle(pool, { schema: knowledgePostgresSchema }) };
};

const verifyMigration = async (pool: Pool): Promise<KnowledgeMigrationVerification> => {
  const [extension, tables] = await Promise.all([
    pool.query<{ readonly extversion: string }>(
      "select extversion from pg_extension where extname = 'vector'",
    ),
    pool.query<{ readonly table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and (table_name like 'knowledge_%' or table_name = any($1::text[])) order by table_name",
      [protectedAuditTableNames],
    ),
  ]);
  const vectorExtensionVersion = extension.rows[0]?.extversion;
  if (vectorExtensionVersion === undefined)
    throw new Error("pgvector extension is not installed after migration.");
  const names = tables.rows.map(({ table_name }) => table_name);
  const knowledgeTableCount = names.filter((name) => name.startsWith("knowledge_")).length;
  if (knowledgeTableCount !== 7)
    throw new Error(`Expected 7 knowledge tables after migration; found ${knowledgeTableCount}.`);
  return {
    vectorExtensionVersion,
    knowledgeTableCount,
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

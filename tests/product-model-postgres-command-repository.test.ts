import { readFile } from "node:fs/promises";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { KnowledgePostgresDatabase } from "../src/infrastructure/postgres/knowledge-migrations.ts";
import {
  buildCurrentProductModelQuery,
  createPostgresProductModelCommandRepository,
} from "../src/infrastructure/postgres/product-model-command-repository.ts";
import {
  type ProductCommandCommit,
  type ProductModel,
  renameProductEntity,
} from "../src/modules/product-model/index.ts";
import {
  createBaseProductModelFixture,
  productChangeContext,
  productEntityId,
  productFixtureIds,
} from "./fixtures/product-model-fixture.ts";

const dialect = new PgDialect();
const workspaceId = "synthetic-workspace";

const commandCommit = async (before: ProductModel): Promise<ProductCommandCommit> => {
  const context = productChangeContext(6);
  const entityId = productEntityId(productFixtureIds.feature);
  const model = await Effect.runPromise(
    renameProductEntity(
      before,
      {
        entityId,
        canonicalName: "Scheduled Releases",
        canonicalAliasId: "alias-command-rename",
      },
      context,
    ),
  );
  return {
    expectedRevision: before.revision,
    commandHash: "sha256-synthetic-command",
    idempotencyKey: "synthetic-command-rename-0001",
    model,
    audit: {
      id: "90000000-0000-4000-8000-000000000001",
      workspaceId,
      requestId: "synthetic-request-0001",
      actorId: context.actorId,
      commandType: "RenameEntity",
      idempotencyKey: "synthetic-command-rename-0001",
      commandHash: "sha256-synthetic-command",
      justification: "The product owner approved the canonical name.",
      resultingRevision: model.revision,
      eventId: context.eventId,
      impactSummary: { changedEntityIds: [entityId] },
      sensitivity: "internal",
      audience: ["workspace-members"],
      recordedAt: context.recordedAt,
    },
    outbox: {
      id: "90000000-0000-4000-8000-000000000002",
      workspaceId,
      revision: model.revision,
      eventType: "RenameEntity",
      aggregateIds: [entityId],
      payload: { commandHash: "sha256-synthetic-command" },
      sensitivity: "internal",
      audience: ["workspace-members"],
      createdAt: context.recordedAt,
    },
    responseEntityIds: [entityId],
  };
};

const fakeDatabase = (
  current: ProductModel,
  options?: {
    readonly failAt?: string | undefined;
    readonly replayRows?: readonly Record<string, unknown>[] | undefined;
  },
) => {
  const statements: string[] = [];
  let committed = false;
  let rolledBack = false;
  const failOrRecord = (statement: string) => {
    statements.push(statement);
    if (options?.failAt !== undefined && statement.includes(options.failAt))
      throw new Error("Synthetic PostgreSQL failure.");
  };
  const execute = async (statement: Parameters<KnowledgePostgresDatabase["execute"]>[0]) => {
    const compiled = dialect.sqlToQuery(statement as SQL);
    failOrRecord(compiled.sql);
    if (compiled.sql.includes("select jsonb_build_object(")) return { rows: [{ model: current }] };
    if (compiled.sql.includes("select coalesce(max(revision), 0)::integer"))
      return { rows: [{ revision: current.revision }] };
    return { rows: [] };
  };
  const completed = (rows: readonly unknown[] = []) => Promise.resolve(rows);
  const select = () => ({
    from: (table: Parameters<typeof getTableName>[0]) => {
      const tableName = getTableName(table);
      failOrRecord(`select ${tableName}`);
      return {
        where: () => ({
          limit: async () =>
            tableName === "product_command_audit" ? (options?.replayRows ?? []) : [],
        }),
      };
    },
  });
  const insert = (table: Parameters<typeof getTableName>[0]) => ({
    values: () => {
      failOrRecord(`insert ${getTableName(table)}`);
      return completed();
    },
  });
  const update = (table: Parameters<typeof getTableName>[0]) => ({
    set: () => ({
      where: () => {
        const tableName = getTableName(table);
        failOrRecord(`update ${tableName}`);
        return Object.assign(completed(), {
          returning: async () =>
            tableName === "product_change_proposal" ? [{ id: "synthetic-proposal" }] : [],
        });
      },
    }),
  });
  const database = {
    execute,
    insert,
    select,
    update,
    transaction: async (
      operation: (transaction: {
        execute: typeof execute;
        insert: typeof insert;
        select: typeof select;
        update: typeof update;
      }) => Promise<unknown>,
    ) => {
      try {
        const result = await operation({ execute, insert, select, update });
        committed = true;
        return result;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
  } as unknown as KnowledgePostgresDatabase;
  return {
    database,
    statements,
    committed: () => committed,
    rolledBack: () => rolledBack,
  };
};

describe("PostgreSQL product-model command repository", () => {
  it("keeps ordinary DML on typed Drizzle schema builders", async () => {
    const source = await readFile(
      new URL(
        "../src/infrastructure/postgres/product-model-command-repository.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const rawSqlBodies = [...source.matchAll(/sql(?:<[^>]+>)?`([\s\S]*?)`/g)].map(
      (match) => match[1] ?? "",
    );

    expect(
      rawSqlBodies.filter((body) => /\b(?:insert\s+into|update|delete\s+from)\b/i.test(body)),
    ).toEqual([]);
    expect(source).toContain(".insert(productRevisionTable)");
    expect(source).toContain(".update(productEntityStateTable)");
    expect(source).toContain("database.transaction(async");
  });

  it("builds one workspace-bound aggregate reconstruction without audit or evidence bodies", () => {
    const compiled = dialect.sqlToQuery(buildCurrentProductModelQuery(workspaceId));

    expect(compiled.sql).toContain("from product_entity entity");
    expect(compiled.sql).toContain("from product_entity_alias");
    expect(compiled.sql).toContain("from product_hierarchy_edge");
    expect(compiled.sql).toContain("from product_relation");
    expect(compiled.sql).toContain("from product_variant");
    expect(compiled.sql).toContain("from product_identity_event");
    expect(compiled.sql).not.toContain("product_command_audit");
    expect(compiled.sql).not.toContain("product_claim");
    expect(compiled.params.every((parameter) => parameter === workspaceId)).toBe(true);
  });

  it("commits revision, state, identity event, audit, and outbox in one locked transaction", async () => {
    const before = await createBaseProductModelFixture();
    const bundle = await commandCommit(before);
    const fake = fakeDatabase(before);
    const repository = createPostgresProductModelCommandRepository(fake.database);

    const result = await Effect.runPromise(repository.commit(bundle));

    expect(result).toMatchObject({ revision: 6, eventId: "synthetic-event-6", replayed: false });
    expect(fake.committed()).toBe(true);
    expect(fake.rolledBack()).toBe(false);
    const joined = fake.statements.join("\n");
    expect(fake.statements[0]).toContain("pg_advisory_xact_lock");
    expect(joined).toContain("insert product_revision");
    expect(joined).toContain("insert product_entity_state");
    expect(joined).toContain("insert product_identity_event");
    expect(joined).toContain("insert product_command_audit");
    expect(joined).toContain("insert product_outbox_event");
    expect(joined.indexOf("insert product_command_audit")).toBeLessThan(
      joined.indexOf("insert product_outbox_event"),
    );
  });

  it("rolls back the whole transaction when a later durable write fails", async () => {
    const before = await createBaseProductModelFixture();
    const bundle = await commandCommit(before);
    const fake = fakeDatabase(before, { failAt: "insert product_command_audit" });
    const repository = createPostgresProductModelCommandRepository(fake.database);

    const result = await Effect.runPromise(Effect.either(repository.commit(bundle)));

    expect(result._tag).toBe("Left");
    expect(fake.committed()).toBe(false);
    expect(fake.rolledBack()).toBe(true);
    expect(fake.statements.join("\n")).not.toContain("insert product_outbox_event");
  });

  it("rejects a stale expected revision after taking the workspace transaction lock", async () => {
    const before = await createBaseProductModelFixture();
    const bundle = await commandCommit(before);
    const concurrent = bundle.model;
    const fake = fakeDatabase(concurrent);
    const repository = createPostgresProductModelCommandRepository(fake.database);

    const result = await Effect.runPromise(Effect.either(repository.commit(bundle)));

    expect(result._tag === "Left" ? result.left : undefined).toMatchObject({
      code: "stale_revision",
    });
    expect(fake.committed()).toBe(false);
    expect(fake.rolledBack()).toBe(true);
    expect(fake.statements[0]).toContain("pg_advisory_xact_lock");
    expect(fake.statements.join("\n")).not.toContain("insert product_revision");
  });

  it("returns an idempotent replay and rejects a conflicting command hash", async () => {
    const before = await createBaseProductModelFixture();
    const fake = fakeDatabase(before, {
      replayRows: [
        {
          commandHash: "sha256-original",
          resultingRevision: 6,
          eventId: "synthetic-event-6",
          impactSummary: {
            changedEntityIds: [productEntityId(productFixtureIds.feature)],
          },
        },
      ],
    });
    const repository = createPostgresProductModelCommandRepository(fake.database);

    const replay = await Effect.runPromise(
      repository.replay(workspaceId, "synthetic-key", "sha256-original"),
    );
    const conflict = await Effect.runPromise(
      Effect.either(repository.replay(workspaceId, "synthetic-key", "sha256-different")),
    );

    expect(replay).toMatchObject({ revision: 6, replayed: true });
    expect(conflict._tag === "Left" ? conflict.left : undefined).toMatchObject({
      code: "idempotency_conflict",
    });
  });
});

import { count, eq } from "drizzle-orm";
import { Effect } from "effect";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runKnowledgeCommand } from "../src/cli/commands/knowledge-runtime.ts";
import { createDeterministicKnowledgeEmbedding } from "../src/infrastructure/model/index.ts";
import {
  applyKnowledgePostgresMigrations,
  createPostgresKnowledgeRepository,
  openKnowledgePostgresDatabase,
} from "../src/infrastructure/postgres/index.ts";
import {
  deliveryClaimTable,
  deliveryFinanceMetricTable,
  deliveryMetricTable,
  deliveryObjectTable,
  deliveryObservationTable,
  deliveryRelationTable,
} from "../src/infrastructure/postgres/knowledge-schema.ts";
import type { KnowledgeSourceSnapshot } from "../src/modules/knowledge-layer/index.ts";

const databaseUrl = process.env.SARATHI_KNOWLEDGE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

const snapshot = (version: string, body: string): KnowledgeSourceSnapshot => ({
  sourceId: "jira-example-test",
  source: "jira",
  workspaceId: "workspace-example",
  cursor: `cursor-${version}`,
  scopeHash: "sha256-scope",
  documents: [
    {
      source: "jira",
      sourceId: "jira-example-test",
      workspaceId: "workspace-example",
      externalId: "DEMO-635",
      sourceType: "issue",
      sourceVersion: version,
      canonicalUrl: "https://jira.example/browse/DEMO-635",
      title: "Example Delivery Portal",
      sourceUpdatedAt: "2026-07-20T00:00:00.000Z",
      sensitivity: "internal",
      authority: 1,
      provenance: { projectKey: "DEMO" },
      acl: [
        { subjectType: "audience", subjectId: "delivery", effect: "allow" },
        { subjectType: "audience", subjectId: "blocked", effect: "deny" },
      ],
      passages: [
        {
          kind: "description",
          locator: "#description",
          ordinal: 0,
          title: "Status",
          body,
          contentHash: `sha256-${version}`,
        },
      ],
      deliveryProjection: {
        objects: [
          {
            kind: "project",
            externalKey: "DEMO",
            title: "Example Project",
            lifecycleState: "active",
            attributes: {},
            sensitivity: "internal",
          },
          {
            kind: "work_item",
            externalKey: "DEMO-635",
            title: "Example Delivery Portal",
            lifecycleState: version === "v1" ? "in_progress" : "done",
            attributes: { priority: "high" },
            sensitivity: "internal",
          },
        ],
        relations: [
          {
            kind: "contains",
            from: { kind: "project", externalKey: "DEMO" },
            to: { kind: "work_item", externalKey: "DEMO-635" },
            attributes: {},
            sensitivity: "internal",
          },
        ],
        observations: [
          {
            kind: "state",
            externalId: `DEMO-635:${version}`,
            subject: { kind: "work_item", externalKey: "DEMO-635" },
            summary: `DEMO-635 state observed at ${version}`,
            dedupeKey: `jira:DEMO-635:state:${version}`,
            occurredAt: "2026-07-20T00:00:00.000Z",
            citationUrl: "https://jira.example/browse/DEMO-635",
            sensitivity: "internal",
            authority: 1,
          },
        ],
        metrics: [
          {
            subject: { kind: "work_item", externalKey: "DEMO-635" },
            category: "delivery",
            kind: "estimate_story_points",
            value: "5",
            unit: "points",
            sensitivity: "internal",
          },
          {
            subject: { kind: "project", externalKey: "DEMO" },
            category: "finance",
            kind: "budget",
            value: "1000",
            unit: "USD",
            sensitivity: "confidential",
          },
        ],
        claims: [
          {
            subject: { kind: "work_item", externalKey: "DEMO-635" },
            subjectKey: "DEMO-635",
            predicate: "jira.status",
            value: version === "v1" ? "in_progress" : "done",
            assertedAt: "2026-07-20T00:00:00.000Z",
            citationUrl: "https://jira.example/browse/DEMO-635",
            sensitivity: "internal",
            authority: 1,
          },
        ],
      },
    },
  ],
});

describeDatabase("knowledge PostgreSQL integration", () => {
  let pool: Pool;
  let opened: ReturnType<typeof openKnowledgePostgresDatabase>;

  beforeAll(async () => {
    if (databaseUrl === undefined) return;
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(
      "create table if not exists compliance_reminder_audit (id text primary key); create table if not exists compliance_reminder_dry_run_evidence (id text primary key); create table if not exists teams_mention_audit (id text primary key)",
    );
    const verification = await Effect.runPromise(applyKnowledgePostgresMigrations(databaseUrl));
    expect(verification.knowledgeTableCount).toBe(7);
    expect(verification.deliveryTableCount).toBe(7);
    expect(verification.protectedAuditTablesPresent).toEqual([
      "compliance_reminder_audit",
      "compliance_reminder_dry_run_evidence",
      "teams_mention_audit",
    ]);
    await pool.query("truncate table knowledge_source cascade");
    opened = openKnowledgePostgresDatabase(databaseUrl);
  });

  afterAll(async () => {
    await opened?.pool.end();
    await pool?.end();
  });

  test("migrates additively, deduplicates replay, versions edits, filters ACL, and tombstones deletion", async () => {
    const repository = createPostgresKnowledgeRepository(opened.database);
    const embeddings = createDeterministicKnowledgeEmbedding();
    const first = await Effect.runPromise(
      repository.reconcile(
        snapshot("v1", "The builder is in QA with approved rollout risk."),
        embeddings,
      ),
    );
    const replay = await Effect.runPromise(
      repository.reconcile(
        snapshot("v1", "The builder is in QA with approved rollout risk."),
        embeddings,
      ),
    );
    expect(first).toMatchObject({ versionsCreated: 1, passagesActive: 1, itemsDeleted: 0 });
    expect(replay).toMatchObject({ versionsCreated: 0, passagesActive: 1, itemsDeleted: 0 });
    expect(replay.checksum).toBe(first.checksum);
    const activeCount = async (
      table:
        | typeof deliveryObjectTable
        | typeof deliveryRelationTable
        | typeof deliveryObservationTable
        | typeof deliveryMetricTable
        | typeof deliveryFinanceMetricTable
        | typeof deliveryClaimTable,
    ): Promise<number> =>
      Number(
        (
          await opened.database.select({ value: count() }).from(table).where(eq(table.active, true))
        )[0]?.value ?? 0,
      );
    expect(
      await Promise.all([
        activeCount(deliveryObjectTable),
        activeCount(deliveryRelationTable),
        activeCount(deliveryObservationTable),
        activeCount(deliveryMetricTable),
        activeCount(deliveryFinanceMetricTable),
        activeCount(deliveryClaimTable),
      ]),
    ).toEqual([2, 1, 1, 1, 1, 1]);

    const authorized = await Effect.runPromise(
      repository.search(
        {
          question: "DEMO-635 Example Delivery Portal",
          audience: {
            workspaceId: "workspace-example",
            audienceIds: ["delivery"],
            maximumSensitivity: "internal",
          },
          topK: 10,
        },
        (await Effect.runPromise(embeddings.embed(["builder status"])))[0] ?? [],
      ),
    );
    expect(authorized[0]).toMatchObject({ source: "jira", sourceId: "DEMO-635" });
    expect(authorized[0]?.citationUrl).toBe("https://jira.example/browse/DEMO-635#description");

    for (const audience of [
      {
        workspaceId: "workspace-example",
        audienceIds: ["blocked"],
        maximumSensitivity: "internal" as const,
      },
      {
        workspaceId: "other-workspace",
        audienceIds: ["delivery"],
        maximumSensitivity: "restricted" as const,
      },
    ]) {
      await expect(
        Effect.runPromise(
          repository.search(
            { question: "DEMO-635", audience, topK: 10 },
            (await Effect.runPromise(embeddings.embed(["status"])))[0] ?? [],
          ),
        ),
      ).resolves.toEqual([]);
    }

    const edited = await Effect.runPromise(
      repository.reconcile(
        snapshot("v2", "The builder passed QA and awaits release approval."),
        embeddings,
      ),
    );
    expect(edited.versionsCreated).toBe(1);
    const activeBodies = await pool.query<{ readonly body: string }>(
      "select body from knowledge_passage where active = true",
    );
    expect(activeBodies.rows.map(({ body }) => body)).toEqual([
      "The builder passed QA and awaits release approval.",
    ]);

    const changedModel = { ...embeddings, model: "deterministic-test-v2" };
    const restored = await Effect.runPromise(
      repository.reconcile(
        snapshot("v1", "The builder is in QA with approved rollout risk."),
        changedModel,
      ),
    );
    expect(restored.versionsCreated).toBe(0);
    const restoredState = await pool.query<{
      readonly body: string;
      readonly embedding_model: string;
      readonly active_versions: string;
    }>(
      "select p.body, projection.embedding_model, (select count(*) from knowledge_version where active) as active_versions from knowledge_passage p join knowledge_projection projection on projection.passage_id = p.id where p.active",
    );
    expect(restoredState.rows).toEqual([
      {
        body: "The builder is in QA with approved rollout risk.",
        embedding_model: "deterministic-test-v2",
        active_versions: "1",
      },
    ]);

    const deleted = await Effect.runPromise(
      repository.reconcile(
        {
          sourceId: "jira-example-test",
          source: "jira",
          workspaceId: "workspace-example",
          cursor: "cursor-deleted",
          scopeHash: "sha256-scope",
          documents: [],
        },
        embeddings,
      ),
    );
    expect(deleted.itemsDeleted).toBe(1);
    const state = await pool.query<{
      readonly deleted: boolean;
      readonly active_passages: string;
      readonly tombstones: string;
    }>(
      "select bool_and(i.deleted_at is not null) as deleted, count(distinct p.id) filter (where p.active) as active_passages, count(distinct v.id) filter (where v.tombstone) as tombstones from knowledge_item i left join knowledge_passage p on p.item_id = i.id left join knowledge_version v on v.item_id = i.id",
    );
    expect(state.rows[0]).toMatchObject({ deleted: true, active_passages: "0", tombstones: "2" });
    expect(
      await Promise.all([
        activeCount(deliveryObjectTable),
        activeCount(deliveryRelationTable),
        activeCount(deliveryObservationTable),
        activeCount(deliveryMetricTable),
        activeCount(deliveryFinanceMetricTable),
        activeCount(deliveryClaimTable),
      ]),
    ).toEqual([0, 0, 0, 0, 0, 0]);
    const afterDelete = await Effect.runPromise(
      repository.search(
        {
          question: "DEMO-635",
          audience: {
            workspaceId: "workspace-example",
            audienceIds: ["delivery"],
            maximumSensitivity: "internal",
          },
          topK: 10,
        },
        (await Effect.runPromise(embeddings.embed(["status"])))[0] ?? [],
      ),
    );
    expect(afterDelete).toEqual([]);

    const cliStatus = await runKnowledgeCommand(["status"], {
      SARATHI_STRATEGY_DATABASE_URL: databaseUrl,
    });
    expect(cliStatus).toMatchObject({
      exitCode: 0,
      output: {
        status: {
          knowledgeTableCount: 7,
          appliedMigrationCount: 3,
          checkpoints: [
            expect.objectContaining({
              sourceId: "jira-example-test",
              documentsObserved: 0,
              itemsDeleted: 1,
            }),
          ],
        },
      },
    });
  });

  test("rejects duplicate source locators before persistence", async () => {
    const repository = createPostgresKnowledgeRepository(opened.database);
    const embeddings = createDeterministicKnowledgeEmbedding();
    const base = snapshot("duplicate-locators", "First status section.");
    const document = base.documents[0];
    if (document === undefined) throw new Error("Synthetic snapshot document is required.");

    await expect(
      Effect.runPromise(
        repository.reconcile(
          {
            ...base,
            cursor: "cursor-duplicate-locators",
            documents: [
              {
                ...document,
                externalId: "DEMO-636",
                sourceVersion: "duplicate-locators",
                passages: [
                  ...document.passages,
                  {
                    kind: "description",
                    locator: "#description",
                    ordinal: 1,
                    title: "Status",
                    body: "Second status section.",
                    contentHash: "sha256-duplicate-locator-2",
                  },
                ],
              },
            ],
          },
          embeddings,
        ),
      ),
    ).rejects.toThrow("unique locators");
    const stored = await pool.query<{ readonly passage_count: string }>(
      "select count(distinct p.id) as passage_count from knowledge_passage p join knowledge_item i on i.id = p.item_id where i.external_id = 'DEMO-636' and p.active",
    );
    expect(stored.rows).toEqual([{ passage_count: "0" }]);
  });
});

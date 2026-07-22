import { count, eq } from "drizzle-orm";
import { Effect } from "effect";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runKnowledgeCommand } from "../src/cli/commands/knowledge-runtime.ts";
import { createDeterministicKnowledgeEmbedding } from "../src/infrastructure/model/index.ts";
import {
  applyKnowledgePostgresMigrations,
  createPostgresDeliveryQuerySource,
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
import { planDeliveryQuestion } from "../src/modules/delivery-intelligence/index.ts";
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
        { subjectType: "workspace", subjectId: "workspace-example", effect: "allow" },
        { subjectType: "actor", subjectId: "blocked-actor", effect: "deny" },
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
    expect(verification.knowledgeTableCount).toBe(11);
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
    const deterministicEmbeddings = createDeterministicKnowledgeEmbedding();
    const embeddingBatches: string[][] = [];
    const embeddings = {
      ...deterministicEmbeddings,
      embed: (values: readonly string[]) => {
        embeddingBatches.push([...values]);
        return deterministicEmbeddings.embed(values);
      },
    };
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
    expect(embeddingBatches).toEqual([["The builder is in QA with approved rollout risk."]]);
    const projectionTimestampChanged = snapshot(
      "v1",
      "The builder is in QA with approved rollout risk.",
    );
    const projectionDocument = projectionTimestampChanged.documents[0];
    if (projectionDocument === undefined) throw new Error("Synthetic document is required.");
    const projection = projectionDocument.deliveryProjection;
    if (projection === undefined) throw new Error("Synthetic delivery projection is required.");
    const timestampReplay = await Effect.runPromise(
      repository.reconcile(
        {
          ...projectionTimestampChanged,
          cursor: "cursor-v1-projection-timestamp-changed",
          documents: [
            {
              ...projectionDocument,
              deliveryProjection: {
                ...projection,
                observations: projection.observations.map((observation) => ({
                  ...observation,
                  occurredAt: "2026-07-21T00:00:00.000Z",
                })),
                claims: projection.claims.map((claim) => ({
                  ...claim,
                  assertedAt: "2026-07-21T00:00:00.000Z",
                })),
              },
            },
          ],
        },
        embeddings,
      ),
    );
    expect(timestampReplay.versionsCreated).toBe(0);
    expect(embeddingBatches).toEqual([["The builder is in QA with approved rollout risk."]]);
    const provenanceChanged = snapshot("v1", "The builder is in QA with approved rollout risk.");
    const provenanceDocument = provenanceChanged.documents[0];
    if (provenanceDocument === undefined) throw new Error("Synthetic document is required.");
    const provenanceReplay = await Effect.runPromise(
      repository.reconcile(
        {
          ...provenanceChanged,
          cursor: "cursor-v1-provenance-changed",
          documents: [
            {
              ...provenanceDocument,
              provenance: { ...provenanceDocument.provenance, revision: "new-repository-commit" },
            },
          ],
        },
        embeddings,
      ),
    );
    expect(provenanceReplay.versionsCreated).toBe(1);
    expect(embeddingBatches).toEqual([["The builder is in QA with approved rollout risk."]]);
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

    const deliverySource = createPostgresDeliveryQuerySource(opened.database);
    const statusPlan = planDeliveryQuestion("What is the current status of DEMO-635?");
    const financePlan = planDeliveryQuestion("What is the project budget?");
    if (statusPlan === undefined || financePlan === undefined)
      throw new Error("Expected deterministic delivery query plans");
    const deliveryContext = {
      workspaceId: "workspace-example",
      actorId: "delivery-member",
      maximumSensitivity: "internal",
      financeAccess: false,
      requestedAt: "2026-07-20T12:00:00.000Z",
      timeZone: "Asia/Kolkata",
      deadlineAt: "2026-07-20T12:00:08.000Z",
      question: "What is the current status of DEMO-635?",
    } as const;
    const deliveryStatus = await Effect.runPromise(
      deliverySource.execute(deliveryContext, statusPlan),
    );
    expect(deliveryStatus.items).toEqual([
      expect.objectContaining({
        workspaceId: "workspace-example",
        source: "jira",
        selector: "objects",
        citationUrl: "https://jira.example/browse/DEMO-635",
      }),
    ]);
    for (const deniedContext of [
      { ...deliveryContext, actorId: "blocked-actor" },
      { ...deliveryContext, workspaceId: "other-workspace" },
      { ...deliveryContext, maximumSensitivity: "public" as const },
    ]) {
      const denied = await Effect.runPromise(deliverySource.execute(deniedContext, statusPlan));
      expect(denied.items).toEqual([]);
    }
    const finance = await Effect.runPromise(
      deliverySource.execute(
        {
          ...deliveryContext,
          maximumSensitivity: "confidential",
          financeAccess: true,
          question: "What is the project budget?",
        },
        financePlan,
      ),
    );
    expect(finance.items).toEqual([
      expect.objectContaining({
        selector: "metrics",
        title: "budget",
        sensitivity: "confidential",
      }),
    ]);

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

    const overlapWithNoChanges = await Effect.runPromise(
      repository.reconcile(
        {
          sourceId: "jira-example-test",
          source: "jira",
          workspaceId: "workspace-example",
          cursor: "cursor-overlap-no-changes",
          scopeHash: "sha256-scope",
          mode: "delta",
          retiredExternalIds: [],
          documents: [],
        },
        embeddings,
      ),
    );
    expect(overlapWithNoChanges.itemsDeleted).toBe(0);
    expect(
      (
        await pool.query<{ readonly authority: number }>(
          "select authority from knowledge_source where id = 'jira-example-test'",
        )
      ).rows,
    ).toEqual([{ authority: 1 }]);
    expect(
      Number(
        (
          await opened.database
            .select({ value: count() })
            .from(deliveryObjectTable)
            .where(eq(deliveryObjectTable.active, true))
        )[0]?.value ?? 0,
      ),
    ).toBe(2);

    const deleted = await Effect.runPromise(
      repository.reconcile(
        {
          sourceId: "jira-example-test",
          source: "jira",
          workspaceId: "workspace-example",
          cursor: "cursor-deleted",
          scopeHash: "sha256-scope",
          mode: "delta",
          retiredExternalIds: ["DEMO-635"],
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
    expect(state.rows[0]).toMatchObject({ deleted: true, active_passages: "0", tombstones: "3" });
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
    const deliveryAfterDelete = await Effect.runPromise(
      deliverySource.execute(deliveryContext, statusPlan),
    );
    expect(deliveryAfterDelete.items).toEqual([]);

    const cliStatus = await runKnowledgeCommand(["status"], {
      SARATHI_STRATEGY_DATABASE_URL: databaseUrl,
    });
    expect(cliStatus).toMatchObject({
      exitCode: 0,
      output: {
        status: {
          knowledgeTableCount: 11,
          appliedMigrationCount: 4,
          checkpoints: [
            expect.objectContaining({
              sourceId: "jira-example-test",
              documentsObserved: 0,
              itemsDeleted: 1,
              indexedSourceRevision: "cursor-deleted",
              lastEventAt: expect.any(String),
              lastReconciledAt: expect.any(String),
              newestSourceUpdatedAt: "2026-07-20T00:00:00.000Z",
              lastSucceededAt: expect.any(String),
              retryCount: 0,
              nextReconcileAt: expect.any(String),
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

  test("reuses an unchanged passage vector while a Vault rename retires the old path", async () => {
    const repository = createPostgresKnowledgeRepository(opened.database);
    const deterministic = createDeterministicKnowledgeEmbedding();
    const embeddingBatches: string[][] = [];
    const embeddings = {
      ...deterministic,
      embed: (values: readonly string[]) => {
        embeddingBatches.push([...values]);
        return deterministic.embed(values);
      },
    };
    const base = snapshot("vault-blob-1", "Stable attributed project knowledge.");
    const document = base.documents[0];
    if (document === undefined) throw new Error("Synthetic snapshot document is required.");
    const sourceId = "vault-rename-test";
    const oldExternalId = "example/Connected-Vault:Projects/example/Old.md";
    const newExternalId = "example/Connected-Vault:Projects/example/New.md";
    const oldDocument = {
      ...document,
      source: "vault" as const,
      sourceId,
      externalId: oldExternalId,
      sourceType: "note",
      canonicalUrl:
        "https://github.com/example/Connected-Vault/blob/commit-1/Projects/example/Old.md",
      provenance: { repository: "example/Connected-Vault", path: "Projects/example/Old.md" },
      deliveryProjection: undefined,
    };
    await Effect.runPromise(
      repository.reconcile(
        {
          sourceId,
          source: "vault",
          workspaceId: "workspace-example",
          cursor: "vault-cursor-1",
          scopeHash: "vault-scope",
          mode: "full",
          documents: [oldDocument],
        },
        embeddings,
      ),
    );
    const renamed = await Effect.runPromise(
      repository.reconcile(
        {
          sourceId,
          source: "vault",
          workspaceId: "workspace-example",
          cursor: "vault-cursor-2",
          scopeHash: "vault-scope",
          mode: "delta",
          retiredExternalIds: [oldExternalId],
          documents: [
            {
              ...oldDocument,
              externalId: newExternalId,
              canonicalUrl:
                "https://github.com/example/Connected-Vault/blob/commit-2/Projects/example/New.md",
              provenance: {
                repository: "example/Connected-Vault",
                path: "Projects/example/New.md",
              },
            },
          ],
        },
        embeddings,
      ),
    );

    expect(renamed).toMatchObject({ versionsCreated: 1, itemsDeleted: 1 });
    expect(embeddingBatches).toEqual([["Stable attributed project knowledge."]]);
    const paths = await pool.query<{ readonly external_id: string; readonly active: boolean }>(
      "select external_id, deleted_at is null as active from knowledge_item where source_id = 'vault-rename-test' order by external_id",
    );
    expect(paths.rows).toEqual([
      { external_id: newExternalId, active: true },
      { external_id: oldExternalId, active: false },
    ]);
  });
});

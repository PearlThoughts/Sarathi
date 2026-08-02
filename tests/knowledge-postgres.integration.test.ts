import { count, eq } from "drizzle-orm";
import { Effect } from "effect";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { runDeliverySyncCommand } from "../src/cli/commands/delivery-sync-runtime.ts";
import { runKnowledgeCommand } from "../src/cli/commands/knowledge-runtime.ts";
import { RepositoryError } from "../src/domain/errors.ts";
import { createDeterministicKnowledgeEmbedding } from "../src/infrastructure/model/index.ts";
import {
  applyKnowledgePostgresMigrations,
  createPostgresDeliveryQuerySource,
  createPostgresKnowledgeRepository,
  createPostgresSynchronizationControlRepository,
  openKnowledgePostgresDatabase,
} from "../src/infrastructure/postgres/index.ts";
import {
  deliveryClaimTable,
  deliveryEntityAliasTable,
  deliveryFinanceMetricTable,
  deliveryMetricTable,
  deliveryObjectTable,
  deliveryObservationTable,
  deliveryRelationTable,
} from "../src/infrastructure/postgres/knowledge-schema.ts";
import {
  createDeliveryAssistant,
  type DeliveryEntityCatalog,
  type DeliveryQueryPlan,
  planDeliveryQuestion,
} from "../src/modules/delivery-intelligence/index.ts";
import {
  type KnowledgeEmbeddingPort,
  type KnowledgeRepository,
  type KnowledgeSourceSnapshot,
  type SynchronizationTrigger,
  synchronizationEventDeliveryId,
  synchronizeKnowledgeSource,
} from "../src/modules/knowledge-layer/index.ts";

const databaseUrl = process.env.SARATHI_KNOWLEDGE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

const reconcile = (
  repository: KnowledgeRepository,
  sourceSnapshot: KnowledgeSourceSnapshot,
  embeddings: KnowledgeEmbeddingPort,
  trigger: SynchronizationTrigger = "historical-backfill",
) => repository.reconcile(sourceSnapshot, embeddings, trigger);

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
      sourceCreatedAt: "2026-07-19T00:00:00.000Z",
      sourceUpdatedAt: "2026-07-20T00:00:00.000Z",
      sensitivity: "internal",
      authority: 1,
      provenance: { projectKey: "DEMO" },
      acl: [
        {
          subjectType: "workspace",
          subjectId: "workspace-example",
          effect: "allow",
        },
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
    expect(verification.knowledgeTableCount).toBe(12);
    expect(verification.deliveryTableCount).toBe(8);
    expect(verification.protectedAuditTablesPresent).toEqual([
      "compliance_reminder_audit",
      "compliance_reminder_dry_run_evidence",
      "teams_mention_audit",
    ]);
    await pool.query(
      "truncate table knowledge_sync_event_delivery, knowledge_sync_subscription, knowledge_sync_lease, knowledge_sync_run, knowledge_embedding_cache, knowledge_source cascade",
    );
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
      reconcile(
        repository,
        snapshot("v1", "The builder is in QA with approved rollout risk."),
        embeddings,
      ),
    );
    const replay = await Effect.runPromise(
      reconcile(
        repository,
        snapshot("v1", "The builder is in QA with approved rollout risk."),
        embeddings,
      ),
    );
    expect(first).toMatchObject({
      versionsCreated: 1,
      passagesActive: 1,
      itemsDeleted: 0,
    });
    expect(replay).toMatchObject({
      versionsCreated: 0,
      passagesActive: 1,
      itemsDeleted: 0,
    });
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
      reconcile(
        repository,
        {
          ...projectionTimestampChanged,
          cursor: "cursor-v1-projection-timestamp-changed",
          documents: [
            {
              ...projectionDocument,
              deliveryProjection: {
                ...projection,
                objects: projection.objects.map((object) =>
                  object.externalKey === "DEMO-635"
                    ? { ...object, observedAt: "2026-07-19T10:00:00.000Z" }
                    : object,
                ),
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
    const observedObjects = await opened.database
      .select({ observedAt: deliveryObjectTable.observedAt })
      .from(deliveryObjectTable)
      .where(eq(deliveryObjectTable.externalKey, "DEMO-635"));
    expect(new Date(observedObjects[0]?.observedAt ?? 0).toISOString()).toBe(
      "2026-07-19T10:00:00.000Z",
    );
    const provenanceChanged = snapshot("v1", "The builder is in QA with approved rollout risk.");
    const provenanceDocument = provenanceChanged.documents[0];
    if (provenanceDocument === undefined) throw new Error("Synthetic document is required.");
    const provenanceReplay = await Effect.runPromise(
      reconcile(
        repository,
        {
          ...provenanceChanged,
          cursor: "cursor-v1-provenance-changed",
          documents: [
            {
              ...provenanceDocument,
              provenance: {
                ...provenanceDocument.provenance,
                revision: "new-repository-commit",
              },
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
    expect(authorized[0]).toMatchObject({
      source: "jira",
      sourceId: "DEMO-635",
    });
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
      reconcile(
        repository,
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
      reconcile(
        repository,
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
      reconcile(
        repository,
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
      reconcile(
        repository,
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
    expect(state.rows[0]).toMatchObject({
      deleted: true,
      active_passages: "0",
      tombstones: "3",
    });
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
          knowledgeTableCount: 12,
          appliedMigrationCount: 8,
          checkpoints: [
            expect.objectContaining({
              sourceId: "jira-example-test",
              documentsObserved: 0,
              itemsDeleted: 1,
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
    expect(JSON.stringify(cliStatus)).not.toContain("cursor-deleted");
  });

  test("rejects duplicate source locators before persistence", async () => {
    const repository = createPostgresKnowledgeRepository(opened.database);
    const embeddings = createDeterministicKnowledgeEmbedding();
    const base = snapshot("duplicate-locators", "First status section.");
    const document = base.documents[0];
    if (document === undefined) throw new Error("Synthetic snapshot document is required.");

    await expect(
      Effect.runPromise(
        reconcile(
          repository,
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

  test("records event and reconciliation health from the synchronization trigger", async () => {
    const repository = createPostgresKnowledgeRepository(opened.database);
    const embeddings = createDeterministicKnowledgeEmbedding();
    const sourceId = "teams-checkpoint-trigger-test";
    const workspaceId = "workspace-checkpoint-trigger";
    const baseline = {
      sourceId,
      source: "teams" as const,
      workspaceId,
      cursor: "cursor-baseline",
      scopeHash: "sha256-checkpoint-trigger-scope",
      documents: [],
    };
    await Effect.runPromise(reconcile(repository, baseline, embeddings, "historical-backfill"));

    const previousEventAt = "2026-01-01T00:00:00.000Z";
    const previousReconciledAt = "2026-01-02T00:00:00.000Z";
    await pool.query(
      "update knowledge_sync_checkpoint set last_event_at = $1, last_reconciled_at = $2 where source_id = $3 and workspace_id = $4",
      [previousEventAt, previousReconciledAt, sourceId, workspaceId],
    );

    await Effect.runPromise(
      reconcile(
        repository,
        { ...baseline, cursor: "cursor-event", mode: "delta" },
        embeddings,
        "source-event",
      ),
    );
    const eventCheckpoint = await pool.query<{
      readonly last_event_at: Date;
      readonly last_reconciled_at: Date;
    }>(
      "select last_event_at, last_reconciled_at from knowledge_sync_checkpoint where source_id = $1 and workspace_id = $2",
      [sourceId, workspaceId],
    );
    const eventAt = eventCheckpoint.rows[0]?.last_event_at;
    const reconciledAfterEvent = eventCheckpoint.rows[0]?.last_reconciled_at;
    expect(eventAt?.toISOString()).not.toBe(previousEventAt);
    expect(reconciledAfterEvent?.toISOString()).toBe(previousReconciledAt);

    await Effect.runPromise(
      reconcile(
        repository,
        { ...baseline, cursor: "cursor-reconciliation", mode: "delta" },
        embeddings,
        "hourly-reconciliation",
      ),
    );
    const reconciliationCheckpoint = await pool.query<{
      readonly last_event_at: Date;
      readonly last_reconciled_at: Date;
    }>(
      "select last_event_at, last_reconciled_at from knowledge_sync_checkpoint where source_id = $1 and workspace_id = $2",
      [sourceId, workspaceId],
    );
    expect(reconciliationCheckpoint.rows[0]?.last_event_at.toISOString()).toBe(
      eventAt?.toISOString(),
    );
    expect(reconciliationCheckpoint.rows[0]?.last_reconciled_at.toISOString()).not.toBe(
      previousReconciledAt,
    );
  });

  test("resumes embedding from durable cached chunks after interruption", async () => {
    const repository = createPostgresKnowledgeRepository(opened.database);
    const deterministic = createDeterministicKnowledgeEmbedding();
    const passages = Array.from({ length: 300 }, (_, ordinal) => ({
      kind: "code",
      locator: `#symbol-${ordinal}`,
      ordinal,
      title: `Symbol ${ordinal}`,
      body: `export const symbol${ordinal} = "delivery capability ${ordinal}";`,
      contentHash: `sha256-restart-safe-${ordinal}`,
    }));
    const largeSnapshot: KnowledgeSourceSnapshot = {
      sourceId: "github-restart-safe-test",
      source: "github",
      workspaceId: "workspace-restart-safe",
      cursor: "cursor-restart-safe",
      scopeHash: "sha256-restart-safe-scope",
      documents: [
        {
          source: "github",
          sourceId: "github-restart-safe-test",
          workspaceId: "workspace-restart-safe",
          externalId: "example/repository:src/capability.ts",
          sourceType: "code",
          sourceVersion: "sha256-revision",
          canonicalUrl:
            "https://github.com/example/repository/blob/sha256-revision/src/capability.ts",
          title: "src/capability.ts",
          sourceUpdatedAt: "2026-07-25T00:00:00.000Z",
          sensitivity: "internal",
          authority: 0.86,
          provenance: { repository: "example/repository" },
          acl: [
            {
              subjectType: "workspace",
              subjectId: "workspace-restart-safe",
              effect: "allow",
            },
          ],
          passages,
        },
      ],
    };
    let failedAttempt = 0;
    const interruptedEmbeddings = {
      ...deterministic,
      embed: (values: readonly string[]) => {
        failedAttempt += 1;
        return failedAttempt === 1
          ? deterministic.embed(values)
          : Effect.fail(
              new RepositoryError({
                message: "Synthetic provider interruption.",
                operation: "knowledge-embedding.synthetic-interruption",
              }),
            );
      },
    };

    await expect(
      Effect.runPromise(reconcile(repository, largeSnapshot, interruptedEmbeddings)),
    ).rejects.toThrow("Knowledge embedding progress could not be cached");
    const cachedAfterInterruption = await pool.query<{ readonly count: string }>(
      "select count(*) from knowledge_embedding_cache where workspace_id = 'workspace-restart-safe' and source_id = 'github-restart-safe-test'",
    );
    expect(cachedAfterInterruption.rows).toEqual([{ count: "256" }]);
    const interruptedStatus = await runKnowledgeCommand(["status"], {
      SARATHI_STRATEGY_DATABASE_URL: databaseUrl,
    });
    expect(interruptedStatus).toMatchObject({
      exitCode: 0,
      output: {
        status: {
          embeddingCacheProgress: [
            expect.objectContaining({
              workspaceId: "workspace-restart-safe",
              sourceId: "github-restart-safe-test",
              vectorsCached: 256,
            }),
          ],
        },
      },
    });
    expect(JSON.stringify(interruptedStatus)).not.toContain("delivery capability");

    const retryBatches: string[][] = [];
    const retryEmbeddings = {
      ...deterministic,
      embed: (values: readonly string[]) => {
        retryBatches.push([...values]);
        return deterministic.embed(values);
      },
    };
    const summary = await Effect.runPromise(reconcile(repository, largeSnapshot, retryEmbeddings));

    expect(summary).toMatchObject({
      documentsObserved: 1,
      versionsCreated: 1,
      passagesActive: 300,
    });
    expect(retryBatches).toHaveLength(1);
    expect(retryBatches[0]).toHaveLength(44);
    const [cacheAfterSuccess, projectionsAfterSuccess] = await Promise.all([
      pool.query<{ readonly count: string }>(
        "select count(*) from knowledge_embedding_cache where workspace_id = 'workspace-restart-safe' and source_id = 'github-restart-safe-test'",
      ),
      pool.query<{ readonly count: string }>(
        "select count(*) from knowledge_projection where workspace_id = 'workspace-restart-safe'",
      ),
    ]);
    expect(cacheAfterSuccess.rows).toEqual([{ count: "0" }]);
    expect(projectionsAfterSuccess.rows).toEqual([{ count: "300" }]);
    const completedStatus = await runKnowledgeCommand(["status"], {
      SARATHI_STRATEGY_DATABASE_URL: databaseUrl,
    });
    expect(completedStatus).toMatchObject({
      exitCode: 0,
      output: { status: { embeddingCacheProgress: [] } },
    });
  });

  test("converges every continuous connector after duplicate, out-of-order, missed, expired, and deleted state", async () => {
    const repository = createPostgresKnowledgeRepository(opened.database);
    const control = createPostgresSynchronizationControlRepository(opened.database);
    const deterministic = createDeterministicKnowledgeEmbedding();
    const embeddingBatches: string[][] = [];
    const embeddings = {
      ...deterministic,
      embed: (values: readonly string[]) => {
        embeddingBatches.push([...values]);
        return deterministic.embed(values);
      },
    };
    const workspaceId = "connector-convergence";
    const sourceKinds = ["jira", "vault", "github", "teams"] as const;
    const canonicalBase = {
      jira: "https://jira.example/browse",
      vault: "https://github.com/example/vault/blob/main",
      github: "https://github.com/example/repository/blob/main",
      teams: "https://teams.microsoft.com/l/message",
    } satisfies Record<(typeof sourceKinds)[number], string>;
    const connectorSnapshot = (
      source: (typeof sourceKinds)[number],
      revision: "bootstrap" | "event" | "repair",
    ): KnowledgeSourceSnapshot => {
      const sourceId = `${source}-convergence`;
      const changed = revision !== "bootstrap";
      const documents = [
        {
          source,
          sourceId,
          workspaceId,
          externalId: `${source}-current`,
          sourceType: source === "github" ? "code" : source === "teams" ? "message" : "record",
          sourceVersion: changed ? "v2" : "v1",
          canonicalUrl: `${canonicalBase[source]}/${source}-current`,
          title: `${source} current delivery record`,
          sourceUpdatedAt: changed ? "2026-07-22T10:30:00.000Z" : "2026-07-22T10:00:00.000Z",
          sensitivity: "internal" as const,
          authority: 0.9,
          provenance: { connector: source, revision },
          acl: [
            {
              effect: "allow" as const,
              subjectType: "workspace" as const,
              subjectId: workspaceId,
            },
          ],
          passages: [
            {
              kind: "summary",
              locator: "#summary",
              ordinal: 0,
              title: "Delivery summary",
              body: changed
                ? `${source} changed delivery state`
                : `${source} initial delivery state`,
              contentHash: `sha256-${source}-${changed ? "changed" : "initial"}`,
            },
          ],
        },
        ...(revision === "repair"
          ? []
          : [
              {
                source,
                sourceId,
                workspaceId,
                externalId: `${source}-deleted`,
                sourceType: "record",
                sourceVersion: "v1",
                canonicalUrl: `${canonicalBase[source]}/${source}-deleted`,
                title: `${source} record deleted upstream`,
                sourceUpdatedAt: "2026-07-22T10:00:00.000Z",
                sensitivity: "internal" as const,
                authority: 0.9,
                provenance: { connector: source, revision: "bootstrap" },
                acl: [
                  {
                    effect: "allow" as const,
                    subjectType: "workspace" as const,
                    subjectId: workspaceId,
                  },
                ],
                passages: [
                  {
                    kind: "summary",
                    locator: "#summary",
                    ordinal: 0,
                    title: "Deleted upstream",
                    body: `${source} content awaiting deletion repair`,
                    contentHash: `sha256-${source}-deleted`,
                  },
                ],
              },
            ]),
      ];
      return {
        sourceId,
        source,
        workspaceId,
        cursor: `${source}-${revision}`,
        scopeHash: `sha256-${source}-scope-${revision === "repair" ? "reduced" : "full"}`,
        mode: revision === "event" ? "delta" : "full",
        retiredExternalIds: [],
        documents,
      };
    };

    for (const source of sourceKinds) {
      const sourceId = `${source}-convergence`;
      const bootstrap = await Effect.runPromise(
        reconcile(repository, connectorSnapshot(source, "bootstrap"), embeddings),
      );
      expect(bootstrap).toMatchObject({
        documentsObserved: 2,
        passagesActive: 2,
      });

      const newerIdentity = {
        workspaceId,
        sourceId,
        source,
        providerEventId: `${source}-event-newer`,
      };
      const newer = {
        ...newerIdentity,
        id: synchronizationEventDeliveryId(newerIdentity),
        payloadHash: `sha256-${source}-newer-payload`,
        sourceVersion: "v2",
        sourceOccurredAt: "2026-07-22T10:30:00.000Z",
        receivedAt: "2026-07-22T10:31:00.000Z",
        status: "received" as const,
        attemptCount: 0,
      };
      expect(await Effect.runPromise(control.registerEvent(newer))).toMatchObject({
        disposition: "accepted",
      });
      expect(
        await Effect.runPromise(
          control.registerEvent({
            ...newer,
            payloadHash: "sha256-replayed-body",
          }),
        ),
      ).toMatchObject({
        disposition: "duplicate",
        delivery: { payloadHash: `sha256-${source}-newer-payload` },
      });
      const olderIdentity = {
        ...newerIdentity,
        providerEventId: `${source}-event-older`,
      };
      const older = {
        ...olderIdentity,
        id: synchronizationEventDeliveryId(olderIdentity),
        payloadHash: `sha256-${source}-older-payload`,
        sourceVersion: "v1",
        sourceOccurredAt: "2026-07-22T09:00:00.000Z",
        receivedAt: "2026-07-22T10:32:00.000Z",
        status: "received" as const,
        attemptCount: 0,
      };
      expect(await Effect.runPromise(control.registerEvent(older))).toMatchObject({
        disposition: "accepted",
      });

      const eventResult = await Effect.runPromise(
        reconcile(repository, connectorSnapshot(source, "event"), embeddings),
      );
      expect(eventResult).toMatchObject({
        documentsObserved: 2,
        itemsDeleted: 0,
      });
      await Effect.runPromise(
        control.updateEvent({
          ...newer,
          status: "succeeded",
          attemptCount: 1,
          processedAt: "2026-07-22T10:33:00.000Z",
        }),
      );

      const subscription = {
        id: `${source}-subscription`,
        workspaceId,
        sourceId,
        source,
        provider: source === "teams" ? "microsoft-graph" : `${source}-provider`,
        resourceHash: `sha256-${source}-resource`,
        status: "expired" as const,
        expiresAt: "2026-07-22T10:00:00.000Z",
        retryCount: 1,
        failureClass: "subscription-expired" as const,
        updatedAt: "2026-07-22T10:34:00.000Z",
      };
      await Effect.runPromise(control.saveSubscription(subscription));
      await Effect.runPromise(
        control.saveSubscription({
          ...subscription,
          id: `${source}-subscription-renewed`,
          status: "active",
          expiresAt: "2026-07-23T10:00:00.000Z",
          renewedAt: "2026-07-22T10:35:00.000Z",
          nextRenewalAt: "2026-07-23T09:45:00.000Z",
          retryCount: 0,
          failureClass: undefined,
          updatedAt: "2026-07-22T10:35:00.000Z",
        }),
      );
      expect(await Effect.runPromise(control.readSubscriptions(workspaceId, sourceId))).toEqual([
        expect.objectContaining({
          id: `${source}-subscription-renewed`,
          resourceHash: `sha256-${source}-resource`,
          status: "active",
        }),
      ]);

      const firstLease = {
        workspaceId,
        sourceId,
        operation: "hourly-reconciliation" as const,
        ownerId: `${source}-worker-1`,
        acquiredAt: "2026-07-22T11:00:00.000Z",
        heartbeatAt: "2026-07-22T11:00:00.000Z",
        expiresAt: "2026-07-22T11:05:00.000Z",
      };
      expect(await Effect.runPromise(control.acquireLease(firstLease))).toBe(true);
      expect(
        await Effect.runPromise(
          control.acquireLease({
            ...firstLease,
            ownerId: `${source}-worker-2`,
            acquiredAt: "2026-07-22T11:01:00.000Z",
            heartbeatAt: "2026-07-22T11:01:00.000Z",
            expiresAt: "2026-07-22T11:06:00.000Z",
          }),
        ),
      ).toBe(false);
      const repairLease = {
        ...firstLease,
        ownerId: `${source}-worker-2`,
        acquiredAt: "2026-07-22T11:05:00.000Z",
        heartbeatAt: "2026-07-22T11:05:00.000Z",
        expiresAt: "2026-07-22T11:10:00.000Z",
      };
      expect(await Effect.runPromise(control.acquireLease(repairLease))).toBe(true);

      const run = {
        id: `${source}-repair-run`,
        workspaceId,
        sourceId,
        trigger: "hourly-reconciliation" as const,
        status: "running" as const,
        cursorBefore: `${source}-event`,
        scopeHash: `sha256-${source}-scope-reduced`,
        startedAt: "2026-07-22T11:05:00.000Z",
        attemptCount: 1,
      };
      await Effect.runPromise(control.startRun(run));
      const repair = await Effect.runPromise(
        reconcile(repository, connectorSnapshot(source, "repair"), embeddings),
      );
      expect(repair).toMatchObject({
        documentsObserved: 1,
        passagesActive: 1,
        itemsDeleted: 1,
      });
      await Effect.runPromise(
        control.completeRun({
          ...run,
          status: "succeeded",
          cursorAfter: `${source}-repair`,
          newestSourceUpdatedAt: "2026-07-22T10:30:00.000Z",
          lagSeconds: 2_100,
          completedAt: "2026-07-22T11:05:30.000Z",
        }),
      );
      await Effect.runPromise(control.releaseLease(repairLease));

      const status = await Effect.runPromise(control.readStatus(workspaceId, sourceId));
      expect(status).toMatchObject({
        checkpoint: {
          cursor: `${source}-repair`,
          indexedSourceRevision: `${source}-repair`,
          scopeHash: `sha256-${source}-scope-reduced`,
        },
        subscription: {
          id: `${source}-subscription-renewed`,
          status: "active",
          retryCount: 0,
        },
        latestRun: {
          trigger: "hourly-reconciliation",
          status: "succeeded",
          cursorAfter: `${source}-repair`,
        },
      });
      expect(status.activeLease).toBeUndefined();
      expect(JSON.stringify(status)).not.toContain("changed delivery state");
      expect(JSON.stringify(status)).not.toContain("replayed-body");
    }

    expect(embeddingBatches.map((batch) => batch.length)).toEqual([2, 1, 2, 1, 2, 1, 2, 1]);
    const active = await pool.query<{
      readonly source_kind: string;
      readonly active: string;
    }>(
      "select s.kind as source_kind, count(*) filter (where p.active)::text as active from knowledge_source s join knowledge_item i on i.source_id = s.id join knowledge_passage p on p.item_id = i.id where s.workspace_id = $1 group by s.kind order by s.kind",
      [workspaceId],
    );
    expect(active.rows).toEqual([
      { source_kind: "github", active: "1" },
      { source_kind: "jira", active: "1" },
      { source_kind: "teams", active: "1" },
      { source_kind: "vault", active: "1" },
    ]);
  });

  test("runs a checkpointed hourly operation through the durable synchronization service", async () => {
    const repository = createPostgresKnowledgeRepository(opened.database);
    const control = createPostgresSynchronizationControlRepository(opened.database);
    const embeddings = createDeterministicKnowledgeEmbedding();
    const initial = snapshot("sync-operation-v1", "Initial durable synchronization state.");
    const sourceId = "sync-operation-jira";
    const scopedInitial = {
      ...initial,
      sourceId,
      cursor: "sync-operation-cursor-1",
      documents: initial.documents.map((document) => ({ ...document, sourceId })),
    };
    await Effect.runPromise(reconcile(repository, scopedInitial, embeddings));
    const readSnapshot = vi.fn((_workspaceId: string, _previousCursor?: string) =>
      Effect.succeed({
        ...scopedInitial,
        cursor: "sync-operation-cursor-2",
        mode: "delta" as const,
        documents: [],
        retiredExternalIds: [],
      }),
    );
    const times = ["2026-07-22T11:00:00.000Z", "2026-07-22T11:00:05.000Z"];
    const outcome = await Effect.runPromise(
      synchronizeKnowledgeSource(
        {
          workspaceId: "workspace-example",
          source: {
            source: "jira",
            sourceId,
            reader: { readSnapshot },
          },
          trigger: "hourly-reconciliation",
          ownerId: "integration-worker",
          leaseSeconds: 300,
          now: () => times.shift() ?? "2026-07-22T11:00:05.000Z",
        },
        repository,
        embeddings,
        control,
      ),
    );
    expect(readSnapshot).toHaveBeenCalledWith("workspace-example", "sync-operation-cursor-1");
    expect(outcome).toMatchObject({
      disposition: "succeeded",
      summary: { cursor: "sync-operation-cursor-2", versionsCreated: 0 },
    });
    await expect(
      Effect.runPromise(control.readStatus("workspace-example", sourceId)),
    ).resolves.toMatchObject({
      checkpoint: { cursor: "sync-operation-cursor-2" },
      latestRun: {
        trigger: "hourly-reconciliation",
        status: "succeeded",
        cursorAfter: "sync-operation-cursor-2",
      },
    });
    const status = await runDeliverySyncCommand(["status", "jira"], {
      SARATHI_STRATEGY_DATABASE_URL: databaseUrl,
      SARATHI_KNOWLEDGE_WORKSPACE_ID: "workspace-example",
      SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON: JSON.stringify({ sourceId }),
    });
    expect(status).toMatchObject({
      exitCode: 0,
      output: {
        ok: true,
        operation: "delivery-sync-status",
        statuses: [{ source: "jira", freshness: { status: "current" } }],
      },
    });
    expect(JSON.stringify(status)).not.toContain("sync-operation-cursor");
    expect(JSON.stringify(status)).not.toContain("Initial durable synchronization state");
    await expect(
      runDeliverySyncCommand(["status", "vault"], {
        SARATHI_STRATEGY_DATABASE_URL: databaseUrl,
        SARATHI_KNOWLEDGE_WORKSPACE_ID: "workspace-example",
        SARATHI_KNOWLEDGE_VAULT_SOURCE_ID: "missing-vault-checkpoint",
      }),
    ).resolves.toMatchObject({
      exitCode: 1,
      output: {
        ok: false,
        statuses: [{ source: "vault", freshness: { status: "unavailable" } }],
      },
    });
  });

  test("starts synchronization control before a new content source has been registered", async () => {
    const repository = createPostgresKnowledgeRepository(opened.database);
    const control = createPostgresSynchronizationControlRepository(opened.database);
    const embeddings = createDeterministicKnowledgeEmbedding();
    const sourceId = "first-run-github";
    const initial = snapshot("first-run-github-v1", "A newly configured GitHub source.");
    const scopedInitial = {
      ...initial,
      source: "github" as const,
      sourceId,
      cursor: "first-run-github-cursor-1",
      documents: initial.documents.map((document) => ({
        ...document,
        source: "github" as const,
        sourceId,
      })),
    };
    const before = await pool.query<{ readonly count: string }>(
      "select count(*)::text as count from knowledge_source where id = $1",
      [sourceId],
    );
    expect(before.rows).toEqual([{ count: "0" }]);

    const outcome = await Effect.runPromise(
      synchronizeKnowledgeSource(
        {
          workspaceId: "workspace-example",
          source: {
            source: "github",
            sourceId,
            reader: {
              readSnapshot: () => Effect.succeed(scopedInitial),
            },
          },
          trigger: "historical-backfill",
          ownerId: "first-run-integration-worker",
          leaseSeconds: 300,
          now: () => "2026-07-23T06:30:00.000Z",
        },
        repository,
        embeddings,
        control,
      ),
    );

    expect(outcome).toMatchObject({
      disposition: "succeeded",
      summary: {
        cursor: "first-run-github-cursor-1",
        documentsObserved: 1,
      },
    });
    const after = await pool.query<{ readonly count: string }>(
      "select count(*)::text as count from knowledge_source where id = $1",
      [sourceId],
    );
    expect(after.rows).toEqual([{ count: "1" }]);
    await expect(
      Effect.runPromise(control.readStatus("workspace-example", sourceId)),
    ).resolves.toMatchObject({
      checkpoint: { cursor: "first-run-github-cursor-1" },
      latestRun: {
        trigger: "historical-backfill",
        status: "succeeded",
      },
    });
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
      provenance: {
        repository: "example/Connected-Vault",
        path: "Projects/example/Old.md",
      },
      deliveryProjection: undefined,
    };
    await Effect.runPromise(
      reconcile(
        repository,
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
      reconcile(
        repository,
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
    const paths = await pool.query<{
      readonly external_id: string;
      readonly active: boolean;
    }>(
      "select external_id, deleted_at is null as active from knowledge_item where source_id = 'vault-rename-test' order by external_id",
    );
    expect(paths.rows).toEqual([
      { external_id: newExternalId, active: true },
      { external_id: oldExternalId, active: false },
    ]);
  });

  test("suppresses superseded attributed claims before egress and restores them if the correction is deleted", async () => {
    const repository = createPostgresKnowledgeRepository(opened.database);
    const embeddings = createDeterministicKnowledgeEmbedding();
    const base = snapshot("attributed-base", "Attributed delivery context.");
    const template = base.documents[0];
    if (template === undefined) throw new Error("Synthetic snapshot document is required.");
    const sourceId = "vault-correction-test";
    const attributedDocument = (
      externalId: string,
      value: string,
      externalAssertionId: string,
      supersedesAssertionIds: readonly string[],
      acl: KnowledgeSourceSnapshot["documents"][number]["acl"],
    ): KnowledgeSourceSnapshot["documents"][number] => ({
      ...template,
      source: "vault",
      sourceId,
      externalId,
      sourceVersion: externalAssertionId,
      canonicalUrl: `https://github.com/example/Connected-Vault/blob/commit/${externalId}.md`,
      provenance: { path: `${externalId}.md` },
      acl,
      passages: [
        {
          kind: "heading",
          locator: "#status",
          ordinal: 0,
          title: "Status",
          body: value,
          contentHash: `sha256-${externalAssertionId}`,
        },
      ],
      deliveryProjection: {
        objects: [],
        relations: [],
        observations: [],
        metrics: [],
        claims: [
          {
            subjectKey: "product-builder",
            predicate: "delivery.status",
            value,
            assertedBy: "entra:person-1",
            externalAssertionId,
            supersedesAssertionIds,
            confidence: 0.9,
            assertionSchemaVersion: 1,
            assertedAt: "2026-07-22T10:00:00.000Z",
            sensitivity: "internal",
            authority: 0.9,
          },
        ],
      },
    });
    const workspaceAcl = [
      {
        effect: "allow" as const,
        subjectType: "workspace" as const,
        subjectId: "workspace-example",
      },
    ];
    const correctionAcl = [
      {
        effect: "allow" as const,
        subjectType: "actor" as const,
        subjectId: "correction-author",
      },
    ];
    const oldExternalId = "context-old";
    const correctionExternalId = "context-correction";
    await Effect.runPromise(
      reconcile(
        repository,
        {
          sourceId,
          source: "vault",
          workspaceId: "workspace-example",
          cursor: "correction-cursor-1",
          scopeHash: "correction-scope",
          mode: "full",
          documents: [
            attributedDocument(
              oldExternalId,
              "At risk",
              "delivery/product-builder/old:status:status",
              [],
              workspaceAcl,
            ),
            attributedDocument(
              correctionExternalId,
              "Ready",
              "delivery/product-builder/new:status:status",
              ["delivery/product-builder/old:status:status"],
              correctionAcl,
            ),
          ],
        },
        embeddings,
      ),
    );
    const plan: DeliveryQueryPlan = {
      version: 1,
      intents: ["general"],
      operations: [
        {
          id: "attributed-status",
          purpose: "general",
          select: "claims",
          predicates: [
            {
              field: "subjectKey",
              operator: "equals",
              value: "product-builder",
            },
          ],
          limit: 10,
        },
      ],
      answerMode: "deterministic",
      maximumLines: 3,
      requiresFinance: false,
    };
    const source = createPostgresDeliveryQuerySource(opened.database);
    const context = {
      workspaceId: "workspace-example",
      actorId: "delivery-member",
      maximumSensitivity: "internal" as const,
      financeAccess: false,
      requestedAt: "2026-07-22T12:00:00.000Z",
      timeZone: "Asia/Kolkata",
      deadlineAt: "2026-07-22T12:00:08.000Z",
      question: "What is the Product Builder status?",
    };

    const unauthorized = await Effect.runPromise(source.execute(context, plan));
    expect(unauthorized.items).toEqual([]);
    const authorized = await Effect.runPromise(
      source.execute({ ...context, actorId: "correction-author" }, plan),
    );
    expect(authorized.items.map(({ summary }) => summary)).toEqual([
      "product-builder delivery.status: Ready",
    ]);

    await Effect.runPromise(
      reconcile(
        repository,
        {
          sourceId,
          source: "vault",
          workspaceId: "workspace-example",
          cursor: "correction-cursor-2",
          scopeHash: "correction-scope",
          mode: "delta",
          retiredExternalIds: [correctionExternalId],
          documents: [],
        },
        embeddings,
      ),
    );
    const restored = await Effect.runPromise(source.execute(context, plan));
    expect(restored.items.map(({ summary }) => summary)).toEqual([
      "product-builder delivery.status: At risk",
    ]);
  });

  test("joins source-qualified aliases onto one canonical entity with explicit source timestamps", async () => {
    const entityCatalog: DeliveryEntityCatalog = {
      version: 1,
      entities: [
        {
          kind: "module",
          canonicalKey: "product-builder",
          title: "Product Builder",
          aliases: [
            { source: "github", value: "Puck" },
            { source: "jira", value: "Atlas Site Composer" },
            { value: "Product Builder" },
          ],
        },
      ],
    };
    const repository = createPostgresKnowledgeRepository(opened.database, {
      entityCatalog,
    });
    const embeddings = createDeterministicKnowledgeEmbedding();
    const workspaceId = "workspace-canonical-alias";
    const acl = [
      {
        effect: "allow" as const,
        subjectType: "workspace" as const,
        subjectId: workspaceId,
      },
    ];
    const sourceSnapshot = (
      source: "github" | "jira",
      sourceId: string,
      externalId: string,
      title: string,
      value: string,
      sourceCreatedAt: string,
      sourceUpdatedAt: string,
    ): KnowledgeSourceSnapshot => ({
      source,
      sourceId,
      workspaceId,
      cursor: `${sourceId}-cursor`,
      scopeHash: `${sourceId}-scope`,
      mode: "full",
      documents: [
        {
          source,
          sourceId,
          workspaceId,
          externalId,
          sourceType: source === "github" ? "repository" : "issue",
          sourceVersion: "v1",
          canonicalUrl: `https://example.test/${source}/${externalId}`,
          title,
          sourceCreatedAt,
          sourceUpdatedAt,
          sensitivity: "internal",
          authority: 1,
          provenance: {},
          acl,
          passages: [],
          deliveryProjection: {
            objects: [
              {
                kind: "module",
                externalKey: externalId,
                title,
                attributes: {},
                sensitivity: "internal",
              },
            ],
            relations: [],
            observations: [],
            metrics: [],
            claims: [
              {
                subject: { kind: "module", externalKey: externalId },
                subjectKey: externalId,
                predicate: "delivery.status",
                value,
                assertedAt: sourceUpdatedAt,
                sensitivity: "internal",
                authority: 1,
              },
            ],
          },
        },
      ],
    });

    await Effect.runPromise(
      reconcile(
        repository,
        sourceSnapshot(
          "github",
          "github-canonical-alias",
          "puck-repository",
          "Puck",
          "ready",
          "2026-01-02T08:00:00.000Z",
          "2026-07-22T08:00:00.000Z",
        ),
        embeddings,
      ),
    );
    await Effect.runPromise(
      reconcile(
        repository,
        sourceSnapshot(
          "jira",
          "jira-canonical-alias",
          "MWB",
          "Atlas Site Composer",
          "blocked",
          "2026-02-03T09:00:00.000Z",
          "2026-07-22T09:00:00.000Z",
        ),
        embeddings,
      ),
    );

    const objects = await pool.query<{
      readonly canonical_key: string;
      readonly source_created_at: Date;
      readonly source_updated_at: Date;
      readonly indexed_at: Date;
    }>(
      "select canonical_key, source_created_at, source_updated_at, indexed_at from delivery_object where workspace_id = $1 and active = true order by source_kind",
      [workspaceId],
    );
    expect(objects.rows).toHaveLength(2);
    expect(new Set(objects.rows.map(({ canonical_key }) => canonical_key))).toEqual(
      new Set(["module:product-builder"]),
    );
    expect(objects.rows.map(({ source_created_at }) => source_created_at.toISOString())).toEqual([
      "2026-01-02T08:00:00.000Z",
      "2026-02-03T09:00:00.000Z",
    ]);
    expect(
      objects.rows.every(
        ({ source_updated_at, indexed_at }) => indexed_at.getTime() >= source_updated_at.getTime(),
      ),
    ).toBe(true);

    const aliases = await opened.database
      .select({
        alias: deliveryEntityAliasTable.alias,
        canonicalKey: deliveryEntityAliasTable.canonicalKey,
      })
      .from(deliveryEntityAliasTable)
      .where(eq(deliveryEntityAliasTable.workspaceId, workspaceId));
    expect(new Set(aliases.map(({ canonicalKey }) => canonicalKey))).toEqual(
      new Set(["module:product-builder"]),
    );
    expect(aliases.map(({ alias }) => alias)).toEqual(
      expect.arrayContaining(["Puck", "Atlas Site Composer", "Product Builder"]),
    );

    const conflictPlan: DeliveryQueryPlan = {
      version: 1,
      intents: ["conflicts"],
      operations: [
        {
          id: "canonical-module-conflict",
          purpose: "conflicts",
          select: "conflicts",
          predicates: [
            {
              field: "subjectKey",
              operator: "equals",
              value: "module:product-builder",
            },
          ],
          limit: 10,
        },
      ],
      answerMode: "deterministic",
      maximumLines: 5,
      requiresFinance: false,
    };
    const conflicts = await Effect.runPromise(
      createPostgresDeliveryQuerySource(opened.database).execute(
        {
          workspaceId,
          actorId: "delivery-member",
          maximumSensitivity: "internal",
          financeAccess: false,
          requestedAt: "2026-07-22T12:00:00.000Z",
          timeZone: "Asia/Kolkata",
          deadlineAt: "2026-07-22T12:00:08.000Z",
          question: "Where do sources disagree about Product Builder?",
        },
        conflictPlan,
      ),
    );
    expect(conflicts.conflicts).toHaveLength(1);
    expect(conflicts.conflicts[0]).toMatchObject({
      subjectKey: "module:product-builder",
      predicate: "delivery.status",
    });
    expect(new Set(conflicts.conflicts[0]?.claims.map(({ source }) => source.source))).toEqual(
      new Set(["github", "jira"]),
    );
  });

  test("attributes GitHub observations to the authorized canonical person", async () => {
    const workspaceId = "workspace-github-observation-owner";
    const actorExternalKey = "github:delivery-owner-login";
    const repository = createPostgresKnowledgeRepository(opened.database, {
      entityCatalog: {
        version: 1,
        entities: [
          {
            kind: "person",
            canonicalKey: "delivery-owner",
            title: "Delivery Owner",
            aliases: [{ source: "github", value: "delivery-owner-login" }],
          },
        ],
      },
    });
    await Effect.runPromise(
      reconcile(
        repository,
        {
          sourceId: "github-observation-owner",
          source: "github",
          workspaceId,
          cursor: "owner-cursor",
          scopeHash: "owner-scope",
          mode: "full",
          documents: [
            {
              source: "github",
              sourceId: "github-observation-owner",
              workspaceId,
              externalId: "example/repo:activity:pull_request:42",
              sourceType: "pull_request",
              sourceVersion: "v1",
              canonicalUrl: "https://github.com/example/repo/pull/42",
              title: "PR #42: Ship attributed delivery",
              sourceCreatedAt: "2026-07-20T08:00:00.000Z",
              sourceUpdatedAt: "2026-07-20T09:00:00.000Z",
              sensitivity: "internal",
              authority: 0.95,
              provenance: {},
              acl: [
                {
                  subjectType: "workspace",
                  subjectId: workspaceId,
                  effect: "allow",
                },
              ],
              passages: [],
              deliveryProjection: {
                objects: [
                  {
                    kind: "person",
                    externalKey: actorExternalKey,
                    title: "delivery-owner-login",
                    lifecycleState: "active",
                    attributes: { provider: "github" },
                    sensitivity: "internal",
                  },
                ],
                relations: [],
                observations: [
                  {
                    kind: "pull_request",
                    externalId: "42",
                    actorExternalKey,
                    summary: "PR #42: Ship attributed delivery",
                    dedupeKey: "github:example/repo:pull_request:42",
                    occurredAt: "2026-07-20T09:00:00.000Z",
                    citationUrl: "https://github.com/example/repo/pull/42",
                    sensitivity: "internal",
                    authority: 0.95,
                  },
                ],
                metrics: [],
                claims: [],
              },
            },
          ],
        },
        createDeterministicKnowledgeEmbedding(),
      ),
    );
    const plan: DeliveryQueryPlan = {
      version: 1,
      intents: ["delivered"],
      operations: [
        {
          id: "delivered-observations",
          purpose: "delivered",
          select: "observations",
          predicates: [{ field: "source", operator: "equals", value: "github" }],
          time: {
            kind: "absolute",
            fromInclusive: "2026-07-20T00:00:00.000Z",
            toExclusive: "2026-07-21T00:00:00.000Z",
          },
          limit: 10,
        },
      ],
      answerMode: "deterministic",
      maximumLines: 5,
      requiresFinance: false,
    };
    const response = await Effect.runPromise(
      createPostgresDeliveryQuerySource(opened.database).execute(
        {
          workspaceId,
          actorId: "delivery-member",
          maximumSensitivity: "internal",
          financeAccess: false,
          requestedAt: "2026-07-20T12:00:00.000Z",
          timeZone: "Asia/Kolkata",
          deadlineAt: "2026-07-20T12:00:08.000Z",
          question: "What was delivered this week?",
        },
        plan,
      ),
    );
    expect(response.items).toEqual([
      expect.objectContaining({
        source: "github",
        selector: "observations",
        owner: {
          source: "github",
          externalId: actorExternalKey,
          displayName: "Delivery Owner",
        },
      }),
    ]);
  });

  test("reserves weekly GitHub delivery results across resolved contributors before the limit", async () => {
    const workspaceId = "workspace-github-weekly-owner-breadth";
    const people = [
      {
        externalKey: "github:high-volume-one",
        canonicalKey: "high-volume-one",
        title: "High Volume One",
        login: "high-volume-one",
      },
      {
        externalKey: "github:high-volume-two",
        canonicalKey: "high-volume-two",
        title: "High Volume Two",
        login: "high-volume-two",
      },
      {
        externalKey: "github:manic56",
        canonicalKey: "manikandan-selvam",
        title: "Manikandan Selvam",
        login: "manic56",
      },
    ] as const;
    const entityCatalog: DeliveryEntityCatalog = {
      version: 1,
      entities: people.map((person) => ({
        kind: "person" as const,
        canonicalKey: person.canonicalKey,
        title: person.title,
        aliases: [{ source: "github" as const, value: person.login }],
      })),
    };
    const repository = createPostgresKnowledgeRepository(opened.database);
    const noisyObservations = people.slice(0, 2).flatMap((person, personIndex) =>
      Array.from({ length: 12 }, (_, index) => ({
        kind: "commit" as const,
        externalId: `${person.login}-${index}`,
        actorExternalKey: person.externalKey,
        summary: `${person.title} change ${index}`,
        dedupeKey: `github:example/repo:commit:${person.login}-${index}`,
        occurredAt: `2026-07-25T${String(23 - personIndex).padStart(2, "0")}:${String(59 - index).padStart(2, "0")}:00.000Z`,
        citationUrl: `https://github.com/example/repo/commit/${person.login}-${index}`,
        sensitivity: "internal" as const,
        authority: 0.9,
      })),
    );
    await Effect.runPromise(
      reconcile(
        repository,
        {
          sourceId: "github-weekly-owner-breadth",
          source: "github",
          workspaceId,
          cursor: "weekly-owner-breadth-cursor",
          scopeHash: "weekly-owner-breadth-scope",
          mode: "full",
          documents: [
            {
              source: "github",
              sourceId: "github-weekly-owner-breadth",
              workspaceId,
              externalId: "example/repo:weekly-activity",
              sourceType: "repository_activity",
              sourceVersion: "v1",
              canonicalUrl: "https://github.com/example/repo",
              title: "Weekly repository activity",
              sourceCreatedAt: "2026-07-20T00:00:00.000Z",
              sourceUpdatedAt: "2026-07-25T23:59:00.000Z",
              sensitivity: "internal",
              authority: 0.9,
              provenance: {},
              acl: [
                {
                  subjectType: "workspace",
                  subjectId: workspaceId,
                  effect: "allow",
                },
              ],
              passages: [],
              deliveryProjection: {
                objects: people.map((person) => ({
                  kind: "person" as const,
                  externalKey: person.externalKey,
                  title: person.login,
                  lifecycleState: "active" as const,
                  attributes: { provider: "github" },
                  sensitivity: "internal" as const,
                })),
                relations: [],
                observations: [
                  ...noisyObservations,
                  {
                    kind: "pull_request",
                    externalId: "manikandan-pr",
                    actorExternalKey: "github:manic56",
                    summary: "PR #42 merged: Ship contributor breadth",
                    dedupeKey: "github:example/repo:pull_request:manikandan-pr",
                    occurredAt: "2026-07-25T08:00:00.000Z",
                    citationUrl: "https://github.com/example/repo/pull/42",
                    sensitivity: "internal",
                    authority: 0.95,
                  },
                ],
                metrics: [],
                claims: [],
              },
            },
          ],
        },
        createDeterministicKnowledgeEmbedding(),
      ),
    );
    const plan: DeliveryQueryPlan = {
      version: 1,
      intents: ["delivered"],
      operations: [
        {
          id: "weekly-delivered-observations",
          purpose: "delivered",
          select: "observations",
          predicates: [
            { field: "source", operator: "equals", value: "github" },
            {
              field: "kind",
              operator: "in",
              value: ["pull_request", "commit", "deployment"],
            },
          ],
          time: { kind: "workspace_week" },
          limit: 3,
        },
      ],
      answerMode: "deterministic",
      maximumLines: 5,
      requiresFinance: false,
    };
    const response = await Effect.runPromise(
      createPostgresDeliveryQuerySource(opened.database, { entityCatalog }).execute(
        {
          workspaceId,
          actorId: "delivery-member",
          maximumSensitivity: "internal",
          financeAccess: false,
          requestedAt: "2026-07-25T12:00:00.000Z",
          timeZone: "Asia/Kolkata",
          deadlineAt: "2026-07-25T12:00:08.000Z",
          question: "What was delivered this week?",
        },
        plan,
      ),
    );

    expect(response.items.map(({ owner }) => owner?.displayName)).toEqual([
      "High Volume One",
      "High Volume Two",
      "Manikandan Selvam",
    ]);
  });

  test("applies source and alias predicates before limiting GitHub module results", async () => {
    const workspaceId = "workspace-source-balanced-query";
    const repository = createPostgresKnowledgeRepository(opened.database, {
      entityCatalog: {
        version: 1,
        entities: [
          {
            kind: "module",
            canonicalKey: "product-builder",
            title: "Product Builder",
            aliases: [
              { source: "github", value: "Puck" },
              { source: "jira", value: "Atlas Site Composer" },
            ],
          },
        ],
      },
    });
    const noise = Array.from({ length: 12 }, (_, index) => ({
      kind: "module" as const,
      externalKey: `noise-${index}`,
      title: `Recently updated module ${index}`,
      lifecycleState: "active",
      attributes: {},
      observedAt: `2026-07-26T${String(index + 1).padStart(2, "0")}:00:00.000Z`,
      sensitivity: "internal" as const,
    }));
    await Effect.runPromise(
      reconcile(
        repository,
        {
          sourceId: "github-source-balanced-query",
          source: "github",
          workspaceId,
          cursor: "github-source-balanced-query-v1",
          scopeHash: "sha256-source-balanced-query",
          documents: [
            {
              source: "github",
              sourceId: "github-source-balanced-query",
              workspaceId,
              externalId: "repository-modules",
              sourceType: "repository",
              sourceVersion: "v1",
              canonicalUrl: "https://github.com/example/product-builder",
              title: "Repository modules",
              sourceCreatedAt: "2026-07-01T00:00:00.000Z",
              sourceUpdatedAt: "2026-07-26T13:00:00.000Z",
              sensitivity: "internal",
              authority: 0.95,
              provenance: { repository: "example/product-builder" },
              acl: [
                {
                  subjectType: "audience",
                  subjectId: "delivery-team",
                  effect: "allow",
                },
              ],
              passages: [
                {
                  kind: "description",
                  locator: "#modules",
                  ordinal: 0,
                  title: "Modules",
                  body: "Repository module catalog.",
                  contentHash: "sha256-source-balanced-query-body",
                },
              ],
              deliveryProjection: {
                objects: [
                  ...noise,
                  {
                    kind: "module",
                    externalKey: "Puck",
                    title: "Puck",
                    lifecycleState: "active",
                    attributes: {},
                    observedAt: "2026-07-01T00:00:00.000Z",
                    sensitivity: "internal",
                  },
                  {
                    kind: "module",
                    externalKey: "Puck-secondary",
                    title: "Puck",
                    lifecycleState: "active",
                    attributes: {},
                    observedAt: "2026-07-01T00:00:00.000Z",
                    sensitivity: "internal",
                  },
                ],
                relations: [],
                observations: [],
                metrics: [],
                claims: [],
              },
            },
          ],
        },
        createDeterministicKnowledgeEmbedding(),
      ),
    );
    await opened.database
      .update(deliveryObjectTable)
      .set({ indexedAt: "2025-01-01T00:00:00.000Z" })
      .where(eq(deliveryObjectTable.workspaceId, workspaceId));

    const plan: DeliveryQueryPlan = {
      version: 1,
      intents: ["implementation"],
      operations: [
        {
          id: "implementation-module",
          purpose: "implementation",
          select: "objects",
          objectKinds: ["module"],
          predicates: [
            { field: "source", operator: "equals", value: "github" },
            {
              field: "title",
              operator: "contains",
              value: "Atlas Site Composer",
            },
          ],
          limit: 2,
        },
      ],
      answerMode: "deterministic",
      maximumLines: 3,
      requiresFinance: false,
      requiredSources: ["github"],
    };
    const context = {
      workspaceId,
      actorId: "delivery-member",
      maximumSensitivity: "internal" as const,
      financeAccess: false,
      requestedAt: "2026-07-26T14:00:00.000Z",
      timeZone: "Asia/Kolkata",
      deadlineAt: "2026-07-26T14:00:08.000Z",
      question: "How is Atlas Site Composer implemented?",
    };
    const source = createPostgresDeliveryQuerySource(opened.database);
    const withoutAudience = await Effect.runPromise(source.execute(context, plan));
    expect(withoutAudience.items).toEqual([]);
    const result = await Effect.runPromise(
      source.execute({ ...context, audienceIds: ["delivery-team"] }, plan),
    );

    expect(result.items).toHaveLength(2);
    expect(
      result.items.every(
        (item) =>
          item.source === "github" &&
          item.selector === "objects" &&
          item.title === "Product Builder" &&
          item.indexedAt?.includes("2025-01-01") === false &&
          item.subjectAliases?.includes("Puck") === true &&
          item.subjectAliases.includes("Atlas Site Composer"),
      ),
    ).toBe(true);
    expect(new Set(result.items.map(({ dedupeKey }) => dedupeKey))).toHaveLength(2);
  });

  test("answers implementation questions from indexed activity when live GitHub is unavailable", async () => {
    const workspaceId = "workspace-indexed-implementation";
    const repository = createPostgresKnowledgeRepository(opened.database);
    await Effect.runPromise(
      reconcile(
        repository,
        {
          sourceId: "github-indexed-implementation",
          source: "github",
          workspaceId,
          cursor: "github-indexed-implementation-v1",
          scopeHash: "sha256-indexed-implementation",
          mode: "full",
          documents: [
            {
              source: "github",
              sourceId: "github-indexed-implementation",
              workspaceId,
              externalId: "example/product-builder:pull:77",
              sourceType: "pull_request",
              sourceVersion: "v1",
              canonicalUrl: "https://github.com/example/product-builder/pull/77",
              title: "PR #77: Add reusable page sections",
              sourceCreatedAt: "2026-07-25T08:00:00.000Z",
              sourceUpdatedAt: "2026-07-25T09:00:00.000Z",
              sensitivity: "internal",
              authority: 0.95,
              provenance: { repository: "example/product-builder" },
              acl: [
                {
                  subjectType: "workspace",
                  subjectId: workspaceId,
                  effect: "allow",
                },
              ],
              passages: [],
              deliveryProjection: {
                objects: [
                  {
                    kind: "module",
                    externalKey: "github:example/product-builder",
                    title: "example/product-builder",
                    lifecycleState: "active",
                    attributes: { repository: "example/product-builder" },
                    sensitivity: "internal",
                  },
                  {
                    kind: "deliverable",
                    externalKey: "github:example/product-builder:pull:77",
                    title: "PR #77: Add reusable page sections",
                    lifecycleState: "merged",
                    attributes: {
                      repository: "example/product-builder",
                      activityKind: "pull_request",
                    },
                    sensitivity: "internal",
                  },
                ],
                relations: [
                  {
                    kind: "contains",
                    from: {
                      kind: "module",
                      externalKey: "github:example/product-builder",
                    },
                    to: {
                      kind: "deliverable",
                      externalKey: "github:example/product-builder:pull:77",
                    },
                    attributes: { activityId: "77" },
                    sensitivity: "internal",
                  },
                ],
                observations: [
                  ...Array.from({ length: 450 }, (_, index) => ({
                    kind: "commit" as const,
                    externalId: `unrelated-${index}`,
                    summary: `Unrelated repository change ${index}`,
                    dedupeKey: `github:example/unrelated:commit:${index}`,
                    occurredAt: new Date(
                      Date.parse("2026-07-26T10:00:00.000Z") + index * 1_000,
                    ).toISOString(),
                    citationUrl: `https://github.com/example/unrelated/commit/${index}`,
                    sensitivity: "internal" as const,
                    authority: 0.9,
                  })),
                  {
                    kind: "pull_request",
                    externalId: "77",
                    subject: {
                      kind: "deliverable",
                      externalKey: "github:example/product-builder:pull:77",
                    },
                    summary: "PR #77 merged: Add reusable page sections",
                    dedupeKey: "github:example/product-builder:pull_request:77",
                    occurredAt: "2026-07-25T09:00:00.000Z",
                    citationUrl: "https://github.com/example/product-builder/pull/77",
                    sensitivity: "internal",
                    authority: 0.95,
                  },
                ],
                metrics: [],
                claims: [],
              },
            },
          ],
        },
        createDeterministicKnowledgeEmbedding(),
      ),
    );
    const entityCatalog: DeliveryEntityCatalog = {
      version: 1,
      entities: [
        {
          kind: "module",
          canonicalKey: "modern-website-builder",
          title: "Atlas Site Composer",
          aliases: [
            { value: "Atlas Site Composer" },
            { source: "github", value: "example/product-builder" },
          ],
        },
      ],
    };
    const question =
      "Which repositories, pull requests, commits, or code implement Atlas Site Composer, and what changed in the last 30 days?";
    const source = createPostgresDeliveryQuerySource(opened.database, { entityCatalog });
    const plan = planDeliveryQuestion(question);
    if (plan === undefined) throw new Error("Expected an implementation plan");
    const result = await Effect.runPromise(
      source.execute(
        {
          workspaceId,
          actorId: "delivery-member",
          maximumSensitivity: "internal",
          financeAccess: false,
          requestedAt: "2026-07-27T08:00:00.000Z",
          timeZone: "Asia/Kolkata",
          deadlineAt: "2026-07-27T08:00:08.000Z",
          question,
        },
        plan,
      ),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        source: "github",
        selector: "observations",
        subjectAliases: expect.arrayContaining(["Atlas Site Composer", "example/product-builder"]),
      }),
    ]);

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        workspaceId,
        actorId: "delivery-member",
        maximumSensitivity: "internal",
        financeAccess: false,
        requestedAt: "2026-07-27T08:00:00.000Z",
        timeZone: "Asia/Kolkata",
        question,
      }),
    );
    expect(answer.status).toBe("ok");
    expect(answer.text).toContain("PR #77 merged");
    expect(answer.text).not.toContain("GitHub unavailable");
  });

  test("exhaustively pages the authorized period census and excludes generic updates", async () => {
    const workspaceId = "workspace-period-census";
    const sourceId = "github-period-census";
    const repository = createPostgresKnowledgeRepository(opened.database);
    const control = createPostgresSynchronizationControlRepository(opened.database);
    const deliverables = Array.from({ length: 12 }, (_, index) => ({
      kind: "deliverable" as const,
      externalKey: `CENSUS-${index + 1}`,
      title: `Census deliverable ${index + 1}`,
      lifecycleState: "merged",
      attributes: {},
      sensitivity: "internal" as const,
    }));
    const genericUpdates = Array.from({ length: 3 }, (_, index) => ({
      kind: "work_item" as const,
      externalKey: `UPDATE-${index + 1}`,
      title: `Generic update ${index + 1}`,
      lifecycleState: "in_progress",
      attributes: {},
      sensitivity: "internal" as const,
    }));
    const snapshot: KnowledgeSourceSnapshot = {
      sourceId,
      source: "github",
      workspaceId,
      cursor: "github-period-census-v1",
      scopeHash: "sha256-github-period-census",
      mode: "full",
      retiredExternalIds: [],
      documents: [
        {
          source: "github",
          sourceId,
          workspaceId,
          externalId: "example/period-census",
          sourceType: "repository",
          sourceVersion: "v1",
          canonicalUrl: "https://github.com/example/period-census",
          title: "Period census fixture",
          sourceCreatedAt: "2026-07-01T00:00:00.000Z",
          sourceUpdatedAt: "2026-07-25T12:00:00.000Z",
          sensitivity: "internal",
          authority: 1,
          provenance: { repository: "example/period-census" },
          acl: [
            { subjectType: "workspace", subjectId: workspaceId, effect: "allow" },
            { subjectType: "actor", subjectId: "blocked-actor", effect: "deny" },
          ],
          passages: [
            {
              kind: "summary",
              locator: "#summary",
              ordinal: 0,
              title: "Period census",
              body: "Privacy-safe delivery census fixture.",
              contentHash: "sha256-period-census-body",
            },
          ],
          deliveryProjection: {
            objects: [...deliverables, ...genericUpdates],
            relations: [],
            observations: Array.from({ length: 11 }, (_, index) => ({
              kind: "deployment" as const,
              externalId: `deployment-${index + 1}`,
              subject: {
                kind: "deliverable" as const,
                externalKey: `CENSUS-${index + 1}`,
              },
              summary: `Census deployment ${index + 1}`,
              dedupeKey: `github:period-census:deployment:${index + 1}`,
              occurredAt: `2026-07-${String(index + 10).padStart(2, "0")}T12:00:00.000Z`,
              citationUrl: `https://github.com/example/period-census/deployments/${index + 1}`,
              sensitivity: "internal" as const,
              authority: 1,
            })),
            metrics: [],
            claims: [],
          },
        },
      ],
    };
    const times = ["2026-07-26T00:00:00.000Z", "2026-07-26T00:00:01.000Z"];
    await Effect.runPromise(
      synchronizeKnowledgeSource(
        {
          workspaceId,
          source: {
            source: "github",
            sourceId,
            reader: { readSnapshot: () => Effect.succeed(snapshot) },
          },
          trigger: "historical-backfill",
          ownerId: "period-census-integration",
          leaseSeconds: 300,
          now: () => times.shift() ?? "2026-07-26T00:00:01.000Z",
        },
        repository,
        createDeterministicKnowledgeEmbedding(),
        control,
      ),
    );
    const plan: DeliveryQueryPlan = {
      version: 1,
      intents: ["delivered"],
      operations: [
        {
          id: "period-census",
          purpose: "delivered",
          select: "period_census",
          time: { kind: "lookback", days: 31 },
          census: { pageSize: 10, maximumCandidates: 100 },
          limit: 1,
        },
      ],
      answerMode: "deterministic",
      maximumLines: 3,
      requiresFinance: false,
    };
    const context = {
      workspaceId,
      actorId: "delivery-member",
      maximumSensitivity: "internal" as const,
      financeAccess: false,
      requestedAt: "2026-07-28T12:00:00.000Z",
      timeZone: "Asia/Kolkata",
      deadlineAt: "2026-07-28T12:00:32.000Z",
      question: "Give me the last 31 days delivery report.",
    };
    const source = createPostgresDeliveryQuerySource(opened.database);
    const result = await Effect.runPromise(source.execute(context, plan));
    expect(result.periodCensus).toMatchObject({
      examinedCandidateCount: 26,
      candidateCount: 23,
      deliveredCandidateCount: 23,
      excludedCandidateCount: 3,
      exclusions: { generic_source_update_not_completion: 3 },
      pagination: { pageSize: 10, pagesRead: 4, exhausted: true },
      unavailableSources: [],
      complete: true,
    });
    expect(result.periodCensus?.replayChecksum).toMatch(/^[a-f0-9]{64}$/);

    const denied = await Effect.runPromise(
      source.execute({ ...context, actorId: "blocked-actor" }, plan),
    );
    expect(denied.periodCensus).toMatchObject({
      examinedCandidateCount: 0,
      candidateCount: 0,
      complete: true,
    });
  });
});

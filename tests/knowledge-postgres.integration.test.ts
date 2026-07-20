import { Effect } from "effect";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDeterministicKnowledgeEmbedding } from "../src/infrastructure/model/index.ts";
import {
  applyKnowledgePostgresMigrations,
  createPostgresKnowledgeRepository,
  openKnowledgePostgresDatabase,
} from "../src/infrastructure/postgres/index.ts";
import type { KnowledgeSourceSnapshot } from "../src/modules/knowledge-layer/index.ts";

const databaseUrl = process.env.SARATHI_KNOWLEDGE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

const snapshot = (version: string, body: string): KnowledgeSourceSnapshot => ({
  sourceId: "jira-1851-test",
  workspaceId: "workspace-1851",
  cursor: `cursor-${version}`,
  scopeHash: "sha256-scope",
  documents: [
    {
      source: "jira",
      sourceId: "jira-1851-test",
      workspaceId: "workspace-1851",
      externalId: "F1851-635",
      sourceType: "issue",
      sourceVersion: version,
      canonicalUrl: "https://jira.example/browse/F1851-635",
      title: "Modern Website Builder",
      sourceUpdatedAt: "2026-07-20T00:00:00.000Z",
      sensitivity: "internal",
      authority: 1,
      provenance: { projectKey: "F1851" },
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

    const authorized = await Effect.runPromise(
      repository.search(
        {
          question: "F1851-635 Modern Website Builder",
          audience: {
            workspaceId: "workspace-1851",
            audienceIds: ["delivery"],
            maximumSensitivity: "internal",
          },
          topK: 10,
        },
        (await Effect.runPromise(embeddings.embed(["builder status"])))[0] ?? [],
      ),
    );
    expect(authorized[0]).toMatchObject({ source: "jira", sourceId: "jira-1851-test" });
    expect(authorized[0]?.citationUrl).toBe("https://jira.example/browse/F1851-635#description");

    for (const audience of [
      {
        workspaceId: "workspace-1851",
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
            { question: "F1851-635", audience, topK: 10 },
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

    const deleted = await Effect.runPromise(
      repository.reconcile(
        {
          sourceId: "jira-1851-test",
          workspaceId: "workspace-1851",
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
    const afterDelete = await Effect.runPromise(
      repository.search(
        {
          question: "F1851-635",
          audience: {
            workspaceId: "workspace-1851",
            audienceIds: ["delivery"],
            maximumSensitivity: "internal",
          },
          topK: 10,
        },
        (await Effect.runPromise(embeddings.embed(["status"])))[0] ?? [],
      ),
    );
    expect(afterDelete).toEqual([]);
  });
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createDeterministicKnowledgeEmbedding } from "../src/infrastructure/model/deterministic-knowledge-embedding.ts";
import {
  ingestKnowledgeSource,
  type KnowledgeRepository,
  type KnowledgeSourceSnapshot,
  queryKnowledge,
} from "../src/modules/knowledge-layer/index.ts";

const snapshot: KnowledgeSourceSnapshot = {
  sourceId: "jira-1851",
  source: "jira",
  workspaceId: "1851",
  cursor: "cursor-1",
  scopeHash: "scope-1",
  documents: [
    {
      source: "jira",
      sourceId: "jira-1851",
      workspaceId: "1851",
      externalId: "F1851-100",
      sourceType: "issue",
      sourceVersion: "version-1",
      canonicalUrl: "https://jira.example.test/browse/F1851-100",
      title: "Synthetic delivery status",
      sourceUpdatedAt: "2026-07-20T00:00:00.000Z",
      sensitivity: "internal",
      authority: 1,
      provenance: { project: "F1851" },
      acl: [{ effect: "allow", subjectType: "audience", subjectId: "delivery" }],
      passages: [
        {
          kind: "field",
          locator: "#status",
          ordinal: 0,
          title: "Status",
          body: "In progress",
          contentHash: "hash-1",
        },
      ],
    },
  ],
};

const summary = {
  sourceId: "jira-1851",
  workspaceId: "1851",
  cursor: "cursor-1",
  scopeHash: "scope-1",
  documentsObserved: 1,
  versionsCreated: 1,
  passagesActive: 1,
  itemsDeleted: 0,
  checksum: "checksum-1",
} as const;

describe("knowledge application service", () => {
  it("rejects cross-workspace and ACL-free snapshots before repository access", async () => {
    let reconciles = 0;
    const repository: KnowledgeRepository = {
      reconcile: () => {
        reconciles += 1;
        return Effect.succeed(summary);
      },
      search: () => Effect.succeed([]),
    };
    const embeddings = createDeterministicKnowledgeEmbedding();

    await expect(
      Effect.runPromise(
        ingestKnowledgeSource(
          { readSnapshot: () => Effect.succeed({ ...snapshot, workspaceId: "finance" }) },
          repository,
          embeddings,
          "1851",
        ),
      ),
    ).rejects.toThrow("cross-workspace snapshot");
    await expect(
      Effect.runPromise(
        ingestKnowledgeSource(
          {
            readSnapshot: () =>
              Effect.succeed({
                ...snapshot,
                documents: snapshot.documents.map((document) => ({ ...document, acl: [] })),
              }),
          },
          repository,
          embeddings,
          "1851",
        ),
      ),
    ).rejects.toThrow("explicit ACL");
    expect(reconciles).toBe(0);
  });

  it("passes an authorized snapshot and deterministic 1536-dimensional embeddings", async () => {
    let dimensions = 0;
    const embeddings = createDeterministicKnowledgeEmbedding();
    const repository: KnowledgeRepository = {
      reconcile: (_snapshot, embeddingPort) => {
        dimensions = embeddingPort.dimensions;
        return Effect.succeed(summary);
      },
      search: () => Effect.succeed([]),
    };

    await expect(
      Effect.runPromise(
        ingestKnowledgeSource(
          { readSnapshot: () => Effect.succeed(snapshot) },
          repository,
          embeddings,
          "1851",
        ),
      ),
    ).resolves.toEqual(summary);
    expect(dimensions).toBe(1536);
    const [first, second] = await Effect.runPromise(
      embeddings.embed(["same passage", "same passage"]),
    );
    expect(first).toHaveLength(1536);
    expect(first).toEqual(second);
  });

  it("embeds the question before repository search and fails on a missing vector", async () => {
    let observedDimensions = 0;
    const repository: KnowledgeRepository = {
      reconcile: () => Effect.succeed(summary),
      search: (_query, vector) => {
        observedDimensions = vector.length;
        return Effect.succeed([]);
      },
    };
    const query = {
      question: "What is the current status?",
      audience: {
        workspaceId: "1851",
        audienceIds: ["delivery"],
        maximumSensitivity: "internal" as const,
      },
      topK: 10,
    };
    await Effect.runPromise(
      queryKnowledge(repository, createDeterministicKnowledgeEmbedding(), query),
    );
    expect(observedDimensions).toBe(1536);

    await expect(
      Effect.runPromise(
        queryKnowledge(
          repository,
          { model: "broken", dimensions: 1536, embed: () => Effect.succeed([]) },
          query,
        ),
      ),
    ).rejects.toThrow("Embedding provider returned no query vector");
  });
});

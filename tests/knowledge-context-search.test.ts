import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { createKnowledgeTeamsContextSearch } from "../src/infrastructure/teams/knowledge-context-search.ts";
import type {
  KnowledgeEmbeddingPort,
  KnowledgeRepository,
} from "../src/modules/knowledge-layer/index.ts";

describe("Teams knowledge context search", () => {
  test("projects resolved workspace, actor, sensitivity, and approved thread context into retrieval", async () => {
    const seen: unknown[] = [];
    const repository: KnowledgeRepository = {
      reconcile: () => Effect.die("not used"),
      search: (query) => {
        seen.push(query);
        return Effect.succeed([
          {
            id: "jira-1",
            source: "jira",
            sourceId: "DEMO-635",
            title: "Status",
            excerpt: "Approved status",
            citationUrl: "https://jira.example/browse/DEMO-635",
            sourceUpdatedAt: "2026-07-20T00:00:00.000Z",
            sensitivity: "internal",
            authority: 0.9,
            freshness: 1,
            componentRanks: { keyword: 1 },
            score: 1,
          },
        ]);
      },
    };
    const embeddings: KnowledgeEmbeddingPort = {
      model: "test",
      dimensions: 1536,
      embed: () => Effect.succeed([Array.from({ length: 1536 }, () => 0)]),
    };
    const search = createKnowledgeTeamsContextSearch({
      repository,
      embeddings,
      liveSearches: [],
      audienceIds: ["delivery"],
      topK: 10,
    });
    const results = await Effect.runPromise(
      search.search(
        { question: "status" } as never,
        {
          workspaceId: "workspace-example",
          callerId: "actor-1",
          channelSensitivity: "internal",
        } as never,
        [],
      ),
    );
    expect(seen).toEqual([
      expect.objectContaining({
        audience: {
          workspaceId: "workspace-example",
          actorId: "actor-1",
          audienceIds: ["delivery"],
          maximumSensitivity: "internal",
        },
      }),
    ]);
    expect(results).toEqual([
      expect.objectContaining({
        source: "jira",
        sourceUrl: "https://jira.example/browse/DEMO-635",
      }),
    ]);
  });
});

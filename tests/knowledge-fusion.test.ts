import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import {
  fuseKnowledgeResults,
  queryKnowledgeAcrossSources,
} from "../src/modules/knowledge-layer/application/knowledge-service.ts";
import type {
  KnowledgeEmbeddingPort,
  KnowledgeLiveSearch,
  KnowledgeRepository,
  KnowledgeSearchResult,
} from "../src/modules/knowledge-layer/index.ts";

const result = (
  source: KnowledgeSearchResult["source"],
  sourceId: string,
  citationUrl: string,
): KnowledgeSearchResult => ({
  id: `${source}:${sourceId}`,
  source,
  sourceId,
  title: sourceId,
  excerpt: `${sourceId} evidence`,
  citationUrl,
  sourceUpdatedAt: "2026-07-20T00:00:00.000Z",
  sensitivity: "internal",
  authority: source === "teams" ? 0.9 : 0.8,
  freshness: 1,
  componentRanks: {},
  score: 0,
});

describe("cross-source knowledge fusion", () => {
  test("suppresses the same resolvable citation across independently ranked lists", () => {
    const fused = fuseKnowledgeResults(
      {
        indexed: [result("jira", "F1851-635", "https://jira.example/browse/F1851-635")],
        thread: [result("teams", "thread-1", "https://jira.example/browse/F1851-635#comment-1")],
        github: [result("github", "repo#1", "https://github.com/org/repo/issues/1")],
      },
      10,
    );
    expect(fused).toHaveLength(2);
    expect(fused[0]?.componentRanks).toMatchObject({ indexed: 1, thread: 1 });
  });

  test("combines indexed, live, and approved thread evidence after embedding the query", async () => {
    const indexed = result("vault", "risk-note", "https://github.com/org/vault/blob/a/risk.md");
    const github = result("github", "repo:path", "https://github.com/org/repo/blob/a/src/x.ts");
    const repository: KnowledgeRepository = {
      reconcile: () => Effect.die("not used"),
      search: () => Effect.succeed([indexed]),
    };
    const embeddings: KnowledgeEmbeddingPort = {
      model: "deterministic",
      dimensions: 1536,
      embed: () => Effect.succeed([Array.from({ length: 1536 }, () => 0)]),
    };
    const live: KnowledgeLiveSearch = {
      source: "github",
      search: () => Effect.succeed([github]),
    };
    const results = await Effect.runPromise(
      queryKnowledgeAcrossSources(
        repository,
        embeddings,
        [live],
        {
          question: "what changed",
          audience: {
            workspaceId: "workspace-1851",
            audienceIds: ["delivery"],
            maximumSensitivity: "internal",
          },
          topK: 10,
        },
        [
          {
            sourceId: "thread-1",
            title: "Approved thread",
            excerpt: "Current decision",
            citationUrl: "https://teams.microsoft.com/l/message/thread-1",
            sourceUpdatedAt: "2026-07-20T00:00:00.000Z",
            sensitivity: "internal",
          },
        ],
      ),
    );
    expect(new Set(results.map(({ source }) => source))).toEqual(
      new Set(["vault", "github", "teams"]),
    );
  });
});

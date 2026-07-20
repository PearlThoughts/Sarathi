import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createDeliveryKnowledgeQuerySource } from "../src/infrastructure/knowledge/index.ts";
import { planDeliveryQuestion } from "../src/modules/delivery-intelligence/index.ts";
import type {
  KnowledgeEmbeddingPort,
  KnowledgeRepository,
} from "../src/modules/knowledge-layer/index.ts";

const embeddings: KnowledgeEmbeddingPort = {
  model: "deterministic-test",
  dimensions: 3,
  embed: () => Effect.succeed([[0.1, 0.2, 0.3]]),
};

describe("delivery knowledge query source", () => {
  it("passes actor, workspace, audience, and sensitivity into hybrid retrieval", async () => {
    const search = vi.fn<KnowledgeRepository["search"]>(() =>
      Effect.succeed([
        {
          id: "passage-1",
          source: "vault",
          sourceId: "vault-1851",
          title: "Operating context",
          excerpt: "The active delivery context.",
          citationUrl: "https://example.com/vault/context",
          sourceUpdatedAt: "2026-07-20T10:00:00.000Z",
          sensitivity: "internal",
          authority: 0.9,
          freshness: 1,
          componentRanks: { fullText: 1, vector: 1 },
          score: 0.8,
        },
      ]),
    );
    const repository: KnowledgeRepository = {
      reconcile: () => Effect.die("not used"),
      search,
    };
    const plan = planDeliveryQuestion("What should I know before standup?");
    if (plan === undefined) throw new Error("Expected a generic delivery plan");
    const source = createDeliveryKnowledgeQuerySource({
      repository,
      embeddings,
      workspaceId: "workspace-1851",
      allowedActorIds: new Set(["actor-1851"]),
      audienceIds: ["team-1851"],
    });
    const result = await Effect.runPromise(
      source.execute(
        {
          workspaceId: "workspace-1851",
          actorId: "actor-1851",
          maximumSensitivity: "internal",
          financeAccess: false,
          requestedAt: "2026-07-20T10:00:00.000Z",
          timeZone: "Asia/Kolkata",
          deadlineAt: "2026-07-20T10:00:06.000Z",
          question: "What should I know before standup?",
        },
        plan,
      ),
    );
    expect(search.mock.calls[0]?.[0].audience).toEqual({
      workspaceId: "workspace-1851",
      actorId: "actor-1851",
      audienceIds: ["team-1851"],
      maximumSensitivity: "internal",
    });
    expect(result.items[0]).toMatchObject({
      source: "vault",
      selector: "knowledge",
      intent: "general",
    });
  });

  it("excludes unmapped actors before embedding or repository access", async () => {
    const search = vi.fn<KnowledgeRepository["search"]>(() => Effect.succeed([]));
    const embed = vi.fn<KnowledgeEmbeddingPort["embed"]>(() => Effect.succeed([[0, 0, 0]]));
    const plan = planDeliveryQuestion("What should I know before standup?");
    if (plan === undefined) throw new Error("Expected a generic delivery plan");
    const source = createDeliveryKnowledgeQuerySource({
      repository: { reconcile: () => Effect.die("not used"), search },
      embeddings: { ...embeddings, embed },
      workspaceId: "workspace-1851",
      allowedActorIds: new Set(["actor-1851"]),
      audienceIds: ["team-1851"],
    });
    const result = await Effect.runPromise(
      source.execute(
        {
          workspaceId: "workspace-1851",
          actorId: "other-actor",
          maximumSensitivity: "internal",
          financeAccess: false,
          requestedAt: "2026-07-20T10:00:00.000Z",
          timeZone: "Asia/Kolkata",
          deadlineAt: "2026-07-20T10:00:06.000Z",
          question: "What should I know before standup?",
        },
        plan,
      ),
    );
    expect(result.items).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });
});

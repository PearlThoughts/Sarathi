import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createDeliveryKnowledgeQuerySource } from "../src/infrastructure/knowledge/index.ts";
import { planDeliveryQuestion } from "../src/modules/delivery-intelligence/index.ts";
import type { KnowledgeRepository } from "../src/modules/knowledge-layer/index.ts";

describe("delivery knowledge query source", () => {
  it("passes actor, workspace, audience, and sensitivity into lexical retrieval", async () => {
    const searchLexical = vi.fn<KnowledgeRepository["searchLexical"]>(() =>
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
      search: () => Effect.die("delivery retrieval must not wait for query embeddings"),
      searchLexical,
    };
    const plan = planDeliveryQuestion("What should I know before standup?");
    if (plan === undefined) throw new Error("Expected a generic delivery plan");
    const source = createDeliveryKnowledgeQuerySource({
      repository,
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
    expect(searchLexical.mock.calls[0]?.[0].audience).toEqual({
      workspaceId: "workspace-1851",
      actorId: "actor-1851",
      audienceIds: ["team-1851"],
      maximumSensitivity: "internal",
    });
    expect(searchLexical.mock.calls[0]?.[0].question).toBe("What should I know before standup?");
    expect(result.items[0]).toMatchObject({
      source: "vault",
      selector: "knowledge",
      intent: "general",
    });
  });

  it("uses the full delivery question and excludes operational agent metadata", async () => {
    const searchLexical = vi.fn<KnowledgeRepository["searchLexical"]>(() =>
      Effect.succeed([
        {
          id: "metadata",
          source: "vault",
          sourceId: "metadata",
          title: "Agent Prompt Playbook",
          excerpt: "Use these trigger keywords.",
          citationUrl: "https://example.com/vault/playbook#reliable-trigger-keywords",
          sourceUpdatedAt: "2026-07-20T10:00:00.000Z",
          sensitivity: "internal",
          authority: 1,
          freshness: 1,
          componentRanks: { keyword: 1 },
          score: 1,
        },
        {
          id: "status",
          source: "vault",
          sourceId: "status",
          title: "Builder delivery status",
          excerpt: "The builder is in acceptance testing.",
          citationUrl: "https://example.com/vault/builder#delivery-status",
          sourceUpdatedAt: "2026-07-20T10:00:00.000Z",
          sensitivity: "internal",
          authority: 0.9,
          freshness: 1,
          componentRanks: { keyword: 2 },
          score: 0.8,
        },
      ]),
    );
    const plan = planDeliveryQuestion("What is the current status of Modern Website Builder?");
    if (plan === undefined) throw new Error("Expected a status plan");
    const source = createDeliveryKnowledgeQuerySource({
      repository: {
        reconcile: () => Effect.die("not used"),
        search: () => Effect.die("not used"),
        searchLexical,
      },
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
          question: "What is the current status of Modern Website Builder?",
        },
        plan,
      ),
    );
    expect(searchLexical.mock.calls[0]?.[0].question).toBe(
      "What is the current status of Modern Website Builder?",
    );
    expect(result.items.map(({ title }) => title)).toEqual(["Builder delivery status"]);
  });

  it("excludes unmapped actors before repository access", async () => {
    const searchLexical = vi.fn<KnowledgeRepository["searchLexical"]>(() => Effect.succeed([]));
    const plan = planDeliveryQuestion("What should I know before standup?");
    if (plan === undefined) throw new Error("Expected a generic delivery plan");
    const source = createDeliveryKnowledgeQuerySource({
      repository: {
        reconcile: () => Effect.die("not used"),
        search: () => Effect.die("not used"),
        searchLexical,
      },
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
    expect(searchLexical).not.toHaveBeenCalled();
  });
});

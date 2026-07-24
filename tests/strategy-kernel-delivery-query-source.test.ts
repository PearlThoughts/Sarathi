import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createStrategyKernelDeliveryQuerySource } from "../src/infrastructure/postgres/index.ts";
import {
  createDeliveryAssistant,
  type DeliveryQueryContext,
  planDeliveryQuestion,
} from "../src/modules/delivery-intelligence/index.ts";
import type {
  EvidenceItem,
  IntentNode,
  StrategyKernelRepository,
} from "../src/modules/strategy-kernel/index.ts";

const workspaceId = "workspace-1851";
const requestedAt = "2026-07-24T12:00:00.000Z";

const context = (overrides: Partial<DeliveryQueryContext> = {}): DeliveryQueryContext => ({
  workspaceId,
  actorId: "actor-delivery-manager",
  maximumSensitivity: "internal",
  financeAccess: false,
  requestedAt,
  timeZone: "Asia/Kolkata",
  deadlineAt: "2026-07-24T12:00:10.000Z",
  question: "What are our goals and risks?",
  ...overrides,
});

const plan = () => {
  const result = planDeliveryQuestion(context().question);
  if (result === undefined) throw new Error("Expected a delivery query plan.");
  return result;
};

const evidence = (overrides: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: "evidence-goal",
  workspaceId,
  sourceSystem: "teams",
  sourceType: "message",
  externalId: "message-1",
  externalUrl: "https://teams.microsoft.com/l/message/message-1",
  occurredAt: "2026-07-01T08:00:00.000Z",
  title: "Quarterly direction",
  bodyExcerpt: "Make delivery status reliably current.",
  contentHash: "hash",
  sensitivity: "internal",
  ingestedAt: "2026-07-01T08:01:00.000Z",
  ...overrides,
});

const intent = (overrides: Partial<IntentNode> = {}): IntentNode => ({
  id: "intent-goal",
  workspaceId,
  kind: "goal",
  title: "Continuously current delivery intelligence",
  body: "Answers reflect synchronized project evidence.",
  state: "active",
  horizonStart: "2026-07-01T00:00:00.000Z",
  horizonEnd: "2026-09-30T23:59:59.000Z",
  successSignal: "Evaluation thresholds pass.",
  sensitivity: "internal",
  originEvidenceId: "evidence-goal",
  createdBy: "human",
  createdAt: "2026-07-01T08:00:00.000Z",
  updatedAt: "2026-07-20T08:00:00.000Z",
  ...overrides,
});

const repository = (
  intents: readonly IntentNode[],
  evidenceItems: readonly EvidenceItem[],
): StrategyKernelRepository =>
  ({
    listWorkspaceIntent: vi.fn(async () => intents),
    listWorkspaceEvidence: vi.fn(async () => evidenceItems),
  }) as unknown as StrategyKernelRepository;

describe("Strategy Kernel delivery query source", () => {
  it("returns citable ratified intent as a declared setpoint", async () => {
    const source = createStrategyKernelDeliveryQuerySource({
      repository: repository([intent()], [evidence()]),
      workspaceId,
      allowedActorIds: new Set(["actor-delivery-manager"]),
    });
    const result = await Effect.runPromise(source.execute(context(), plan()));

    expect(result.complete).toBe(true);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "intent-goal",
        source: "teams",
        intent: "goals",
        evidenceRole: "declared_intent",
        citationUrl: "https://teams.microsoft.com/l/message/message-1",
        lifecycleState: "active",
        authority: 1,
      }),
    ]);
    expect(result.items[0]?.summary).toContain("Success signal: Evaluation thresholds pass.");
  });

  it("excludes candidates, over-ceiling records, and intent without a resolvable origin", async () => {
    const source = createStrategyKernelDeliveryQuerySource({
      repository: repository(
        [
          intent({ id: "candidate", state: "candidate" }),
          intent({
            id: "restricted",
            originEvidenceId: "evidence-restricted",
            sensitivity: "restricted",
          }),
          intent({ id: "uncited", originEvidenceId: "evidence-uncited" }),
        ],
        [
          evidence({ id: "evidence-restricted", sensitivity: "restricted" }),
          evidence({ id: "evidence-uncited", externalUrl: undefined }),
        ],
      ),
      workspaceId,
      allowedActorIds: new Set(["actor-delivery-manager"]),
    });
    const result = await Effect.runPromise(source.execute(context(), plan()));

    expect(result.items).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it("does not read intent before actor and workspace authorization", async () => {
    const listWorkspaceIntent = vi.fn(async () => [intent()]);
    const listWorkspaceEvidence = vi.fn(async () => [evidence()]);
    const source = createStrategyKernelDeliveryQuerySource({
      repository: {
        listWorkspaceIntent,
        listWorkspaceEvidence,
      } as unknown as StrategyKernelRepository,
      workspaceId,
      allowedActorIds: new Set(["actor-delivery-manager"]),
    });
    const result = await Effect.runPromise(
      source.execute(context({ actorId: "actor-outsider" }), plan()),
    );

    expect(result.items).toEqual([]);
    expect(listWorkspaceIntent).not.toHaveBeenCalled();
    expect(listWorkspaceEvidence).not.toHaveBeenCalled();
  });

  it("labels the setpoint as declared intent in a deterministic delivery answer", async () => {
    const source = createStrategyKernelDeliveryQuerySource({
      repository: repository([intent()], [evidence()]),
      workspaceId,
      allowedActorIds: new Set(["actor-delivery-manager"]),
    });
    const assistant = createDeliveryAssistant({
      sources: [source],
      now: () => new Date(requestedAt),
      totalBudgetMs: 1_000,
      sourceTimeoutMs: 500,
      compositionTimeoutMs: 250,
    });

    const answer = await Effect.runPromise(
      assistant.answer({
        ...context(),
        question: "What are our goals?",
      }),
    );

    expect(answer.text).toContain("Declared intent —");
    expect(answer.citations).toEqual([
      {
        label: "Teams 1",
        url: "https://teams.microsoft.com/l/message/message-1",
      },
    ]);
  });
});

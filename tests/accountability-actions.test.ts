import { describe, expect, it } from "vitest";
import {
  type AccountabilityActionResult,
  type AccountabilityActionTransitionInput,
  type AccountabilityPolicy,
  type ActionCardInteraction,
  assignOwner,
  type CreateAccountabilityActionInput,
  createAccountabilityAction,
  escalateAction,
  markAcknowledged,
  markBlocked,
  markDoneWithEvidence,
  markSent,
  markSilent,
  recordActionCardInteraction,
  requireEvidence,
  setDueDate,
} from "../src/modules/accountability-actions/index.ts";
import type {
  AccountabilityAction,
  Actor,
  DriftFinding,
  EvidenceItem,
  ExternalResourceMapping,
  ExternalSystem,
  ExtractedClaim,
  IntentEdge,
  IntentNode,
  KernelEvent,
  Organization,
  Projection,
  StrategyKernelRepository,
  Workspace,
  WorkspaceActorRole,
  WorkspaceRelation,
} from "../src/modules/strategy-kernel/index.ts";

const now = "2026-07-09T12:00:00.000Z";
const twoHoursLater = "2026-07-09T14:00:00.000Z";
const threeDaysLater = "2026-07-12T12:00:00.000Z";
const workspaceId = "workspace-launchpad";

const policy: AccountabilityPolicy = {
  defaultChannel: "teams_channel",
  silenceAfterHours: 24,
  escalationAfterHours: 48,
  evidenceRequiredForDone: true,
};

const commitment: IntentNode = {
  id: "intent-qa-evidence",
  workspaceId,
  kind: "commitment",
  title: "Attach QA evidence",
  body: "Delivery lead will attach QA evidence before done.",
  ownerActorId: "actor-lead",
  state: "ratified",
  dueAt: "2026-07-10T12:00:00.000Z",
  sensitivity: "internal",
  originEvidenceId: "evidence-qa",
  createdBy: "sarathi",
  createdAt: now,
  updatedAt: now,
};

const goal: IntentNode = {
  ...commitment,
  id: "intent-goal",
  kind: "goal",
  title: "Launch safely",
};

const evidence: EvidenceItem = {
  id: "evidence-qa",
  workspaceId,
  sourceSystem: "github",
  sourceType: "pull_request",
  externalId: "pr-1",
  occurredAt: twoHoursLater,
  title: "QA PR merged",
  bodyExcerpt: "Synthetic QA evidence was attached.",
  contentHash: "sha256-evidence",
  sensitivity: "confidential",
  ingestedAt: twoHoursLater,
};

describe("accountability actions", () => {
  it("creates actions only for ratified or active commitments", async () => {
    const store = createMemoryRepository();
    const input: CreateAccountabilityActionInput = {
      repository: store.repository,
      intent: commitment,
      policy,
      occurredAt: now,
    };
    const result: AccountabilityActionResult = await createAccountabilityAction(input);

    expect(result.action).toMatchObject({
      workspaceId,
      intentNodeId: commitment.id,
      actorId: "actor-lead",
      channel: "teams_channel",
      state: "pending",
      evidenceRequired: true,
      sensitivity: "internal",
    });
    expect(result.event.action).toBe("edited");
    await expect(createAccountabilityAction(input)).rejects.toThrow(/already has open action/);
    await expect(
      createAccountabilityAction({
        repository: store.repository,
        intent: goal,
        policy,
        occurredAt: now,
      }),
    ).rejects.toThrow(/only chases/);
  });

  it("records owner, due date, evidence, sent, acknowledgement, and blocked transitions", async () => {
    const store = createMemoryRepository();
    const created = await createAccountabilityAction({
      repository: store.repository,
      intent: commitment,
      policy,
      occurredAt: now,
    });
    const assigned = await assignOwner({
      repository: store.repository,
      action: created.action,
      ownerActorId: "actor-qa",
      actorId: "actor-lead",
      occurredAt: now,
    });
    const dated = await setDueDate({
      repository: store.repository,
      action: assigned.action,
      dueAt: "2026-07-11T12:00:00.000Z",
      actorId: "actor-lead",
      occurredAt: now,
    });
    const evidencePolicy = await requireEvidence({
      repository: store.repository,
      action: dated.action,
      evidenceRequired: false,
      actorId: "actor-lead",
      occurredAt: now,
    });
    const sent = await markSent({
      repository: store.repository,
      action: evidencePolicy.action,
      actorId: "actor-lead",
      occurredAt: now,
    });
    const acknowledged = await markAcknowledged({
      repository: store.repository,
      action: sent.action,
      actorId: "actor-qa",
      occurredAt: twoHoursLater,
    });
    const blocked = await markBlocked({
      repository: store.repository,
      action: acknowledged.action,
      actorId: "actor-qa",
      reason: "Waiting for QA fixture.",
      occurredAt: twoHoursLater,
    });

    expect(blocked.action).toMatchObject({
      actorId: "actor-qa",
      dueAt: "2026-07-11T12:00:00.000Z",
      evidenceRequired: false,
      state: "blocked",
      lastNudgedAt: now,
    });
    expect(
      (await store.repository.listWorkspaceKernelEvents(workspaceId)).map((event) => event.action),
    ).toEqual(["edited", "edited", "edited", "edited", "nudged", "acknowledged", "blocked"]);
    await expect(
      markSent({
        repository: store.repository,
        action: blocked.action,
        actorId: "actor-lead",
        occurredAt: threeDaysLater,
      }),
    ).rejects.toThrow(/from blocked to sent/);
  });

  it("requires same-workspace evidence before marking evidence-required actions done", async () => {
    const store = createMemoryRepository();
    const created = await createAccountabilityAction({
      repository: store.repository,
      intent: commitment,
      policy,
      occurredAt: now,
    });

    await expect(
      markDoneWithEvidence({
        repository: store.repository,
        action: created.action,
        actorId: "actor-lead",
        occurredAt: twoHoursLater,
      }),
    ).rejects.toThrow(/requires completion evidence/);

    await expect(
      markDoneWithEvidence({
        repository: store.repository,
        action: created.action,
        completionEvidence: { ...evidence, workspaceId: "workspace-other" },
        actorId: "actor-lead",
        occurredAt: twoHoursLater,
      }),
    ).rejects.toThrow(/another workspace/);

    const done = await markDoneWithEvidence({
      repository: store.repository,
      action: created.action,
      completionEvidence: evidence,
      actorId: "actor-lead",
      occurredAt: twoHoursLater,
    });

    expect(done.action).toMatchObject({
      state: "done",
      completionEvidenceId: evidence.id,
      sensitivity: "confidential",
    });
    expect(done.event.action).toBe("completed");
    await expect(
      markSent({
        repository: store.repository,
        action: done.action,
        actorId: "actor-lead",
        occurredAt: threeDaysLater,
      }),
    ).rejects.toThrow(/from done to sent/);
  });

  it("records silence, escalation, and action-card interaction feedback", async () => {
    const store = createMemoryRepository();
    const created = await createAccountabilityAction({
      repository: store.repository,
      intent: commitment,
      policy,
      occurredAt: now,
    });
    const sentInput: AccountabilityActionTransitionInput = {
      repository: store.repository,
      action: created.action,
      actorId: "actor-lead",
      occurredAt: now,
    };
    const sent = await markSent(sentInput);

    await expect(
      markSilent({
        repository: store.repository,
        action: sent.action,
        policy,
        actorId: "actor-lead",
        occurredAt: "not-a-date",
      }),
    ).rejects.toThrow(/invalid timestamp/);

    await expect(
      markSilent({
        repository: store.repository,
        action: sent.action,
        policy,
        actorId: "actor-lead",
        occurredAt: twoHoursLater,
      }),
    ).rejects.toThrow(/before 24 hours/);

    const silent = await markSilent({
      repository: store.repository,
      action: sent.action,
      policy,
      actorId: "actor-lead",
      occurredAt: threeDaysLater,
    });
    const escalated = await escalateAction({
      repository: store.repository,
      action: silent.action,
      policy,
      actorId: "actor-lead",
      occurredAt: threeDaysLater,
    });
    await expect(
      escalateAction({
        repository: store.repository,
        action: escalated.action,
        policy,
        actorId: "actor-lead",
        occurredAt: threeDaysLater,
      }),
    ).rejects.toThrow(/before 48 hours/);
    const interaction: ActionCardInteraction = {
      interactionId: "interaction-1",
      action: escalated.action,
      actorId: "actor-lead",
      response: "comment",
      comment: "Need client confirmation before closing.",
      occurredAt: threeDaysLater,
    };
    const cardEvent = await recordActionCardInteraction(store.repository, interaction);

    expect(escalated.action).toMatchObject({
      state: "escalated",
      escalationLevel: 1,
    });
    expect(JSON.parse(cardEvent.payloadJson)).toMatchObject({
      interactionId: "interaction-1",
      response: "comment",
      eventOnly: true,
    });
    expect(
      (await store.repository.listWorkspaceKernelEvents(workspaceId)).map((event) => event.action),
    ).toEqual(["edited", "nudged", "silent", "escalated", "card_interacted"]);
  });
});

type MemoryRepositoryStore = {
  readonly repository: StrategyKernelRepository;
};

const createMemoryRepository = (): MemoryRepositoryStore => {
  const evidenceItems = new Map<string, EvidenceItem>();
  const claims = new Map<string, ExtractedClaim>();
  const intents = new Map<string, IntentNode>();
  const projections = new Map<string, Projection>();
  const actions = new Map<string, AccountabilityAction>();
  const driftFindings = new Map<string, DriftFinding>();
  const events = new Map<string, KernelEvent>();

  intents.set(commitment.id, commitment);
  intents.set(goal.id, goal);

  const repository: StrategyKernelRepository = {
    withTransaction: async (operation) => operation(repository),
    saveOrganization: async (_organization: Organization) => undefined,
    saveWorkspace: async (_workspace: Workspace) => undefined,
    saveWorkspaceRelation: async (_relation: WorkspaceRelation) => undefined,
    saveActor: async (_actor: Actor) => undefined,
    saveWorkspaceActorRole: async (_role: WorkspaceActorRole) => undefined,
    saveExternalSystem: async (_system: ExternalSystem) => undefined,
    saveExternalResourceMapping: async (_mapping: ExternalResourceMapping) => undefined,
    saveEvidenceItem: async (item) => {
      evidenceItems.set(item.id, item);
    },
    saveExtractedClaim: async (claim) => {
      claims.set(claim.id, claim);
    },
    saveIntentNode: async (node) => {
      intents.set(node.id, node);
    },
    saveIntentEdge: async (_edge: IntentEdge) => undefined,
    saveProjection: async (projection) => {
      projections.set(projection.id, projection);
    },
    saveAccountabilityAction: async (action) => {
      actions.set(action.id, action);
    },
    saveKernelEvent: async (event) => {
      events.set(event.id, event);
    },
    saveDriftFinding: async (finding) => {
      driftFindings.set(finding.id, finding);
    },
    listWorkspaceEvidence: async (workspaceId) =>
      [...evidenceItems.values()].filter((item) => item.workspaceId === workspaceId),
    listWorkspaceIntent: async (workspaceId) =>
      [...intents.values()].filter((intent) => intent.workspaceId === workspaceId),
    listPendingClaims: async (workspaceId) =>
      [...claims.values()].filter(
        (claim) => claim.workspaceId === workspaceId && claim.state === "pending",
      ),
    getExtractedClaim: async (claimId) => claims.get(claimId),
    getIntentNode: async (intentNodeId) => intents.get(intentNodeId),
    listWorkspaceProjections: async (workspaceId) =>
      [...projections.values()].filter((projection) => projection.workspaceId === workspaceId),
    listWorkspaceAccountabilityActions: async (workspaceId) =>
      [...actions.values()].filter((action) => action.workspaceId === workspaceId),
    listWorkspaceDriftFindings: async (workspaceId) =>
      [...driftFindings.values()].filter((finding) => finding.workspaceId === workspaceId),
    listWorkspaceKernelEvents: async (workspaceId) =>
      [...events.values()].filter((event) => event.workspaceId === workspaceId),
  };

  return { repository };
};

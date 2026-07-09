import { describe, expect, it } from "vitest";
import {
  type AcceptClaimInput,
  acceptClaimAsIntent,
  buildEvidenceItem,
  type ClaimExtractionRule,
  type ClaimTransitionResult,
  defaultClaimExtractionRules,
  type EditClaimInput,
  type EvidenceIngestionInput,
  type EvidenceIngestionResult,
  editClaim,
  extractClaimsFromEvidence,
  ingestEvidenceAndExtractClaims,
  type MergeClaimInput,
  mergeClaim,
  type RejectClaimInput,
  rejectClaim,
} from "../src/modules/intent-inbox/index.ts";
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
const later = "2026-07-09T13:00:00.000Z";

const evidenceInput: EvidenceIngestionInput = {
  id: "evidence-teams-1",
  workspaceId: "workspace-launchpad",
  sourceSystem: "teams",
  sourceType: "message",
  externalId: "teams-message-1",
  actorId: "actor-lead",
  occurredAt: now,
  title: "Launch readiness thread",
  bodyExcerpt:
    "I will attach QA evidence by 2026-07-10, but the rollout is blocked by access risk.",
  sensitivity: "confidential",
};

describe("intent inbox", () => {
  it("ingests evidence, extracts deterministic pending claims, and audits inference", async () => {
    const store = createMemoryRepository();
    const result = await ingestEvidenceAndExtractClaims(store.repository, evidenceInput, now);
    const typedResult: EvidenceIngestionResult = result;
    const pendingClaims = await store.repository.listPendingClaims(evidenceInput.workspaceId);

    expect(defaultClaimExtractionRules.length).toBeGreaterThan(0);
    expect(result.evidence.contentHash).toMatch(/^sha256-/);
    expect(typedResult.claims.map((claim) => claim.claimType)).toEqual([
      "possible_commitment",
      "blocker",
      "risk",
    ]);
    expect(result.claims[0]?.suggestedOwnerId).toBe("actor-lead");
    expect(result.claims[0]?.suggestedDueAt).toBe("2026-07-10T23:59:59.000Z");
    expect(result.claims.every((claim) => claim.sensitivity === "confidential")).toBe(true);
    expect(pendingClaims).toEqual(result.claims);
    expect((await store.repository.listWorkspaceEvidence(evidenceInput.workspaceId))[0]).toEqual(
      result.evidence,
    );
    expect(
      (await store.repository.listWorkspaceKernelEvents(evidenceInput.workspaceId)).length,
    ).toBe(4);
  });

  it("keeps extracted claims as candidates until auditable accept/edit/reject/merge transitions", async () => {
    const store = createMemoryRepository();
    const evidence = buildEvidenceItem(evidenceInput, now);
    const [acceptedClaim, rejectedClaim, mergedClaim] = extractClaimsFromEvidence(evidence, now);

    if (acceptedClaim === undefined || rejectedClaim === undefined || mergedClaim === undefined) {
      throw new Error("Expected synthetic fixture to produce at least three claims.");
    }

    await store.repository.saveEvidenceItem(evidence);
    await store.repository.saveExtractedClaim(acceptedClaim);
    await store.repository.saveExtractedClaim(rejectedClaim);
    await store.repository.saveExtractedClaim(mergedClaim);

    const editInput: EditClaimInput = {
      repository: store.repository,
      claim: acceptedClaim,
      actorId: "actor-lead",
      text: "Delivery lead will attach QA evidence by 2026-07-10.",
      suggestedOwnerId: "actor-lead",
      suggestedDueAt: "2026-07-10T23:59:59.000Z",
      sensitivity: "public",
      occurredAt: later,
    };
    const edited: ClaimTransitionResult = await editClaim(editInput);
    const accepted = await acceptClaimAsIntent({
      repository: store.repository,
      claim: edited.claim,
      actorId: "actor-lead",
      title: "Attach QA evidence",
      occurredAt: later,
    } satisfies AcceptClaimInput);
    const rejectInput: RejectClaimInput = {
      repository: store.repository,
      claim: rejectedClaim,
      actorId: "actor-lead",
      reason: "Duplicate operational chatter.",
      occurredAt: later,
    };
    const rejected = await rejectClaim(rejectInput);
    const mergeInput: MergeClaimInput = {
      repository: store.repository,
      claim: mergedClaim,
      actorId: "actor-lead",
      intoIntentNodeId: accepted.intent?.id ?? "intent-missing",
      reason: "Covered by accepted QA commitment.",
      occurredAt: later,
    };
    const merged = await mergeClaim(mergeInput);

    expect(accepted.intent).toMatchObject({
      kind: "commitment",
      state: "ratified",
      originEvidenceId: evidence.id,
      sensitivity: "confidential",
    });
    expect(accepted.claim.state).toBe("accepted");
    expect(accepted.claim.ratifiedNodeId).toBe(accepted.intent?.id);
    expect(rejected.claim.state).toBe("rejected");
    expect(merged.claim).toMatchObject({
      state: "merged",
      ratifiedNodeId: accepted.intent?.id,
    });
    expect((await store.repository.listPendingClaims(evidence.workspaceId)).length).toBe(0);
    expect(await store.repository.listWorkspaceIntent(evidence.workspaceId)).toEqual([
      accepted.intent,
    ]);
    expect(
      (await store.repository.listWorkspaceKernelEvents(evidence.workspaceId)).map(
        (event) => event.action,
      ),
    ).toEqual(["edited", "ratified", "rejected", "merged"]);
  });

  it("allows explicit extraction rules without changing evidence as canonical truth", () => {
    const evidence = buildEvidenceItem(evidenceInput, now);
    const rules: readonly ClaimExtractionRule[] = [
      {
        claimType: "possible_decision",
        pattern: /rollout/i,
        confidence: 0.99,
      },
    ];

    expect(extractClaimsFromEvidence(evidence, later, rules)).toEqual([
      {
        id: "claim:evidence-teams-1:possible_decision:1",
        evidenceItemId: evidence.id,
        workspaceId: evidence.workspaceId,
        claimType: "possible_decision",
        text: `Possible decision: ${evidence.bodyExcerpt}`,
        suggestedDueAt: "2026-07-10T23:59:59.000Z",
        confidence: 0.99,
        state: "pending",
        sensitivity: "confidential",
        createdAt: later,
        updatedAt: later,
      },
    ]);
  });

  it("rejects transitions when the persisted claim has already left the inbox", async () => {
    const store = createMemoryRepository();
    const evidence = buildEvidenceItem(evidenceInput, now);
    const [claim] = extractClaimsFromEvidence(evidence, now);

    if (claim === undefined) {
      throw new Error("Expected synthetic fixture to produce a claim.");
    }

    await store.repository.saveExtractedClaim(claim);
    await rejectClaim({
      repository: store.repository,
      claim,
      actorId: "actor-lead",
      reason: "Not actionable.",
      occurredAt: later,
    });

    await expect(
      acceptClaimAsIntent({
        repository: store.repository,
        claim,
        actorId: "actor-lead",
        occurredAt: later,
      }),
    ).rejects.toThrow(/from rejected/);
  });

  it("tightens target intent sensitivity when merging a higher-sensitivity claim", async () => {
    const store = createMemoryRepository();
    const claim: ExtractedClaim = {
      id: "claim-restricted",
      evidenceItemId: "evidence-restricted",
      workspaceId: evidenceInput.workspaceId,
      claimType: "risk",
      text: "Restricted risk should not downgrade when merged.",
      confidence: 0.9,
      state: "pending",
      sensitivity: "restricted",
      createdAt: now,
      updatedAt: now,
    };
    const targetIntent: IntentNode = {
      id: "intent-public",
      workspaceId: evidenceInput.workspaceId,
      kind: "goal",
      title: "Public launch goal",
      body: "Launch safely.",
      state: "ratified",
      sensitivity: "public",
      createdBy: "human",
      createdAt: now,
      updatedAt: now,
    };

    await store.repository.saveExtractedClaim(claim);
    await store.repository.saveIntentNode(targetIntent);

    const merged = await mergeClaim({
      repository: store.repository,
      claim,
      actorId: "actor-lead",
      intoIntentNodeId: targetIntent.id,
      reason: "Restricted risk affects the public goal.",
      occurredAt: later,
    });

    expect(merged.intent).toMatchObject({
      id: targetIntent.id,
      sensitivity: "restricted",
      updatedAt: later,
    });
    expect((await store.repository.getIntentNode(targetIntent.id))?.sensitivity).toBe("restricted");
  });
});

type MemoryRepositoryStore = {
  readonly repository: StrategyKernelRepository;
};

const createMemoryRepository = (): MemoryRepositoryStore => {
  const evidence = new Map<string, EvidenceItem>();
  const claims = new Map<string, ExtractedClaim>();
  const intents = new Map<string, IntentNode>();
  const projections = new Map<string, Projection>();
  const actions = new Map<string, AccountabilityAction>();
  const driftFindings = new Map<string, DriftFinding>();
  const events = new Map<string, KernelEvent>();

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
      evidence.set(item.id, item);
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
      [...evidence.values()].filter((item) => item.workspaceId === workspaceId),
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

  return {
    repository,
  };
};

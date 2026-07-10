import { describe, expect, it } from "vitest";
import {
  createIntendedProjection,
  determineProjectionDriftStatus,
  type IntendedProjectionInput,
  type ProjectionObservation,
  type ProjectionVerificationResult,
  projectionDriftFinding,
  recordIntendedProjection,
  verifyProjectionAgainstObservation,
} from "../src/modules/projections/index.ts";
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
  ProjectionDriftStatus,
  StrategyKernelRepository,
  Workspace,
  WorkspaceActorRole,
  WorkspaceRelation,
} from "../src/modules/strategy-kernel/index.ts";

const now = "2026-07-09T12:00:00.000Z";
const workspaceId = "workspace-launchpad";

const intent: IntentNode = {
  id: "intent-qa-evidence",
  workspaceId,
  kind: "commitment",
  title: "Attach QA evidence",
  body: "Delivery lead will attach QA evidence before done.",
  ownerActorId: "actor-lead",
  state: "ratified",
  dueAt: "2026-07-10T23:59:59.000Z",
  sensitivity: "internal",
  originEvidenceId: "evidence-qa",
  createdBy: "sarathi",
  createdAt: now,
  updatedAt: now,
};

const relatedEvidence: EvidenceItem = {
  id: "evidence-qa",
  workspaceId,
  sourceSystem: "teams",
  sourceType: "message",
  externalId: "teams-message-1",
  actorId: "actor-lead",
  occurredAt: now,
  title: "QA commitment",
  bodyExcerpt: "I will attach QA evidence.",
  contentHash: "hash-evidence",
  sensitivity: "confidential",
  ingestedAt: now,
};

describe("projections", () => {
  it("creates intended projection records without live external writes", async () => {
    const store = createMemoryRepository();
    const input: IntendedProjectionInput = {
      intent,
      targetSystem: "jira",
      targetType: "issue",
      relatedEvidence: [relatedEvidence],
    };
    const projection = createIntendedProjection(input);
    const event = await recordIntendedProjection(store.repository, projection, now);

    expect(projection).toMatchObject({
      id: "projection:intent-qa-evidence:jira:issue:planned",
      workspaceId,
      intentNodeId: intent.id,
      driftStatus: "missing",
      sensitivity: "confidential",
    });
    expect(projection.lastPublishedHash).toMatch(/^sha256-/);
    expect(event.action).toBe("published");
    expect(JSON.parse(event.payloadJson)).toMatchObject({ intendedOnly: true });
    expect(await store.repository.listWorkspaceProjections(workspaceId)).toEqual([projection]);
  });

  it("classifies projection observations deterministically", () => {
    const projection = createIntendedProjection({
      intent,
      targetSystem: "teams",
      targetType: "card",
      targetId: "card-1",
      publishedHash: "hash-1",
    });
    const cases: readonly [ProjectionObservation, ProjectionDriftStatus][] = [
      [{ authorized: false, exists: true, contentHash: "hash-1" }, "unauthorized"],
      [{ authorized: true, exists: false }, "missing"],
      [{ authorized: true, exists: true, contentHash: "hash-1" }, "in_sync"],
      [
        {
          authorized: true,
          exists: true,
          contentHash: "hash-old",
          managedBySarathi: true,
        },
        "stale",
      ],
      [
        {
          authorized: true,
          exists: true,
          contentHash: "human-edited",
          managedBySarathi: false,
        },
        "conflicting",
      ],
    ];

    expect(cases.map(([state]) => determineProjectionDriftStatus(projection, state))).toEqual(
      cases.map(([, status]) => status),
    );
  });

  it("persists verification events and emits drift findings for non-sync states", async () => {
    const store = createMemoryRepository();
    const projection = createIntendedProjection({
      intent,
      targetSystem: "vault",
      targetType: "note",
      targetId: "note-1",
      publishedHash: "hash-1",
      relatedEvidence: [relatedEvidence],
    });
    const states: readonly ProjectionObservation[] = [
      {
        authorized: true,
        exists: true,
        targetUrl: "https://example.test/note-1",
        contentHash: "hash-1",
      },
      { authorized: true, exists: false },
      {
        authorized: true,
        exists: true,
        contentHash: "hash-old",
        managedBySarathi: true,
      },
      {
        authorized: true,
        exists: true,
        contentHash: "human-edited",
        managedBySarathi: false,
      },
      { authorized: false, exists: true, contentHash: "hash-1" },
    ];

    const results: ProjectionVerificationResult[] = [];
    for (const state of states) {
      results.push(
        await verifyProjectionAgainstObservation(store.repository, projection, state, now),
      );
    }

    expect(results.map((result) => result.projection.driftStatus)).toEqual([
      "in_sync",
      "missing",
      "stale",
      "conflicting",
      "unauthorized",
    ]);
    expect(results[0]?.driftFinding).toBeUndefined();
    expect(
      (await store.repository.listWorkspaceDriftFindings(workspaceId)).map(
        (finding) => finding.findingType,
      ),
    ).toEqual(["projection_drift", "projection_drift", "projection_drift", "projection_drift"]);
    expect(
      (await store.repository.listWorkspaceKernelEvents(workspaceId)).map((event) => event.action),
    ).toEqual(["verified", "drift_detected", "drift_detected", "drift_detected", "drift_detected"]);
  });

  it("builds drift findings tied to projection provenance", () => {
    const projection = createIntendedProjection({
      intent,
      targetSystem: "github",
      targetType: "pull_request",
      targetId: "pr-1",
      publishedHash: "hash-1",
    });

    const finding = projectionDriftFinding(projection, "conflicting", now);

    expect(finding.id).toMatch(
      /^drift:projection:intent-qa-evidence:github:pull_request:pr-1:conflicting:/,
    );
    expect(finding).toMatchObject({
      workspaceId,
      findingType: "projection_drift",
      relatedEntityType: "projection",
      relatedEntityId: projection.id,
      sensitivity: projection.sensitivity,
    });
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

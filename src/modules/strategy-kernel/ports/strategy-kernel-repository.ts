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
  Workspace,
  WorkspaceActorRole,
  WorkspaceRelation,
} from "../domain/strategy-kernel.ts";

export type StrategyKernelRepository = {
  readonly saveOrganization: (organization: Organization) => Promise<void>;
  readonly saveWorkspace: (workspace: Workspace) => Promise<void>;
  readonly saveWorkspaceRelation: (relation: WorkspaceRelation) => Promise<void>;
  readonly saveActor: (actor: Actor) => Promise<void>;
  readonly saveWorkspaceActorRole: (role: WorkspaceActorRole) => Promise<void>;
  readonly saveExternalSystem: (system: ExternalSystem) => Promise<void>;
  readonly saveExternalResourceMapping: (mapping: ExternalResourceMapping) => Promise<void>;
  readonly saveEvidenceItem: (item: EvidenceItem) => Promise<void>;
  readonly saveExtractedClaim: (claim: ExtractedClaim) => Promise<void>;
  readonly saveIntentNode: (node: IntentNode) => Promise<void>;
  readonly saveIntentEdge: (edge: IntentEdge) => Promise<void>;
  readonly saveProjection: (projection: Projection) => Promise<void>;
  readonly saveAccountabilityAction: (action: AccountabilityAction) => Promise<void>;
  readonly saveKernelEvent: (event: KernelEvent) => Promise<void>;
  readonly saveDriftFinding: (finding: DriftFinding) => Promise<void>;
  readonly listWorkspaceEvidence: (workspaceId: string) => Promise<readonly EvidenceItem[]>;
  readonly listWorkspaceIntent: (workspaceId: string) => Promise<readonly IntentNode[]>;
  readonly listPendingClaims: (workspaceId: string) => Promise<readonly ExtractedClaim[]>;
};

import { maxSensitivity, type SensitivityTier } from "../../../domain/policy.ts";

export type Organization = {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type WorkspaceKind =
  | "project"
  | "product"
  | "client_account"
  | "initiative"
  | "operating_unit";

export type Workspace = {
  readonly id: string;
  readonly organizationId: string;
  readonly key: string;
  readonly name: string;
  readonly kind: WorkspaceKind;
  readonly defaultSensitivity: SensitivityTier;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type WorkspaceRelationType =
  | "contains"
  | "depends_on"
  | "peer"
  | "shares_policy"
  | "synthesizes_into";

export type WorkspaceRelation = {
  readonly id: string;
  readonly organizationId: string;
  readonly fromWorkspaceId: string;
  readonly toWorkspaceId: string;
  readonly relationType: WorkspaceRelationType;
  readonly description?: string | undefined;
  readonly createdAt: string;
};

export type ActorKind = "person" | "team" | "bot" | "external_stakeholder";

export type Actor = {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: ActorKind;
  readonly displayName: string;
  readonly externalPrincipalId?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type WorkspaceActorRoleName =
  | "operating_owner"
  | "delivery_manager"
  | "technical_lead"
  | "contributor"
  | "stakeholder"
  | "sarathi";

export type WorkspaceActorRole = {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly role: WorkspaceActorRoleName;
  readonly canRatifyIntent: boolean;
  readonly canApproveSensitivityDowngrade: boolean;
  readonly createdAt: string;
};

export type ExternalSystemKind =
  | "jira"
  | "teams"
  | "github"
  | "pulse"
  | "vault"
  | "email"
  | "meeting"
  | "manual";

export type ExternalSystem = {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: ExternalSystemKind;
  readonly name: string;
  readonly baseUrl?: string | undefined;
  readonly createdAt: string;
};

export type ExternalResourceType =
  | "project"
  | "board"
  | "filter"
  | "team"
  | "channel"
  | "chat"
  | "repository"
  | "folder"
  | "note"
  | "mailbox";

export type ExternalResourceMapping = {
  readonly id: string;
  readonly workspaceId: string;
  readonly externalSystemId: string;
  readonly resourceType: ExternalResourceType;
  readonly externalId: string;
  readonly externalUrl?: string | undefined;
  readonly purpose: "conversation" | "execution" | "evidence" | "governance" | "projection";
  readonly sensitivity: SensitivityTier;
  readonly createdAt: string;
};

export type IntentNodeKind =
  | "goal"
  | "commitment"
  | "bet"
  | "decision"
  | "assumption"
  | "risk"
  | "kpi"
  | "capacity_reservation"
  | "policy";

export type IntentNodeState =
  | "candidate"
  | "ratified"
  | "active"
  | "at_risk"
  | "kept"
  | "broken"
  | "dropped"
  | "superseded"
  | "archived";

export type IntentNode = {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: IntentNodeKind;
  readonly title: string;
  readonly body: string;
  readonly ownerActorId?: string | undefined;
  readonly state: IntentNodeState;
  readonly horizonStart?: string | undefined;
  readonly horizonEnd?: string | undefined;
  readonly dueAt?: string | undefined;
  readonly successSignal?: string | undefined;
  readonly sensitivity: SensitivityTier;
  readonly originEvidenceId?: string | undefined;
  readonly createdBy: "human" | "sarathi" | "import";
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type IntentEdgeType =
  | "supports"
  | "blocks"
  | "supersedes"
  | "part_of"
  | "threatens"
  | "evidences"
  | "implements"
  | "depends_on"
  | "owns";

export type IntentEdge = {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly type: IntentEdgeType;
  readonly confidence: number;
  readonly createdAt: string;
  readonly createdBy: "human" | "sarathi" | "import";
};

export type EvidenceSourceType =
  | "message"
  | "thread"
  | "card_interaction"
  | "issue"
  | "pull_request"
  | "commit"
  | "transcript"
  | "note"
  | "event";

export type EvidenceItem = {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceSystem: ExternalSystemKind;
  readonly sourceType: EvidenceSourceType;
  readonly externalId: string;
  readonly externalUrl?: string | undefined;
  readonly actorId?: string | undefined;
  readonly occurredAt: string;
  readonly title: string;
  readonly bodyExcerpt: string;
  readonly contentHash: string;
  readonly sensitivity: SensitivityTier;
  readonly consentStatus?: "granted" | "not_required" | "unknown" | "withdrawn" | undefined;
  readonly consentScope?: string | undefined;
  readonly consentRecordedAt?: string | undefined;
  readonly consentRecordedBy?: string | undefined;
  readonly ingestedAt: string;
};

export type ExtractedClaimType =
  | "possible_goal"
  | "possible_commitment"
  | "possible_decision"
  | "blocker"
  | "risk"
  | "status_update"
  | "ownership_signal"
  | "evidence_of_done";

export type ExtractedClaimState = "pending" | "accepted" | "edited" | "rejected" | "merged";

export type ExtractedClaim = {
  readonly id: string;
  readonly evidenceItemId: string;
  readonly workspaceId: string;
  readonly claimType: ExtractedClaimType;
  readonly text: string;
  readonly suggestedOwnerId?: string | undefined;
  readonly suggestedDueAt?: string | undefined;
  readonly confidence: number;
  readonly state: ExtractedClaimState;
  readonly sensitivity: SensitivityTier;
  readonly ratifiedNodeId?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ProjectionTargetSystem = "jira" | "teams" | "github" | "vault" | "email";

export type ProjectionTargetType = "issue" | "epic" | "card" | "note" | "pull_request" | "message";

export type ProjectionDriftStatus =
  | "in_sync"
  | "missing"
  | "stale"
  | "conflicting"
  | "unauthorized";

export type Projection = {
  readonly id: string;
  readonly workspaceId: string;
  readonly intentNodeId: string;
  readonly targetSystem: ProjectionTargetSystem;
  readonly targetType: ProjectionTargetType;
  readonly targetId?: string | undefined;
  readonly targetUrl?: string | undefined;
  readonly lastPublishedHash?: string | undefined;
  readonly lastVerifiedAt?: string | undefined;
  readonly driftStatus: ProjectionDriftStatus;
  readonly sensitivity: SensitivityTier;
};

export type AccountabilityChannel = "teams_dm" | "teams_channel" | "email" | "manual";

export type AccountabilityActionState =
  | "pending"
  | "sent"
  | "acknowledged"
  | "blocked"
  | "done"
  | "silent"
  | "escalated"
  | "cancelled";

export type AccountabilityAction = {
  readonly id: string;
  readonly workspaceId: string;
  readonly intentNodeId: string;
  readonly actorId: string;
  readonly channel: AccountabilityChannel;
  readonly state: AccountabilityActionState;
  readonly dueAt?: string | undefined;
  readonly lastNudgedAt?: string | undefined;
  readonly escalationLevel: number;
  readonly evidenceRequired: boolean;
  readonly completionEvidenceId?: string | undefined;
  readonly sensitivity: SensitivityTier;
};

export type KernelEntityType =
  | "organization"
  | "workspace"
  | "workspace_relation"
  | "actor"
  | "external_resource_mapping"
  | "intent_node"
  | "intent_edge"
  | "evidence_item"
  | "extracted_claim"
  | "projection"
  | "accountability_action"
  | "drift_finding";

export type KernelEventAction =
  | "harvested"
  | "inferred"
  | "ratified"
  | "edited"
  | "rejected"
  | "merged"
  | "published"
  | "verified"
  | "drift_detected"
  | "nudged"
  | "card_interacted"
  | "acknowledged"
  | "blocked"
  | "completed"
  | "silent"
  | "escalated"
  | "superseded";

export type KernelEvent = {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorId?: string | undefined;
  readonly entityType: KernelEntityType;
  readonly entityId: string;
  readonly action: KernelEventAction;
  readonly payloadJson: string;
  readonly occurredAt: string;
  readonly sensitivity: SensitivityTier;
};

export type DriftFindingType =
  | "goal_without_work"
  | "work_without_goal"
  | "stale_commitment"
  | "missing_evidence"
  | "projection_drift"
  | "visibility_violation"
  | "silent_action"
  | "policy_conflict"
  | "pack_conflict";

export type DriftFindingState = "open" | "acknowledged" | "resolved" | "superseded";

export type DriftFinding = {
  readonly id: string;
  readonly workspaceId: string;
  readonly findingType: DriftFindingType;
  readonly title: string;
  readonly body: string;
  readonly state: DriftFindingState;
  readonly relatedEntityType?: KernelEntityType | undefined;
  readonly relatedEntityId?: string | undefined;
  readonly sensitivity: SensitivityTier;
  readonly createdAt: string;
  readonly resolvedAt?: string | undefined;
};

export const inheritMostRestrictiveSensitivity = (
  inputs: readonly SensitivityTier[],
): SensitivityTier => inputs.reduce(maxSensitivity, "public");

export const deriveClaimFromEvidence = (
  claim: Omit<ExtractedClaim, "sensitivity">,
  evidence: EvidenceItem,
): ExtractedClaim => ({
  ...claim,
  sensitivity: evidence.sensitivity,
});

export const deriveProjectionSensitivity = (
  intent: IntentNode,
  relatedEvidence: readonly EvidenceItem[],
): SensitivityTier =>
  inheritMostRestrictiveSensitivity([
    intent.sensitivity,
    ...relatedEvidence.map((item) => item.sensitivity),
  ]);

export const deriveAccountabilitySensitivity = (
  intent: IntentNode,
  relatedEvidence: readonly EvidenceItem[],
): SensitivityTier => deriveProjectionSensitivity(intent, relatedEvidence);

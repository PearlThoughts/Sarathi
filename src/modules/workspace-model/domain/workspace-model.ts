import type {
  DelegationStage,
  ModelEgressPolicy,
  PolicyBoundary,
  SensitivityTier,
  TrustTier,
} from "../../../domain/policy.ts";
import type { CommunicationSurface, SourceReference } from "../../../domain/source-systems.ts";

export type OperatingTeam = {
  readonly id: string;
  readonly name: string;
  readonly sourceRefs: readonly SourceReference[];
  readonly communication: readonly CommunicationSurface[];
  readonly declaredSensitivity?: SensitivityTier | undefined;
  readonly declaredTrustTier?: TrustTier | undefined;
};

export type WorkspaceSourceSnapshot = {
  readonly organization: {
    readonly id: string;
    readonly name: string;
  };
  readonly teams: readonly OperatingTeam[];
};

export type TeamOverlay = {
  readonly teamId: string;
  readonly displayName?: string | undefined;
  readonly sensitivity?: SensitivityTier | undefined;
  readonly minimumTrustTier?: TrustTier | undefined;
  readonly allowedDelegationStages?: readonly DelegationStage[] | undefined;
  readonly modelEgress?: ModelEgressPolicy | undefined;
  readonly requiresHumanApproval?: boolean | undefined;
  readonly notes?: string | undefined;
};

export type WorkspaceOverlay = {
  readonly version: 1;
  readonly organizationId: string;
  readonly teams: readonly TeamOverlay[];
};

export type CompiledTeamModel = {
  readonly id: string;
  readonly name: string;
  readonly sourceRefs: readonly SourceReference[];
  readonly communication: readonly CommunicationSurface[];
  readonly boundary: PolicyBoundary;
  readonly overlayApplied: boolean;
  readonly notes?: string | undefined;
};

export type CompiledWorkspaceModel = {
  readonly organization: WorkspaceSourceSnapshot["organization"];
  readonly teams: readonly CompiledTeamModel[];
  readonly generatedAt: string;
  readonly safetyInvariant: "authorization-before-retrieval-tool-and-model-egress";
};

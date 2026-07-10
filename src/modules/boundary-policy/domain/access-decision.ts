import type {
  DelegationStage,
  PolicyBoundary,
  SensitivityTier,
  TrustTier,
} from "../../../domain/policy.ts";

export type BoundaryAction =
  | "read-context"
  | "invoke-tool"
  | "render-report"
  | "create-card"
  | "egress-model"
  | "approve";

export type BoundaryOutputAction = "render-report" | "create-card" | "egress-model";

export type BoundaryAudienceKind =
  | "principal"
  | "workspace"
  | "organization"
  | "external"
  | "model";

export type BoundaryAuthorizationStatus = "not-required" | "granted" | "denied" | "unknown";

export type BoundaryAudience = {
  readonly kind: BoundaryAudienceKind;
  readonly maximumSensitivity: SensitivityTier;
  readonly workspaceId?: string | undefined;
};

export type BoundaryOutputContext = {
  readonly workspaceId: string;
  readonly audience: BoundaryAudience;
  readonly consent: BoundaryAuthorizationStatus;
  readonly actionAuthorization: BoundaryAuthorizationStatus;
  readonly redactionApplied?: boolean | undefined;
};

export type BoundarySubject = {
  readonly principalId: string;
  readonly trustTier: TrustTier;
  readonly authorizedWorkspaceIds?: readonly string[] | undefined;
};

export type BoundaryTarget = {
  readonly type:
    | "organization"
    | "operating-team"
    | "source-thread"
    | "repository"
    | "issue"
    | "policy-boundary"
    | "report"
    | "action-card"
    | "model-context";
  readonly id: string;
  readonly workspaceId?: string | undefined;
  readonly boundary: PolicyBoundary;
};

export type BoundaryAccessRequest = {
  readonly subject: BoundarySubject;
  readonly action: BoundaryAction;
  readonly target: BoundaryTarget;
  readonly requestedDelegationStage?: DelegationStage | undefined;
  readonly output?: BoundaryOutputContext | undefined;
};

export type BoundaryDecisionReason =
  | "allowed"
  | "insufficient-trust"
  | "delegation-stage-denied"
  | "workspace-denied"
  | "audience-workspace-denied"
  | "audience-sensitivity-denied"
  | "consent-denied"
  | "action-denied"
  | "model-egress-denied"
  | "model-redaction-required"
  | "outbound-context-required";

export type BoundaryAccessDecision = {
  readonly allowed: boolean;
  readonly requiresHumanApproval: boolean;
  readonly reason: string;
  readonly reasonCode: BoundaryDecisionReason;
  readonly evaluatedSensitivity: SensitivityTier;
  readonly minimumTrustTier: TrustTier;
};

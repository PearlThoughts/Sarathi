import type {
  DelegationStage,
  PolicyBoundary,
  SensitivityTier,
  TrustTier,
} from "../../../domain/policy.ts";

export type BoundaryAction = "read-context" | "invoke-tool" | "egress-model" | "approve";

export type BoundarySubject = {
  readonly principalId: string;
  readonly trustTier: TrustTier;
};

export type BoundaryTarget = {
  readonly type:
    | "organization"
    | "operating-team"
    | "source-thread"
    | "repository"
    | "issue"
    | "policy-boundary";
  readonly id: string;
  readonly boundary: PolicyBoundary;
};

export type BoundaryAccessRequest = {
  readonly subject: BoundarySubject;
  readonly action: BoundaryAction;
  readonly target: BoundaryTarget;
  readonly requestedDelegationStage?: DelegationStage | undefined;
};

export type BoundaryAccessDecision = {
  readonly allowed: boolean;
  readonly requiresHumanApproval: boolean;
  readonly reason: string;
  readonly evaluatedSensitivity: SensitivityTier;
  readonly minimumTrustTier: TrustTier;
};

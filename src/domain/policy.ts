export type SensitivityTier = "public" | "internal" | "confidential" | "restricted";

export type TrustTier = "guest" | "member" | "trusted" | "maintainer" | "admin";

export type DelegationStage = "answer" | "assist" | "fix" | "coordinate" | "delegated-workflow";

export type ModelEgressPolicy = "allow" | "redact" | "approval-required" | "block";

export type PolicyBoundary = {
  readonly sensitivity: SensitivityTier;
  readonly minimumTrustTier: TrustTier;
  readonly allowedDelegationStages: readonly DelegationStage[];
  readonly modelEgress: ModelEgressPolicy;
  readonly requiresHumanApproval: boolean;
  readonly requiresPreRetrievalAuthorization: boolean;
  readonly requiresToolAuthorization: boolean;
};

const trustOrder: readonly TrustTier[] = ["guest", "member", "trusted", "maintainer", "admin"];

const sensitivityOrder: readonly SensitivityTier[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
];

export const maxSensitivity = (left: SensitivityTier, right: SensitivityTier): SensitivityTier =>
  sensitivityOrder.indexOf(left) >= sensitivityOrder.indexOf(right) ? left : right;

export const maxTrustTier = (left: TrustTier, right: TrustTier): TrustTier =>
  trustOrder.indexOf(left) >= trustOrder.indexOf(right) ? left : right;

export const defaultBoundaryForSensitivity = (sensitivity: SensitivityTier): PolicyBoundary => {
  switch (sensitivity) {
    case "public":
      return {
        sensitivity,
        minimumTrustTier: "guest",
        allowedDelegationStages: ["answer", "assist"],
        modelEgress: "allow",
        requiresHumanApproval: false,
        requiresPreRetrievalAuthorization: true,
        requiresToolAuthorization: true,
      };
    case "internal":
      return {
        sensitivity,
        minimumTrustTier: "member",
        allowedDelegationStages: ["answer", "assist", "coordinate"],
        modelEgress: "redact",
        requiresHumanApproval: false,
        requiresPreRetrievalAuthorization: true,
        requiresToolAuthorization: true,
      };
    case "confidential":
      return {
        sensitivity,
        minimumTrustTier: "trusted",
        allowedDelegationStages: ["answer", "assist", "coordinate"],
        modelEgress: "approval-required",
        requiresHumanApproval: true,
        requiresPreRetrievalAuthorization: true,
        requiresToolAuthorization: true,
      };
    case "restricted":
      return {
        sensitivity,
        minimumTrustTier: "maintainer",
        allowedDelegationStages: ["answer"],
        modelEgress: "block",
        requiresHumanApproval: true,
        requiresPreRetrievalAuthorization: true,
        requiresToolAuthorization: true,
      };
  }
};

import type { TrustTier } from "../../../domain/policy.ts";
import type { BoundaryAccessDecision, BoundaryAccessRequest } from "../domain/access-decision.ts";

const trustScore: Record<TrustTier, number> = {
  guest: 0,
  member: 1,
  trusted: 2,
  maintainer: 3,
  admin: 4,
};

export const evaluateBoundaryAccess = (request: BoundaryAccessRequest): BoundaryAccessDecision => {
  const { boundary } = request.target;
  const hasTrust = trustScore[request.subject.trustTier] >= trustScore[boundary.minimumTrustTier];
  const stageAllowed =
    request.requestedDelegationStage === undefined ||
    boundary.allowedDelegationStages.includes(request.requestedDelegationStage);
  const egressAllowed =
    request.action !== "egress-model" ||
    (boundary.modelEgress !== "block" && boundary.modelEgress !== "approval-required");

  if (!hasTrust) {
    return {
      allowed: false,
      requiresHumanApproval: false,
      reason: `${request.action} requires ${boundary.minimumTrustTier} trust for ${boundary.sensitivity} data`,
      evaluatedSensitivity: boundary.sensitivity,
      minimumTrustTier: boundary.minimumTrustTier,
    };
  }

  if (!stageAllowed) {
    return {
      allowed: false,
      requiresHumanApproval: true,
      reason: `${request.requestedDelegationStage} is outside the boundary delegation stages`,
      evaluatedSensitivity: boundary.sensitivity,
      minimumTrustTier: boundary.minimumTrustTier,
    };
  }

  if (!egressAllowed) {
    return {
      allowed: false,
      requiresHumanApproval: boundary.modelEgress === "approval-required",
      reason: `${request.action} is blocked by ${boundary.modelEgress} model egress policy`,
      evaluatedSensitivity: boundary.sensitivity,
      minimumTrustTier: boundary.minimumTrustTier,
    };
  }

  return {
    allowed: true,
    requiresHumanApproval: boundary.requiresHumanApproval,
    reason: `${request.subject.trustTier} can ${request.action} ${request.target.type}:${request.target.id}`,
    evaluatedSensitivity: boundary.sensitivity,
    minimumTrustTier: boundary.minimumTrustTier,
  };
};

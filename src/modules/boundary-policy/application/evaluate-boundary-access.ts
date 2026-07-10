import { isSensitivityAtOrBelow, type TrustTier } from "../../../domain/policy.ts";
import type {
  BoundaryAccessDecision,
  BoundaryAccessRequest,
  BoundaryDecisionReason,
  BoundaryOutputAction,
} from "../domain/access-decision.ts";

const trustScore: Record<TrustTier, number> = {
  guest: 0,
  member: 1,
  trusted: 2,
  maintainer: 3,
  admin: 4,
};

const outputActions = new Set<BoundaryOutputAction>([
  "render-report",
  "create-card",
  "egress-model",
]);

const targetTypeForOutputAction = {
  "render-report": "report",
  "create-card": "action-card",
  "egress-model": "model-context",
} as const;

const denied = (
  request: BoundaryAccessRequest,
  reasonCode: BoundaryDecisionReason,
  reason: string,
  requiresHumanApproval = false,
): BoundaryAccessDecision => ({
  allowed: false,
  requiresHumanApproval,
  reason,
  reasonCode,
  evaluatedSensitivity: request.target.boundary.sensitivity,
  minimumTrustTier: request.target.boundary.minimumTrustTier,
});

const isAuthorized = (status: "not-required" | "granted" | "denied" | "unknown"): boolean =>
  status === "not-required" || status === "granted";

export const evaluateBoundaryAccess = (request: BoundaryAccessRequest): BoundaryAccessDecision => {
  const { boundary } = request.target;
  const hasTrust = trustScore[request.subject.trustTier] >= trustScore[boundary.minimumTrustTier];
  const stageAllowed =
    request.requestedDelegationStage === undefined ||
    boundary.allowedDelegationStages.includes(request.requestedDelegationStage);
  const egressAllowed =
    request.action !== "egress-model" ||
    (boundary.modelEgress !== "block" && boundary.modelEgress !== "approval-required");

  if (outputActions.has(request.action as BoundaryOutputAction)) {
    if (request.output === undefined || request.target.workspaceId === undefined) {
      return denied(
        request,
        "outbound-context-required",
        "Outbound access requires explicit workspace, audience, consent, and action context.",
      );
    }

    if (request.target.type !== targetTypeForOutputAction[request.action as BoundaryOutputAction]) {
      return denied(
        request,
        "action-denied",
        "The requested outbound action does not match the target type.",
      );
    }

    if ((request.action === "egress-model") !== (request.output.audience.kind === "model")) {
      return denied(request, "action-denied", "Model audiences require the model-egress action.");
    }

    if (
      request.output.workspaceId !== request.target.workspaceId ||
      request.subject.authorizedWorkspaceIds === undefined ||
      !request.subject.authorizedWorkspaceIds.includes(request.target.workspaceId)
    ) {
      return denied(
        request,
        "workspace-denied",
        "Workspace authorization denied for the requested output.",
      );
    }

    if (
      request.output.audience.workspaceId !== undefined &&
      request.output.audience.workspaceId !== request.target.workspaceId
    ) {
      return denied(
        request,
        "audience-workspace-denied",
        "The requested audience belongs to a different workspace.",
      );
    }

    if (!isSensitivityAtOrBelow(boundary.sensitivity, request.output.audience.maximumSensitivity)) {
      return denied(
        request,
        "audience-sensitivity-denied",
        "The derived sensitivity exceeds the audience ceiling.",
      );
    }

    if (!isAuthorized(request.output.consent)) {
      return denied(
        request,
        "consent-denied",
        "Consent is not available for the requested output.",
      );
    }

    if (!isAuthorized(request.output.actionAuthorization)) {
      return denied(request, "action-denied", "The requested outbound action is not authorized.");
    }

    if (
      request.action === "egress-model" &&
      boundary.modelEgress === "redact" &&
      request.output.redactionApplied !== true
    ) {
      return denied(
        request,
        "model-redaction-required",
        "Model egress requires verified redaction for this boundary.",
      );
    }
  }

  if (!hasTrust) {
    return denied(
      request,
      "insufficient-trust",
      `${request.action} requires ${boundary.minimumTrustTier} trust for ${boundary.sensitivity} data`,
    );
  }

  if (!stageAllowed) {
    return denied(
      request,
      "delegation-stage-denied",
      `${request.requestedDelegationStage} is outside the boundary delegation stages`,
      true,
    );
  }

  if (!egressAllowed) {
    return denied(
      request,
      "model-egress-denied",
      `${request.action} is blocked by ${boundary.modelEgress} model egress policy`,
      boundary.modelEgress === "approval-required",
    );
  }

  return {
    allowed: true,
    requiresHumanApproval: boundary.requiresHumanApproval,
    reason: "Boundary access granted.",
    reasonCode: "allowed",
    evaluatedSensitivity: boundary.sensitivity,
    minimumTrustTier: boundary.minimumTrustTier,
  };
};

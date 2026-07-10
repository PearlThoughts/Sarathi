import { describe, expect, it } from "vitest";
import { defaultBoundaryForSensitivity } from "../src/domain/policy.ts";
import {
  type BoundaryAccessRequest,
  type BoundaryOutputContext,
  evaluateBoundaryAccess,
} from "../src/modules/boundary-policy/index.ts";

const workspaceId = "workspace-alpha";

const outboundOutput = (): BoundaryOutputContext => ({
  workspaceId,
  audience: {
    kind: "workspace",
    workspaceId,
    maximumSensitivity: "internal",
  },
  consent: "granted",
  actionAuthorization: "granted",
});

const outboundRequest = (
  overrides: Partial<BoundaryAccessRequest> = {},
): BoundaryAccessRequest => ({
  subject: {
    principalId: "operator-1",
    trustTier: "maintainer",
    authorizedWorkspaceIds: [workspaceId],
  },
  action: "render-report",
  target: {
    type: "report",
    id: "weekly-review",
    workspaceId,
    boundary: defaultBoundaryForSensitivity("internal"),
  },
  output: outboundOutput(),
  ...overrides,
});

describe("boundary policy gate", () => {
  it("denies context reads when trust is below the boundary", () => {
    const decision = evaluateBoundaryAccess({
      subject: {
        principalId: "user-1",
        trustTier: "member",
      },
      action: "read-context",
      target: {
        type: "operating-team",
        id: "finance",
        boundary: defaultBoundaryForSensitivity("confidential"),
      },
    });

    expect(decision).toMatchObject({
      allowed: false,
      requiresHumanApproval: false,
      minimumTrustTier: "trusted",
      evaluatedSensitivity: "confidential",
    });
  });

  it("requires approval when requested delegation exceeds the boundary", () => {
    const decision = evaluateBoundaryAccess({
      subject: {
        principalId: "user-2",
        trustTier: "maintainer",
      },
      action: "invoke-tool",
      requestedDelegationStage: "fix",
      target: {
        type: "operating-team",
        id: "incident-response",
        boundary: defaultBoundaryForSensitivity("restricted"),
      },
    });

    expect(decision).toMatchObject({
      allowed: false,
      requiresHumanApproval: true,
      evaluatedSensitivity: "restricted",
    });
  });

  it("blocks model egress when the boundary requires approval first", () => {
    const decision = evaluateBoundaryAccess({
      subject: {
        principalId: "user-3",
        trustTier: "trusted",
        authorizedWorkspaceIds: [workspaceId],
      },
      action: "egress-model",
      target: {
        type: "model-context",
        id: "delivery-operations",
        workspaceId,
        boundary: defaultBoundaryForSensitivity("confidential"),
      },
      output: {
        workspaceId,
        audience: {
          kind: "model",
          workspaceId,
          maximumSensitivity: "confidential",
        },
        consent: "granted",
        actionAuthorization: "granted",
      },
    });

    expect(decision).toMatchObject({
      allowed: false,
      requiresHumanApproval: true,
      reasonCode: "model-egress-denied",
      evaluatedSensitivity: "confidential",
    });
  });

  it("requires complete outbound context before rendering a report or card", () => {
    const request = outboundRequest({ output: undefined });

    expect(evaluateBoundaryAccess(request)).toMatchObject({
      allowed: false,
      reasonCode: "outbound-context-required",
    });
  });

  it("denies outbound access outside the subject workspace authorization", () => {
    const request = outboundRequest({
      subject: {
        principalId: "operator-1",
        trustTier: "maintainer",
        authorizedWorkspaceIds: ["workspace-beta"],
      },
    });

    expect(evaluateBoundaryAccess(request)).toMatchObject({
      allowed: false,
      reasonCode: "workspace-denied",
    });
  });

  it("denies an output whose strictest sensitivity exceeds the audience ceiling", () => {
    const request = outboundRequest({
      target: {
        type: "report",
        id: "weekly-review",
        workspaceId,
        boundary: defaultBoundaryForSensitivity("restricted"),
      },
    });

    expect(evaluateBoundaryAccess(request)).toMatchObject({
      allowed: false,
      reasonCode: "audience-sensitivity-denied",
      evaluatedSensitivity: "restricted",
    });
  });

  it.each([
    ["consent", "denied", "consent-denied"],
    ["actionAuthorization", "unknown", "action-denied"],
  ] as const)("denies outbound access when %s is %s", (field, status, reasonCode) => {
    const request = outboundRequest({
      output: {
        ...outboundOutput(),
        [field]: status,
      },
    });

    expect(evaluateBoundaryAccess(request)).toMatchObject({ allowed: false, reasonCode });
  });

  it("allows an authorized action card within its workspace and audience ceiling", () => {
    const request = outboundRequest({
      action: "create-card",
      target: {
        type: "action-card",
        id: "commitment-card",
        workspaceId,
        boundary: defaultBoundaryForSensitivity("internal"),
      },
    });

    expect(evaluateBoundaryAccess(request)).toMatchObject({
      allowed: true,
      reasonCode: "allowed",
      evaluatedSensitivity: "internal",
    });
  });

  it("denies an outbound action whose target type does not match", () => {
    const request = outboundRequest({
      action: "create-card",
      target: {
        type: "report",
        id: "not-a-card",
        workspaceId,
        boundary: defaultBoundaryForSensitivity("internal"),
      },
    });

    expect(evaluateBoundaryAccess(request)).toMatchObject({
      allowed: false,
      reasonCode: "action-denied",
    });
  });

  it("requires verified redaction before internal context can leave for a model", () => {
    const request = outboundRequest({
      action: "egress-model",
      target: {
        type: "model-context",
        id: "delivery-context",
        workspaceId,
        boundary: defaultBoundaryForSensitivity("internal"),
      },
      output: {
        ...outboundOutput(),
        audience: {
          kind: "model",
          workspaceId,
          maximumSensitivity: "internal",
        },
      },
    });

    expect(evaluateBoundaryAccess(request)).toMatchObject({
      allowed: false,
      reasonCode: "model-redaction-required",
    });
    expect(
      evaluateBoundaryAccess({
        ...request,
        output: {
          ...outboundOutput(),
          audience: {
            kind: "model",
            workspaceId,
            maximumSensitivity: "internal",
          },
          redactionApplied: true,
        },
      }),
    ).toMatchObject({ allowed: true, reasonCode: "allowed" });
  });
});

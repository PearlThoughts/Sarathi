import { describe, expect, it } from "vitest";
import { defaultBoundaryForSensitivity } from "../src/domain/policy.ts";
import { evaluateBoundaryAccess } from "../src/modules/boundary-policy/index.ts";

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
      },
      action: "egress-model",
      target: {
        type: "operating-team",
        id: "delivery-operations",
        boundary: defaultBoundaryForSensitivity("confidential"),
      },
    });

    expect(decision).toMatchObject({
      allowed: false,
      requiresHumanApproval: true,
      evaluatedSensitivity: "confidential",
    });
  });
});

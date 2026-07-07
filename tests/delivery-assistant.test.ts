import { describe, expect, it } from "vitest";
import {
  canPostWithoutAdditionalApproval,
  defaultTeamProfileFor,
  deliveryAssistantRole,
  storageLayerForPolicyArtifact,
} from "../src/modules/delivery-assistant/index.ts";

describe("delivery assistant role contract", () => {
  it("models Sarathi as an assistant rather than a delivery manager replacement", () => {
    expect(deliveryAssistantRole.category).toBe("AI Delivery Assistant");
    expect(deliveryAssistantRole.assists).toContain("weekly-status");
    expect(deliveryAssistantRole.assists).toContain("process-faq");
    expect(deliveryAssistantRole.never).toContain("client-account-voice");
    expect(deliveryAssistantRole.never).toContain("hidden-people-score");
  });

  it("defaults intern-heavy teams to explicit coaching and DM-first nudges", () => {
    expect(defaultTeamProfileFor("intern-heavy", "delivery-manager")).toMatchObject({
      nudgeIntensity: "high",
      coachingDepth: "step-by-step",
      channelPreference: "dm-first",
      reviewBy: "delivery-manager",
    });
  });

  it("keeps ratified learning in the policy repo layer", () => {
    expect(storageLayerForPolicyArtifact("learned-protocol")).toBe("policy-repo");
    expect(storageLayerForPolicyArtifact("process-faq")).toBe("policy-repo");
  });

  it("does not allow PM-leadership scope to be posted as team-visible without approval", () => {
    expect(
      canPostWithoutAdditionalApproval({
        audience: "pm-leadership",
        requestedBy: "delivery-manager",
        workspaceId: "acme",
        surface: "teams-dm",
        destination: "team-visible",
      }),
    ).toBe(false);
  });
});

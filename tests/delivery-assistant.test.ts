import { describe, expect, it } from "vitest";
import {
  defaultTeamProfileFor,
  deliveryAssistantRole,
  requiresHumanReview,
  storageLayerForPolicyArtifact,
} from "../src/modules/delivery-intelligence/index.ts";

describe("delivery assistant role contract", () => {
  it("models Sarathi as an assistant rather than a delivery manager replacement", () => {
    expect(deliveryAssistantRole.category).toBe("AI Delivery Assistant");
    expect(deliveryAssistantRole.assists).toContain("delivery-status");
    expect(deliveryAssistantRole.assists).toContain("next-action");
    expect(deliveryAssistantRole.assists).toContain("capacity");
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

  it("publishes internal workspace reporting automatically while reviewing external actions", () => {
    expect(requiresHumanReview("internal-workspace-report")).toBe(false);
    expect(requiresHumanReview("external-report")).toBe(true);
    expect(requiresHumanReview("mutating-action")).toBe(true);
  });
});

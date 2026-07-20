export type DeliveryAssistantCapability =
  | "project-scope"
  | "requirements"
  | "delivery-status"
  | "ownership"
  | "capacity"
  | "dependency-analysis"
  | "blocker-detection"
  | "risk-reporting"
  | "recurring-issue-analysis"
  | "decision-context"
  | "next-action"
  | "implementation-context"
  | "activity-reporting"
  | "process-faq";

export type DeliveryAssistantNever =
  | "client-account-voice"
  | "final-priority-owner"
  | "decision-owner"
  | "hidden-people-score"
  | "scope-bypass"
  | "opaque-policy-memory"
  | "unentitled-finance-disclosure";

export type DeliveryAudience = "team-visible" | "pm-leadership" | "personal-dm" | "agent-session";

export type SeniorityMix = "intern-heavy" | "mixed" | "senior-heavy";

export type NudgeIntensity = "light" | "normal" | "high";

export type CoachingDepth = "links-only" | "concise" | "step-by-step";

export type ChannelPreference = "dm-first" | "thread-first" | "leadership-first";

export type TeamProfile = {
  readonly seniorityMix: SeniorityMix;
  readonly nudgeIntensity: NudgeIntensity;
  readonly coachingDepth: CoachingDepth;
  readonly channelPreference: ChannelPreference;
  readonly escalationThreshold: string;
  readonly reviewBy: string;
};

export type PolicyArtifactKind =
  | "project-intent"
  | "milestone-plan"
  | "team-profile"
  | "process-faq"
  | "definition-of-done"
  | "escalation-policy"
  | "learned-protocol";

export type RuntimeStorageLayer =
  | "policy-repo"
  | "postgres-delivery-model"
  | "postgres-knowledge-projection"
  | "postgres-pgvector";

export type DeliveryPublicationKind =
  | "internal-workspace-report"
  | "external-report"
  | "mutating-action";

export const deliveryAssistantRole = {
  category: "AI Delivery Assistant",
  assists: [
    "project-scope",
    "requirements",
    "delivery-status",
    "ownership",
    "capacity",
    "dependency-analysis",
    "blocker-detection",
    "risk-reporting",
    "recurring-issue-analysis",
    "decision-context",
    "next-action",
    "implementation-context",
    "activity-reporting",
    "process-faq",
  ] satisfies readonly DeliveryAssistantCapability[],
  never: [
    "client-account-voice",
    "final-priority-owner",
    "decision-owner",
    "hidden-people-score",
    "scope-bypass",
    "opaque-policy-memory",
    "unentitled-finance-disclosure",
  ] satisfies readonly DeliveryAssistantNever[],
} as const;

export const defaultTeamProfileFor = (
  seniorityMix: SeniorityMix,
  reviewBy: string,
): TeamProfile => {
  switch (seniorityMix) {
    case "intern-heavy":
      return {
        seniorityMix,
        nudgeIntensity: "high",
        coachingDepth: "step-by-step",
        channelPreference: "dm-first",
        escalationThreshold: "4h",
        reviewBy,
      };
    case "mixed":
      return {
        seniorityMix,
        nudgeIntensity: "normal",
        coachingDepth: "concise",
        channelPreference: "thread-first",
        escalationThreshold: "1d",
        reviewBy,
      };
    case "senior-heavy":
      return {
        seniorityMix,
        nudgeIntensity: "light",
        coachingDepth: "links-only",
        channelPreference: "thread-first",
        escalationThreshold: "2d",
        reviewBy,
      };
  }
};

export const storageLayerForPolicyArtifact = (
  artifact: PolicyArtifactKind,
): RuntimeStorageLayer => {
  switch (artifact) {
    case "project-intent":
    case "milestone-plan":
    case "team-profile":
    case "process-faq":
    case "definition-of-done":
    case "escalation-policy":
    case "learned-protocol":
      return "policy-repo";
  }
};

export const requiresHumanReview = (publication: DeliveryPublicationKind): boolean =>
  publication !== "internal-workspace-report";

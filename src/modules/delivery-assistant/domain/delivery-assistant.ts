export type DeliveryAssistantCapability =
  | "process-faq"
  | "weekly-status"
  | "chase-follow-up"
  | "blocker-routing"
  | "drift-detection"
  | "incident-follow-up"
  | "retro-pulse"
  | "leadership-pack"
  | "agent-context-bridge";

export type DeliveryAssistantNever =
  | "client-account-voice"
  | "final-priority-owner"
  | "decision-owner"
  | "hidden-people-score"
  | "scope-bypass"
  | "opaque-policy-memory";

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
  | "sqlite-evidence"
  | "sqlite-loop-state"
  | "lancedb-index";

export type EffectiveDeliveryScope = {
  readonly audience: DeliveryAudience;
  readonly requestedBy: string;
  readonly workspaceId: string;
  readonly surface: "teams-channel" | "teams-thread" | "teams-dm" | "mcp-session";
  readonly destination: DeliveryAudience;
};

export const deliveryAssistantRole = {
  category: "AI Delivery Assistant",
  assists: [
    "process-faq",
    "weekly-status",
    "chase-follow-up",
    "blocker-routing",
    "drift-detection",
    "incident-follow-up",
    "retro-pulse",
    "leadership-pack",
    "agent-context-bridge",
  ] satisfies readonly DeliveryAssistantCapability[],
  never: [
    "client-account-voice",
    "final-priority-owner",
    "decision-owner",
    "hidden-people-score",
    "scope-bypass",
    "opaque-policy-memory",
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

export const canPostWithoutAdditionalApproval = (scope: EffectiveDeliveryScope): boolean =>
  scope.audience === "team-visible" && scope.destination === "team-visible";

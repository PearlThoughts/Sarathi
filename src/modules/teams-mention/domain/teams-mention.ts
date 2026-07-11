import type { PolicyBoundary, SensitivityTier, TrustTier } from "../../../domain/policy.ts";

export type TeamsMentionCommand = {
  readonly activityId: string;
  readonly tenantId: string;
  readonly teamId: string;
  readonly channelId: string;
  readonly conversationId: string;
  readonly rootActivityId: string;
  readonly serviceUrl: string;
  readonly caller: {
    readonly entraObjectId: string;
    readonly displayName: string;
  };
  readonly question: string;
  readonly receivedAt: string;
};

export type ResolvedTeamsMention = {
  readonly workspaceId: string;
  readonly callerId: string;
  readonly callerTrustTier: TrustTier;
  readonly channelSensitivity: SensitivityTier;
  readonly boundary: PolicyBoundary;
};

export type ContextEvidence = {
  readonly source: "teams" | "jira" | "github" | "vault" | "intent";
  readonly sourceId: string;
  readonly sourceUrl: string;
  readonly title: string;
  readonly excerpt: string;
  readonly occurredAt: string;
  readonly updatedAt: string;
  readonly sensitivity: SensitivityTier;
  readonly freshness: "current" | "stale" | "unavailable";
  readonly actorId?: string | undefined;
};

export type AuthorizedContextEnvelope = {
  readonly workspaceId: string;
  readonly question: string;
  readonly evidence: readonly ContextEvidence[];
};

export type GroundedAnswer = {
  readonly text: string;
  readonly citations: readonly {
    readonly label: string;
    readonly url: string;
  }[];
  readonly unavailableSources: readonly string[];
};

export type TeamsMentionOutcome =
  | { readonly kind: "ignored"; readonly reason: "not-a-direct-mention" | "duplicate" }
  | { readonly kind: "denied"; readonly reason: string }
  | { readonly kind: "answered"; readonly answer: GroundedAnswer };

export type TeamsMentionProcessingState =
  | "processing"
  | "delivered"
  | "failed-retryable"
  | "failed-terminal";

export type TeamsMentionLease =
  | { readonly kind: "acquired"; readonly attempt: number }
  | { readonly kind: "duplicate-delivered" }
  | { readonly kind: "in-progress" }
  | { readonly kind: "terminal" };

export const stripSarathiMention = (text: string, botId: string): string =>
  text
    .replace(new RegExp(`<at>${escapeRegExp(botId)}</at>`, "gi"), "")
    .replace(/@Sarathi\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

import type { PolicyBoundary, SensitivityTier, TrustTier } from "../../../domain/policy.ts";

export type TeamsMentionCommand = {
  readonly activityId: string;
  readonly tenantId: string;
  readonly teamId: string;
  readonly graphTeamId: string;
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
  readonly source: "teams" | "jira" | "github" | "vault" | "email" | "intent" | "strategy";
  readonly sourceId: string;
  readonly sourceUrl: string;
  readonly title: string;
  readonly excerpt: string;
  readonly occurredAt: string;
  readonly updatedAt: string;
  readonly sensitivity: SensitivityTier;
  readonly freshness: "current" | "stale" | "unavailable";
  readonly contextRole?: "conversation" | "retrieved" | undefined;
  readonly actorId?: string | undefined;
};

export type DeliveryReportPresentation = {
  readonly kind: "delivery_report";
  readonly period:
    | {
        readonly kind: "absolute";
        readonly fromInclusive: string;
        readonly toExclusive: string;
        readonly timeZone: string;
      }
    | {
        readonly kind: "source_defined";
        readonly reference: string;
        readonly timeZone: string;
      };
  readonly coverage: {
    readonly complete: boolean;
    readonly examinedRecords: number;
    readonly acceptedChanges: number;
    readonly duplicateRecords: number;
    readonly excludedRecords: number;
    readonly unmappedChanges: number;
    readonly unavailableSources: readonly string[];
  };
  readonly capabilitySections: readonly {
    readonly title: string;
    readonly changeCount: number;
    readonly evidencedInitiatives: readonly string[];
  }[];
  readonly episodes: readonly {
    readonly id: string;
    readonly capability: string;
    readonly initiative?: string | undefined;
    readonly title: string;
    readonly lifecycleState:
      | "scoped"
      | "implementing"
      | "development_ready"
      | "qa"
      | "production"
      | "accepted";
    readonly alignment:
      | "governed_initiative"
      | "operational_support"
      | "emerging_requirement"
      | "unaccounted_work";
    readonly owners: readonly string[];
  }[];
  readonly dependencies: readonly {
    readonly waiting: string;
    readonly awaited: string;
    readonly since?: string | undefined;
    readonly requiredAction: string;
    readonly episodeId: string;
  }[];
  readonly decisionsNeeded: readonly string[];
  readonly jiraAdvisories: readonly {
    readonly kind: string;
    readonly episodeId: string;
    readonly message: string;
  }[];
  readonly sprintReview?:
    | {
        readonly previousSprint?: {
          readonly name: string;
          readonly startAt?: string | undefined;
          readonly endAt?: string | undefined;
        };
        readonly currentSprint?: {
          readonly name: string;
          readonly startAt?: string | undefined;
          readonly endAt?: string | undefined;
        };
        readonly previous: {
          readonly plannedAtStart: readonly string[];
          readonly addedDuringSprint: readonly string[];
          readonly completedDuringSprint: readonly string[];
          readonly rolledIntoCurrent: readonly string[];
          readonly dropped: readonly string[];
        };
        readonly current: readonly string[];
        readonly initiatives: readonly {
          readonly title: string;
          readonly health: "Green" | "Amber" | "Red" | "Unknown";
          readonly healthExplanation: string;
          readonly progress: "scoped" | "moving" | "at risk" | "stalled" | "unknown";
          readonly currentSprintEpisodes: readonly string[];
          readonly completedQuarterToDateEpisodes: readonly string[];
          readonly activeEpisodes: readonly string[];
          readonly blockedOrWaitingEpisodes: readonly string[];
          readonly rolloverEpisodes: readonly string[];
        }[];
        readonly noCurrentSprintActivity: readonly string[];
        readonly unaccountedWork: readonly string[];
      }
    | undefined;
};

export type AuthorizedContextEnvelope = {
  readonly workspaceId: string;
  readonly question: string;
  readonly evidence: readonly ContextEvidence[];
  readonly presentation?: DeliveryReportPresentation | undefined;
};

export type GroundedAnswer = {
  readonly text: string;
  readonly citations: readonly {
    readonly label: string;
    readonly url: string;
  }[];
  readonly unavailableSources: readonly string[];
  readonly mentions?: readonly {
    readonly source: "teams";
    readonly externalId: string;
    readonly displayName: string;
  }[];
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

export const stripSarathiMention = (text: string, mentionText: string): string =>
  text
    .replace(new RegExp(escapeRegExp(mentionText), "gi"), "")
    .replace(/\s+/g, " ")
    .trim();

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

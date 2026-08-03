import type { CollaborationSourceScope } from "../../../domain/collaboration-source-scope.ts";
import type { PolicyBoundary, SensitivityTier, TrustTier } from "../../../domain/policy.ts";

export type TeamsChannelConversation = {
  readonly kind: "standard_team_channel" | "private_team_channel" | "shared_team_channel";
  readonly tenantId: string;
  readonly teamId: string;
  readonly graphTeamId: string;
  readonly channelId: string;
};

type InboundTeamsChannelConversation = {
  readonly kind: "team_channel";
  readonly tenantId: string;
  readonly teamId: string;
  readonly graphTeamId: string;
  readonly channelId: string;
};

export type TeamsChatConversation = {
  readonly kind: "group_chat" | "meeting_chat" | "personal_chat";
  readonly tenantId: string;
  readonly chatId: string;
};

export type TeamsConversation = TeamsChannelConversation | TeamsChatConversation;
export type InboundTeamsConversation = InboundTeamsChannelConversation | TeamsChatConversation;

export type TeamsReplyTarget =
  | {
      readonly kind: "channel_thread";
      readonly conversationId: string;
      readonly rootActivityId: string;
    }
  | {
      readonly kind: "chat";
      readonly conversationId: string;
    };

export type TeamsMembershipRequest = {
  readonly conversation: TeamsConversation;
  readonly entraObjectId: string;
};

export type TeamsMembershipEvidence = {
  readonly member: boolean;
  readonly source: "microsoft_graph_roster";
  readonly resolvedAt: string;
  readonly expiresAt: string;
};

export type ResolvedCollaborationAuthorization = {
  readonly effectiveAudience: {
    readonly id: string;
    readonly kind: "team" | "channel" | "chat";
    readonly historyAccess?: "current_roster" | undefined;
    readonly membership:
      | TeamsMembershipEvidence
      | {
          readonly member: true;
          readonly source: "explicit_actor_mapping";
          readonly resolvedAt: string;
        };
  };
  readonly permittedAudienceIds: readonly string[];
  readonly permittedSourceScopes: readonly (CollaborationSourceScope | "legacy_workspace")[];
};

export type TeamsMentionCommand = {
  readonly activityId: string;
  readonly conversation: InboundTeamsConversation;
  readonly replyTarget: TeamsReplyTarget;
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
  readonly conversation: TeamsConversation;
  readonly replyTarget: TeamsReplyTarget;
  readonly authenticatedActorId: string;
  readonly callerId: string;
  readonly callerTrustTier: TrustTier;
  readonly channelSensitivity: SensitivityTier;
  readonly boundary: PolicyBoundary;
  readonly authorization: ResolvedCollaborationAuthorization;
};

export const teamsConversationScopeId = (conversation: InboundTeamsConversation): string =>
  "channelId" in conversation ? conversation.channelId : conversation.chatId;

export const teamsConversationRootActivityId = (command: TeamsMentionCommand): string =>
  command.replyTarget.kind === "channel_thread"
    ? command.replyTarget.rootActivityId
    : command.activityId;

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
  readonly requiredCitationSources: readonly ContextEvidence["source"][];
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

export type CompletionVerdictPresentation = {
  readonly kind: "completion_verdict";
  readonly subject: string;
  readonly requiredVerdict: "yes" | "no" | "cannot_verify";
};

export type AuthorizedContextEnvelope = {
  readonly workspaceId: string;
  readonly question: string;
  readonly evidence: readonly ContextEvidence[];
  readonly presentation?: DeliveryReportPresentation | CompletionVerdictPresentation | undefined;
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

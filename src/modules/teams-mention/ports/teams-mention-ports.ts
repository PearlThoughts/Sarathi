import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { AnswerFeedbackInvitation } from "../../answer-feedback/index.ts";
import type {
  AuthorizedContextEnvelope,
  GroundedAnswer,
  ResolvedTeamsMention,
  TeamsMembershipEvidence,
  TeamsMembershipRequest,
  TeamsMentionCommand,
  TeamsMentionLease,
  TeamsMentionProcessingState,
} from "../domain/teams-mention.ts";

export type TeamsMembershipResolver = {
  readonly resolveMembership: (
    request: TeamsMembershipRequest,
  ) => Effect.Effect<TeamsMembershipEvidence, RepositoryError>;
};

export type TeamsMentionContextAuthorization = {
  readonly allowed: boolean;
};

export type TeamsMentionAuthorizer = {
  readonly authorizeContext: (
    command: TeamsMentionCommand,
    resolved: ResolvedTeamsMention,
  ) => Effect.Effect<TeamsMentionContextAuthorization, RepositoryError>;
};

export type TeamsMentionResolver = {
  readonly resolve: (
    command: TeamsMentionCommand,
  ) => Effect.Effect<ResolvedTeamsMention | undefined, RepositoryError>;
};

export type TeamsMentionContextAssembler = {
  readonly assemble: (
    command: TeamsMentionCommand,
    resolved: ResolvedTeamsMention,
  ) => Effect.Effect<AuthorizedContextEnvelope, RepositoryError>;
};

export type GroundedAnswerGenerator = {
  readonly generate: (
    envelope: AuthorizedContextEnvelope,
  ) => Effect.Effect<GroundedAnswer, RepositoryError>;
};

export type TeamsMentionDelivery = {
  readonly reply: (
    command: TeamsMentionCommand,
    answer: GroundedAnswer,
    feedback?: AnswerFeedbackInvitation | undefined,
  ) => Effect.Effect<void, RepositoryError>;
};

export type TeamsMentionAudit = {
  readonly acquireLease: (activityId: string) => Effect.Effect<TeamsMentionLease, RepositoryError>;
  readonly renewLease: (
    activityId: string,
    attempt: number,
  ) => Effect.Effect<boolean, RepositoryError>;
  readonly markDelivered: (
    activityId: string,
    workspaceId: string,
    attempt: number,
  ) => Effect.Effect<void, RepositoryError>;
  readonly markFailed: (
    activityId: string,
    state: Extract<TeamsMentionProcessingState, "failed-retryable" | "failed-terminal">,
    attempt: number,
    workspaceId?: string | undefined,
  ) => Effect.Effect<void, RepositoryError>;
};

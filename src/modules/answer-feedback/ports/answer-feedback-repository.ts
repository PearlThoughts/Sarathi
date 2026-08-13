import type { Effect } from "effect";
import type {
  AnswerFeedbackAnswer,
  AnswerFeedbackError,
  AnswerFeedbackMetricProjection,
  AnswerFeedbackRevision,
} from "../domain/answer-feedback.ts";

export type AppendAnswerFeedbackRevision = Omit<AnswerFeedbackRevision, "id" | "revision"> & {
  readonly id: string;
};

export type AppendedAnswerFeedbackRevision = {
  readonly revision: AnswerFeedbackRevision;
  readonly idempotent: boolean;
};

export type AnswerFeedbackRepository = {
  readonly registerAnswer: (
    answer: AnswerFeedbackAnswer,
  ) => Effect.Effect<AnswerFeedbackAnswer, AnswerFeedbackError>;
  readonly markAnswerDelivered: (answerId: string) => Effect.Effect<void, AnswerFeedbackError>;
  readonly abandonAnswer: (answerId: string) => Effect.Effect<void, AnswerFeedbackError>;
  readonly findAnswer: (
    answerId: string,
  ) => Effect.Effect<AnswerFeedbackAnswer | undefined, AnswerFeedbackError>;
  readonly appendRevision: (
    revision: AppendAnswerFeedbackRevision,
  ) => Effect.Effect<AppendedAnswerFeedbackRevision, AnswerFeedbackError>;
  readonly listRevisions: (
    answerId: string,
    actorId: string,
  ) => Effect.Effect<readonly AnswerFeedbackRevision[], AnswerFeedbackError>;
  readonly listCurrentMetricProjections: (
    workspaceId?: string | undefined,
  ) => Effect.Effect<readonly AnswerFeedbackMetricProjection[], AnswerFeedbackError>;
};

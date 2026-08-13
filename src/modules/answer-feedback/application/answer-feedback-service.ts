import { Effect } from "effect";
import { stableSha256 } from "../../../domain/hash.ts";
import {
  type AnswerFeedbackAction,
  type AnswerFeedbackActorContext,
  type AnswerFeedbackAggregate,
  type AnswerFeedbackAnswer,
  AnswerFeedbackError,
  type AnswerFeedbackGenerationContext,
  type AnswerFeedbackRevision,
  summarizeAnswerFeedback,
} from "../domain/answer-feedback.ts";
import type { AnswerFeedbackRepository } from "../ports/answer-feedback-repository.ts";

export type PrepareAnswerFeedback = AnswerFeedbackGenerationContext & {
  readonly workspaceId: string;
  readonly recipientActorId: string;
  readonly conversationBoundaryHash: string;
  readonly sourceActivityId: string;
  readonly answerText: string;
  readonly questionText: string;
  readonly generatedAt?: string | undefined;
};

export type AnswerFeedbackInvitation = {
  readonly answerId: string;
};

export type SubmittedAnswerFeedback = {
  readonly answer: AnswerFeedbackAnswer;
  readonly revision: AnswerFeedbackRevision;
  readonly idempotent: boolean;
};

export type AnswerFeedbackService = {
  readonly prepareAnswer: (
    input: PrepareAnswerFeedback,
  ) => Effect.Effect<AnswerFeedbackInvitation, AnswerFeedbackError>;
  readonly markAnswerDelivered: (answerId: string) => Effect.Effect<void, AnswerFeedbackError>;
  readonly abandonAnswer: (answerId: string) => Effect.Effect<void, AnswerFeedbackError>;
  readonly submit: (
    action: AnswerFeedbackAction,
    actor: AnswerFeedbackActorContext,
  ) => Effect.Effect<SubmittedAnswerFeedback, AnswerFeedbackError>;
  readonly metrics: (
    workspaceId?: string | undefined,
  ) => Effect.Effect<AnswerFeedbackAggregate, AnswerFeedbackError>;
};

type AnswerFeedbackServiceConfiguration = {
  readonly now?: (() => Date) | undefined;
  readonly randomUuid?: (() => string) | undefined;
};

const defaultUuid = (): string => crypto.randomUUID();

export const createAnswerFeedbackService = (
  repository: AnswerFeedbackRepository,
  configuration: AnswerFeedbackServiceConfiguration = {},
): AnswerFeedbackService => {
  const now = configuration.now ?? (() => new Date());
  const randomUuid = configuration.randomUuid ?? defaultUuid;

  return {
    prepareAnswer: (input) => {
      const answer: AnswerFeedbackAnswer = {
        id: `af_${randomUuid()}`,
        workspaceId: input.workspaceId,
        recipientActorId: input.recipientActorId,
        conversationBoundaryHash: input.conversationBoundaryHash,
        sourceActivityHash: stableSha256(input.sourceActivityId),
        answerFingerprint: stableSha256(input.answerText),
        queryFingerprint: stableSha256(input.questionText),
        answerText: input.answerText,
        questionText: input.questionText,
        modelName: input.modelName,
        reasoningConfiguration: input.reasoningConfiguration,
        applicationRevision: input.applicationRevision,
        ...(input.promptConfigurationRevision === undefined
          ? {}
          : { promptConfigurationRevision: input.promptConfigurationRevision }),
        ...(input.productRegistryRevision === undefined
          ? {}
          : { productRegistryRevision: input.productRegistryRevision }),
        ...(input.retrievalFingerprint === undefined
          ? {}
          : { retrievalFingerprint: input.retrievalFingerprint }),
        responseProduct: input.responseProduct,
        queryFamily: input.queryFamily,
        generatedAt: input.generatedAt ?? now().toISOString(),
        state: "prepared",
      };
      return repository
        .registerAnswer(answer)
        .pipe(Effect.map((registered) => ({ answerId: registered.id })));
    },
    markAnswerDelivered: repository.markAnswerDelivered,
    abandonAnswer: repository.abandonAnswer,
    submit: (action, actor) =>
      Effect.gen(function* () {
        if (!actor.permitted)
          return yield* Effect.fail(
            new AnswerFeedbackError("actor_not_permitted", "Feedback actor is not permitted."),
          );
        const answer = yield* repository.findAnswer(action.answerId);
        if (answer === undefined)
          return yield* Effect.fail(
            new AnswerFeedbackError("unknown_answer", "Feedback answer is unknown."),
          );
        if (answer.state === "abandoned")
          return yield* Effect.fail(
            new AnswerFeedbackError("answer_not_delivered", "Feedback answer was not delivered."),
          );
        if (answer.workspaceId !== actor.workspaceId)
          return yield* Effect.fail(
            new AnswerFeedbackError("workspace_mismatch", "Feedback workspace does not match."),
          );
        if (answer.conversationBoundaryHash !== actor.conversationBoundaryHash)
          return yield* Effect.fail(
            new AnswerFeedbackError(
              "conversation_mismatch",
              "Feedback conversation does not match.",
            ),
          );
        const appended = yield* repository.appendRevision({
          id: `fr_${randomUuid()}`,
          answerId: answer.id,
          workspaceId: answer.workspaceId,
          actorId: actor.actorId,
          rating: action.rating,
          reasons: action.reasons,
          ...(action.correction === undefined ? {} : { correction: action.correction }),
          idempotencyKeyHash: stableSha256(action.idempotencyKey),
          submittedAt: now().toISOString(),
          reviewDisposition: "unreviewed",
        });
        return { answer, ...appended };
      }),
    metrics: (workspaceId) =>
      repository
        .listCurrentMetricProjections(workspaceId)
        .pipe(Effect.map(summarizeAnswerFeedback)),
  };
};

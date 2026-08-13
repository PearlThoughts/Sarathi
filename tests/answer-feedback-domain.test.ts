import { Either } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AnswerFeedbackAction,
  type AnswerFeedbackActorContext,
  type AnswerFeedbackAggregate,
  type AnswerFeedbackAnswer,
  type AnswerFeedbackCurrent,
  type AnswerFeedbackErrorCode,
  type AnswerFeedbackRepository,
  type AnswerFeedbackRevision,
  type AppendAnswerFeedbackRevision,
  type AppendedAnswerFeedbackRevision,
  answerFeedbackRatings,
  answerFeedbackReasons,
  type CorrectedAnswerCandidate,
  correctedAnswerCandidate,
  decodeAnswerFeedbackAction,
  type FeedbackImprovementLane,
  feedbackImprovementLane,
  feedbackReviewDispositions,
  summarizeAnswerFeedback,
} from "../src/modules/answer-feedback/index.ts";

const answerId = "af_11111111-1111-4111-8111-111111111111";
const idempotencyKey = "fi_22222222-2222-4222-8222-222222222222";

describe("answer feedback domain", () => {
  it("exports the complete application and repository contract", () => {
    expect(answerFeedbackRatings).toEqual(["useful_as_is", "partly_useful", "not_useful"]);
    expect(feedbackReviewDispositions).toEqual([
      "unreviewed",
      "accepted_for_evaluation",
      "accepted_for_training",
      "rejected",
    ]);
    expectTypeOf<AnswerFeedbackAction>().toBeObject();
    expectTypeOf<AnswerFeedbackActorContext>().toBeObject();
    expectTypeOf<AnswerFeedbackAggregate>().toBeObject();
    expectTypeOf<AnswerFeedbackCurrent>().toBeObject();
    expectTypeOf<AnswerFeedbackErrorCode>().toBeString();
    expectTypeOf<AnswerFeedbackRepository>().toBeObject();
    expectTypeOf<AppendAnswerFeedbackRevision>().toBeObject();
    expectTypeOf<AppendedAnswerFeedbackRevision>().toBeObject();
    expectTypeOf<CorrectedAnswerCandidate>().toBeObject();
    expectTypeOf<FeedbackImprovementLane>().toBeString();
  });
  it.each([
    "useful_as_is",
    "partly_useful",
    "not_useful",
  ] as const)("decodes the %s rating", (rating) => {
    const decoded = decodeAnswerFeedbackAction({ answerId, idempotencyKey, rating });
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) expect(decoded.right.rating).toBe(rating);
  });

  it("decodes multiple reasons and an optional correction", () => {
    const decoded = decodeAnswerFeedbackAction({
      answerId,
      idempotencyKey,
      rating: "partly_useful",
      feedbackReasons: "irrelevant,wrong_delivery_status,too_detailed",
      feedbackCorrection: "Lead with the unresolved deployment evidence.",
    });

    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded))
      expect(decoded.right).toEqual({
        answerId,
        idempotencyKey,
        rating: "partly_useful",
        reasons: ["irrelevant", "wrong_delivery_status", "too_detailed"],
        correction: "Lead with the unresolved deployment evidence.",
      });
  });

  it("allows partial feedback without correction or selected reasons", () => {
    const decoded = decodeAnswerFeedbackAction({
      answerId,
      idempotencyKey,
      rating: "not_useful",
      feedbackReasons: "",
      feedbackCorrection: "",
    });

    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded))
      expect(decoded.right).toEqual({
        answerId,
        idempotencyKey,
        rating: "not_useful",
        reasons: [],
      });
  });

  it("rejects malformed, unknown, duplicate, or excessive input", () => {
    const cases = [
      { value: null, code: "malformed_action" },
      {
        value: { answerId, idempotencyKey, rating: "excellent" },
        code: "invalid_rating",
      },
      {
        value: {
          answerId,
          idempotencyKey,
          rating: "partly_useful",
          feedbackReasons: "invented",
        },
        code: "invalid_reason",
      },
      {
        value: {
          answerId,
          idempotencyKey,
          rating: "partly_useful",
          feedbackReasons: "stale,stale",
        },
        code: "malformed_action",
      },
      {
        value: {
          answerId,
          idempotencyKey,
          rating: "not_useful",
          feedbackCorrection: "x".repeat(2_001),
        },
        code: "correction_too_long",
      },
      {
        value: { answerId, idempotencyKey, rating: "useful_as_is", arbitraryUrl: "https://x" },
        code: "malformed_action",
      },
    ] as const;

    for (const testCase of cases) {
      const decoded = decodeAnswerFeedbackAction(testCase.value);
      expect(Either.isLeft(decoded)).toBe(true);
      if (Either.isLeft(decoded)) expect(decoded.left.code).toBe(testCase.code);
    }
  });

  it("routes every reason to a responsible improvement lane", () => {
    expect(answerFeedbackReasons.map(feedbackImprovementLane)).toEqual([
      "query_interpretation_or_ranking",
      "retrieval_or_episode_construction",
      "ontology_or_entity_resolution",
      "lifecycle_reducer",
      "relationship_resolution",
      "episode_consolidation",
      "composition_or_presentation",
      "composition_or_presentation",
      "composition_or_presentation",
      "synchronization_or_freshness",
      "review_required",
    ]);
  });

  it("aggregates only privacy-safe current projections", () => {
    const aggregate = summarizeAnswerFeedback([
      {
        rating: "useful_as_is",
        reasons: [],
        hasCorrection: false,
        queryFamily: "status",
        modelName: "model-a",
        reasoningConfiguration: "medium",
        applicationRevision: "rev-1",
        promptConfigurationRevision: "prompt-1",
        reviewDisposition: "accepted_for_evaluation",
      },
      {
        rating: "partly_useful",
        reasons: ["missing_material_work", "too_detailed"],
        hasCorrection: true,
        queryFamily: "status",
        modelName: "model-a",
        reasoningConfiguration: "medium",
        applicationRevision: "rev-1",
        promptConfigurationRevision: "prompt-1",
        reviewDisposition: "unreviewed",
      },
      {
        rating: "not_useful",
        reasons: ["wrong_capability_mapping"],
        hasCorrection: false,
        queryFamily: "period_delivery",
        modelName: "model-b",
        reasoningConfiguration: "provider_default",
        applicationRevision: "rev-2",
        reviewDisposition: "rejected",
      },
    ]);

    expect(aggregate.total).toBe(3);
    expect(aggregate.ratings.useful_as_is).toEqual({ count: 1, rate: 0.3333 });
    expect(aggregate.ratings.partly_useful).toEqual({ count: 1, rate: 0.3333 });
    expect(aggregate.ratings.not_useful).toEqual({ count: 1, rate: 0.3333 });
    expect(aggregate.reasons.missing_material_work).toBe(1);
    expect(aggregate.corrections).toEqual({ count: 1, rate: 0.3333 });
    expect(aggregate.byQueryFamily).toEqual([
      { queryFamily: "period_delivery", count: 1 },
      { queryFamily: "status", count: 2 },
    ]);
    expect(aggregate.byModelConfiguration).toHaveLength(2);
    expect(aggregate.reviews).toEqual({
      unreviewed: 1,
      accepted_for_evaluation: 1,
      accepted_for_training: 0,
      rejected: 1,
    });
    expect(JSON.stringify(aggregate)).not.toContain("correction text");
  });

  it("derives a corrected training candidate only after explicit training review", () => {
    const answer: AnswerFeedbackAnswer = {
      id: answerId,
      workspaceId: "workspace",
      recipientActorId: "recipient",
      conversationBoundaryHash: "sha256-conversation",
      sourceActivityHash: "sha256-activity",
      answerFingerprint: "sha256-answer",
      queryFingerprint: "sha256-query",
      answerText: "Original answer",
      questionText: "Question",
      modelName: "model",
      reasoningConfiguration: "medium",
      applicationRevision: "revision",
      responseProduct: "operational_answer",
      queryFamily: "status",
      generatedAt: "2026-08-13T10:00:00.000Z",
      state: "delivered",
    };
    const revision: AnswerFeedbackRevision = {
      id: "fr_33333333-3333-4333-8333-333333333333",
      answerId,
      workspaceId: "workspace",
      actorId: "actor",
      revision: 1,
      rating: "not_useful",
      reasons: ["wrong_delivery_status"],
      correction: "Corrected answer",
      idempotencyKeyHash: "sha256-idempotency",
      submittedAt: "2026-08-13T10:01:00.000Z",
      reviewDisposition: "unreviewed",
    };

    expect(correctedAnswerCandidate(answer, revision)).toBeUndefined();
    expect(
      correctedAnswerCandidate(answer, {
        ...revision,
        reviewDisposition: "accepted_for_evaluation",
        reviewedByActorId: "reviewer",
        reviewedAt: "2026-08-13T11:00:00.000Z",
      }),
    ).toBeUndefined();
    expect(
      correctedAnswerCandidate(answer, {
        ...revision,
        reviewDisposition: "accepted_for_training",
        reviewedByActorId: "reviewer",
        reviewedAt: "2026-08-13T11:00:00.000Z",
      }),
    ).toEqual({
      answerId,
      answerFingerprint: "sha256-answer",
      queryFingerprint: "sha256-query",
      question: "Question",
      originalAnswer: "Original answer",
      failureReasons: ["wrong_delivery_status"],
      correctedAnswer: "Corrected answer",
      feedbackRevision: 1,
      reviewedAt: "2026-08-13T11:00:00.000Z",
    });
  });
});

import { Either } from "effect";

export const answerFeedbackRatings = ["useful_as_is", "partly_useful", "not_useful"] as const;
export type AnswerFeedbackRating = (typeof answerFeedbackRatings)[number];

export const answerFeedbackReasons = [
  "irrelevant",
  "missing_material_work",
  "wrong_capability_mapping",
  "wrong_delivery_status",
  "wrong_owner_or_dependency",
  "duplicate_activity",
  "difficult_to_understand",
  "too_detailed",
  "insufficient_detail",
  "stale",
  "other",
] as const;
export type AnswerFeedbackReason = (typeof answerFeedbackReasons)[number];

export const feedbackReviewDispositions = [
  "unreviewed",
  "accepted_for_evaluation",
  "accepted_for_training",
  "rejected",
] as const;
export type FeedbackReviewDisposition = (typeof feedbackReviewDispositions)[number];

export type FeedbackImprovementLane =
  | "query_interpretation_or_ranking"
  | "retrieval_or_episode_construction"
  | "ontology_or_entity_resolution"
  | "lifecycle_reducer"
  | "relationship_resolution"
  | "episode_consolidation"
  | "composition_or_presentation"
  | "synchronization_or_freshness"
  | "review_required";

export type AnswerFeedbackAnswerState = "prepared" | "delivered" | "abandoned";

export type AnswerFeedbackGenerationContext = {
  readonly modelName: string;
  readonly reasoningConfiguration: string;
  readonly applicationRevision: string;
  readonly promptConfigurationRevision?: string | undefined;
  readonly productRegistryRevision?: string | undefined;
  readonly retrievalFingerprint?: string | undefined;
  readonly responseProduct: string;
  readonly queryFamily: string;
};

export type AnswerFeedbackAnswer = AnswerFeedbackGenerationContext & {
  readonly id: string;
  readonly workspaceId: string;
  readonly recipientActorId: string;
  readonly conversationBoundaryHash: string;
  readonly sourceActivityHash: string;
  readonly answerFingerprint: string;
  readonly queryFingerprint: string;
  readonly answerText: string;
  readonly questionText: string;
  readonly generatedAt: string;
  readonly state: AnswerFeedbackAnswerState;
};

export type AnswerFeedbackRevision = {
  readonly id: string;
  readonly answerId: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly revision: number;
  readonly rating: AnswerFeedbackRating;
  readonly reasons: readonly AnswerFeedbackReason[];
  readonly correction?: string | undefined;
  readonly idempotencyKeyHash: string;
  readonly submittedAt: string;
  readonly reviewDisposition: FeedbackReviewDisposition;
  readonly reviewedByActorId?: string | undefined;
  readonly reviewedAt?: string | undefined;
};

export type AnswerFeedbackCurrent = {
  readonly answerId: string;
  readonly actorId: string;
  readonly revisionId: string;
  readonly updatedAt: string;
};

export type AnswerFeedbackAction = {
  readonly answerId: string;
  readonly idempotencyKey: string;
  readonly rating: AnswerFeedbackRating;
  readonly reasons: readonly AnswerFeedbackReason[];
  readonly correction?: string | undefined;
};

export type AnswerFeedbackActorContext = {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly conversationBoundaryHash: string;
  readonly permitted: boolean;
};

export type AnswerFeedbackMetricProjection = {
  readonly rating: AnswerFeedbackRating;
  readonly reasons: readonly AnswerFeedbackReason[];
  readonly hasCorrection: boolean;
  readonly queryFamily: string;
  readonly modelName: string;
  readonly reasoningConfiguration: string;
  readonly applicationRevision: string;
  readonly promptConfigurationRevision?: string | undefined;
  readonly reviewDisposition: FeedbackReviewDisposition;
};

export type AnswerFeedbackAggregate = {
  readonly total: number;
  readonly ratings: Readonly<Record<AnswerFeedbackRating, { count: number; rate: number }>>;
  readonly reasons: Readonly<Record<AnswerFeedbackReason, number>>;
  readonly corrections: { readonly count: number; readonly rate: number };
  readonly byQueryFamily: readonly {
    readonly queryFamily: string;
    readonly count: number;
  }[];
  readonly byModelConfiguration: readonly {
    readonly modelName: string;
    readonly reasoningConfiguration: string;
    readonly applicationRevision: string;
    readonly promptConfigurationRevision?: string | undefined;
    readonly count: number;
  }[];
  readonly reviews: Readonly<Record<FeedbackReviewDisposition, number>>;
};

export type CorrectedAnswerCandidate = {
  readonly answerId: string;
  readonly answerFingerprint: string;
  readonly queryFingerprint: string;
  readonly question: string;
  readonly originalAnswer: string;
  readonly failureReasons: readonly AnswerFeedbackReason[];
  readonly correctedAnswer: string;
  readonly feedbackRevision: number;
  readonly reviewedAt: string;
};

export type AnswerFeedbackErrorCode =
  | "malformed_action"
  | "unknown_answer"
  | "answer_not_delivered"
  | "actor_not_permitted"
  | "workspace_mismatch"
  | "conversation_mismatch"
  | "invalid_rating"
  | "invalid_reason"
  | "invalid_identifier"
  | "correction_too_long"
  | "persistence_unavailable";

export class AnswerFeedbackError extends Error {
  readonly code: AnswerFeedbackErrorCode;

  constructor(code: AnswerFeedbackErrorCode, message: string) {
    super(message);
    this.name = "AnswerFeedbackError";
    this.code = code;
  }
}

const ratingSet = new Set<string>(answerFeedbackRatings);
const reasonSet = new Set<string>(answerFeedbackReasons);
const allowedActionKeys = new Set([
  "answerId",
  "idempotencyKey",
  "rating",
  "feedbackReasons",
  "feedbackCorrection",
]);
const opaqueAnswerId = /^af_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const opaqueIdempotencyKey =
  /^fi_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const unicodeLength = (value: string): number => [...value].length;

const malformed = (message: string): Either.Either<never, AnswerFeedbackError> =>
  Either.left(new AnswerFeedbackError("malformed_action", message));

export const decodeAnswerFeedbackAction = (
  value: unknown,
): Either.Either<AnswerFeedbackAction, AnswerFeedbackError> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return malformed("Feedback action must be an object.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedActionKeys.has(key)))
    return malformed("Feedback action contains unsupported fields.");
  if (typeof record.answerId !== "string" || !opaqueAnswerId.test(record.answerId))
    return Either.left(
      new AnswerFeedbackError("invalid_identifier", "Feedback answer identifier is invalid."),
    );
  if (
    typeof record.idempotencyKey !== "string" ||
    !opaqueIdempotencyKey.test(record.idempotencyKey)
  )
    return Either.left(
      new AnswerFeedbackError("invalid_identifier", "Feedback submission identifier is invalid."),
    );
  if (typeof record.rating !== "string" || !ratingSet.has(record.rating))
    return Either.left(new AnswerFeedbackError("invalid_rating", "Feedback rating is invalid."));

  const serializedReasons = record.feedbackReasons;
  if (serializedReasons !== undefined && typeof serializedReasons !== "string")
    return malformed("Feedback reasons must be a comma-separated string.");
  const reasons = (serializedReasons ?? "")
    .split(",")
    .map((reason) => reason.trim())
    .filter((reason) => reason !== "");
  if (reasons.some((reason) => !reasonSet.has(reason)))
    return Either.left(new AnswerFeedbackError("invalid_reason", "Feedback reason is invalid."));
  if (new Set(reasons).size !== reasons.length)
    return malformed("Feedback reasons must be unique.");

  const correctionValue = record.feedbackCorrection;
  if (correctionValue !== undefined && typeof correctionValue !== "string")
    return malformed("Feedback correction must be text.");
  const correction = correctionValue?.trim();
  if (correction !== undefined && unicodeLength(correction) > 2_000)
    return Either.left(
      new AnswerFeedbackError(
        "correction_too_long",
        "Feedback correction must not exceed 2,000 characters.",
      ),
    );
  if (record.rating === "useful_as_is" && (reasons.length > 0 || correction !== undefined))
    return malformed("Useful-as-is feedback cannot include improvement details.");

  return Either.right({
    answerId: record.answerId,
    idempotencyKey: record.idempotencyKey,
    rating: record.rating as AnswerFeedbackRating,
    reasons: reasons as readonly AnswerFeedbackReason[],
    ...(correction === undefined || correction === "" ? {} : { correction }),
  });
};

export const feedbackImprovementLane = (reason: AnswerFeedbackReason): FeedbackImprovementLane => {
  switch (reason) {
    case "irrelevant":
      return "query_interpretation_or_ranking";
    case "missing_material_work":
      return "retrieval_or_episode_construction";
    case "wrong_capability_mapping":
      return "ontology_or_entity_resolution";
    case "wrong_delivery_status":
      return "lifecycle_reducer";
    case "wrong_owner_or_dependency":
      return "relationship_resolution";
    case "duplicate_activity":
      return "episode_consolidation";
    case "difficult_to_understand":
    case "too_detailed":
    case "insufficient_detail":
      return "composition_or_presentation";
    case "stale":
      return "synchronization_or_freshness";
    case "other":
      return "review_required";
  }
};

const rate = (count: number, total: number): number =>
  total === 0 ? 0 : Number((count / total).toFixed(4));

const groupedCounts = <Key extends string>(keys: readonly Key[]): Record<Key, number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<Key, number>;

export const summarizeAnswerFeedback = (
  projections: readonly AnswerFeedbackMetricProjection[],
): AnswerFeedbackAggregate => {
  const total = projections.length;
  const ratingCounts = groupedCounts(answerFeedbackRatings);
  const reasonCounts = groupedCounts(answerFeedbackReasons);
  const reviewCounts = groupedCounts(feedbackReviewDispositions);
  const queryFamilies = new Map<string, number>();
  const modelConfigurations = new Map<
    string,
    Omit<AnswerFeedbackAggregate["byModelConfiguration"][number], "count"> & { count: number }
  >();
  let corrections = 0;

  for (const projection of projections) {
    ratingCounts[projection.rating] += 1;
    reviewCounts[projection.reviewDisposition] += 1;
    if (projection.hasCorrection) corrections += 1;
    for (const reason of projection.reasons) reasonCounts[reason] += 1;
    queryFamilies.set(projection.queryFamily, (queryFamilies.get(projection.queryFamily) ?? 0) + 1);
    const configurationKey = JSON.stringify([
      projection.modelName,
      projection.reasoningConfiguration,
      projection.applicationRevision,
      projection.promptConfigurationRevision ?? null,
    ]);
    const existing = modelConfigurations.get(configurationKey);
    modelConfigurations.set(configurationKey, {
      modelName: projection.modelName,
      reasoningConfiguration: projection.reasoningConfiguration,
      applicationRevision: projection.applicationRevision,
      ...(projection.promptConfigurationRevision === undefined
        ? {}
        : { promptConfigurationRevision: projection.promptConfigurationRevision }),
      count: (existing?.count ?? 0) + 1,
    });
  }

  return {
    total,
    ratings: Object.fromEntries(
      answerFeedbackRatings.map((rating) => [
        rating,
        { count: ratingCounts[rating], rate: rate(ratingCounts[rating], total) },
      ]),
    ) as AnswerFeedbackAggregate["ratings"],
    reasons: reasonCounts,
    corrections: { count: corrections, rate: rate(corrections, total) },
    byQueryFamily: [...queryFamilies.entries()]
      .map(([queryFamily, count]) => ({ queryFamily, count }))
      .sort((left, right) => left.queryFamily.localeCompare(right.queryFamily)),
    byModelConfiguration: [...modelConfigurations.values()].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    ),
    reviews: reviewCounts,
  };
};

export const correctedAnswerCandidate = (
  answer: AnswerFeedbackAnswer,
  revision: AnswerFeedbackRevision,
): CorrectedAnswerCandidate | undefined => {
  if (
    revision.reviewDisposition !== "accepted_for_training" ||
    revision.correction === undefined ||
    revision.reviewedAt === undefined
  )
    return undefined;
  return {
    answerId: answer.id,
    answerFingerprint: answer.answerFingerprint,
    queryFingerprint: answer.queryFingerprint,
    question: answer.questionText,
    originalAnswer: answer.answerText,
    failureReasons: revision.reasons,
    correctedAnswer: revision.correction,
    feedbackRevision: revision.revision,
    reviewedAt: revision.reviewedAt,
  };
};

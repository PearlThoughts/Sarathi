import { and, asc, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  type AnswerFeedbackAnswer,
  AnswerFeedbackError,
  type AnswerFeedbackMetricProjection,
  type AnswerFeedbackRepository,
  type AnswerFeedbackRevision,
} from "../../modules/answer-feedback/index.ts";
import type { KnowledgePostgresDatabase } from "./knowledge-migrations.ts";
import {
  answerFeedbackAnswerTable,
  answerFeedbackCurrentTable,
  answerFeedbackRevisionTable,
} from "./knowledge-schema.ts";

const persistenceError = (error: unknown): AnswerFeedbackError =>
  error instanceof AnswerFeedbackError
    ? error
    : new AnswerFeedbackError(
        "persistence_unavailable",
        "Answer feedback persistence is unavailable.",
      );

const fromAnswerRow = (
  row: typeof answerFeedbackAnswerTable.$inferSelect,
): AnswerFeedbackAnswer => {
  const {
    promptConfigurationRevision,
    productRegistryRevision,
    retrievalFingerprint,
    ...required
  } = row;
  return {
    ...required,
    state: row.state as AnswerFeedbackAnswer["state"],
    ...(promptConfigurationRevision === null ? {} : { promptConfigurationRevision }),
    ...(productRegistryRevision === null ? {} : { productRegistryRevision }),
    ...(retrievalFingerprint === null ? {} : { retrievalFingerprint }),
  };
};

const fromRevisionRow = (
  row: typeof answerFeedbackRevisionTable.$inferSelect,
): AnswerFeedbackRevision => {
  const { correction, reviewedByActorId, reviewedAt, ...required } = row;
  return {
    ...required,
    ...(correction === null ? {} : { correction }),
    ...(reviewedByActorId === null ? {} : { reviewedByActorId }),
    ...(reviewedAt === null ? {} : { reviewedAt }),
  };
};

export const createPostgresAnswerFeedbackRepository = (
  database: KnowledgePostgresDatabase,
): AnswerFeedbackRepository => ({
  registerAnswer: (answer) =>
    Effect.tryPromise({
      try: async () => {
        await database
          .insert(answerFeedbackAnswerTable)
          .values(answer)
          .onConflictDoNothing({
            target: [
              answerFeedbackAnswerTable.workspaceId,
              answerFeedbackAnswerTable.sourceActivityHash,
            ],
          });
        const [row] = await database
          .select()
          .from(answerFeedbackAnswerTable)
          .where(
            and(
              eq(answerFeedbackAnswerTable.workspaceId, answer.workspaceId),
              eq(answerFeedbackAnswerTable.sourceActivityHash, answer.sourceActivityHash),
            ),
          )
          .limit(1);
        if (row === undefined) throw new Error("Registered answer feedback snapshot is missing.");
        if (
          row.answerFingerprint !== answer.answerFingerprint ||
          row.queryFingerprint !== answer.queryFingerprint ||
          row.answerText !== answer.answerText ||
          row.questionText !== answer.questionText
        )
          throw new AnswerFeedbackError(
            "persistence_unavailable",
            "Answer feedback delivery identity conflicts with an immutable snapshot.",
          );
        return fromAnswerRow(row);
      },
      catch: persistenceError,
    }),
  markAnswerDelivered: (answerId) =>
    Effect.tryPromise({
      try: async () => {
        await database
          .update(answerFeedbackAnswerTable)
          .set({ state: "delivered" })
          .where(
            and(
              eq(answerFeedbackAnswerTable.id, answerId),
              eq(answerFeedbackAnswerTable.state, "prepared"),
            ),
          );
      },
      catch: persistenceError,
    }),
  abandonAnswer: (answerId) =>
    Effect.tryPromise({
      try: async () => {
        await database
          .update(answerFeedbackAnswerTable)
          .set({ state: "abandoned" })
          .where(
            and(
              eq(answerFeedbackAnswerTable.id, answerId),
              eq(answerFeedbackAnswerTable.state, "prepared"),
            ),
          );
      },
      catch: persistenceError,
    }),
  findAnswer: (answerId) =>
    Effect.tryPromise({
      try: async () => {
        const [row] = await database
          .select()
          .from(answerFeedbackAnswerTable)
          .where(eq(answerFeedbackAnswerTable.id, answerId))
          .limit(1);
        return row === undefined ? undefined : fromAnswerRow(row);
      },
      catch: persistenceError,
    }),
  appendRevision: (input) =>
    Effect.tryPromise({
      try: () =>
        database.transaction(async (transaction) => {
          const [answer] = await transaction
            .select({ id: answerFeedbackAnswerTable.id })
            .from(answerFeedbackAnswerTable)
            .where(eq(answerFeedbackAnswerTable.id, input.answerId))
            .for("update");
          if (answer === undefined)
            throw new AnswerFeedbackError("unknown_answer", "Feedback answer is unknown.");
          const [duplicate] = await transaction
            .select()
            .from(answerFeedbackRevisionTable)
            .where(
              and(
                eq(answerFeedbackRevisionTable.answerId, input.answerId),
                eq(answerFeedbackRevisionTable.actorId, input.actorId),
                eq(answerFeedbackRevisionTable.idempotencyKeyHash, input.idempotencyKeyHash),
              ),
            )
            .limit(1);
          if (duplicate !== undefined)
            return { revision: fromRevisionRow(duplicate), idempotent: true } as const;
          const [latest] = await transaction
            .select({ revision: answerFeedbackRevisionTable.revision })
            .from(answerFeedbackRevisionTable)
            .where(
              and(
                eq(answerFeedbackRevisionTable.answerId, input.answerId),
                eq(answerFeedbackRevisionTable.actorId, input.actorId),
              ),
            )
            .orderBy(desc(answerFeedbackRevisionTable.revision))
            .limit(1);
          const revision: AnswerFeedbackRevision = {
            ...input,
            revision: (latest?.revision ?? 0) + 1,
          };
          await transaction.insert(answerFeedbackRevisionTable).values(revision);
          await transaction
            .insert(answerFeedbackCurrentTable)
            .values({
              answerId: revision.answerId,
              actorId: revision.actorId,
              revisionId: revision.id,
              updatedAt: revision.submittedAt,
            })
            .onConflictDoUpdate({
              target: [answerFeedbackCurrentTable.answerId, answerFeedbackCurrentTable.actorId],
              set: { revisionId: revision.id, updatedAt: revision.submittedAt },
            });
          return { revision, idempotent: false } as const;
        }),
      catch: persistenceError,
    }),
  listRevisions: (answerId, actorId) =>
    Effect.tryPromise({
      try: async () =>
        (
          await database
            .select()
            .from(answerFeedbackRevisionTable)
            .where(
              and(
                eq(answerFeedbackRevisionTable.answerId, answerId),
                eq(answerFeedbackRevisionTable.actorId, actorId),
              ),
            )
            .orderBy(asc(answerFeedbackRevisionTable.revision))
        ).map(fromRevisionRow),
      catch: persistenceError,
    }),
  listCurrentMetricProjections: (workspaceId) =>
    Effect.tryPromise({
      try: async () => {
        const query = database
          .select({
            rating: answerFeedbackRevisionTable.rating,
            reasons: answerFeedbackRevisionTable.reasons,
            correction: answerFeedbackRevisionTable.correction,
            queryFamily: answerFeedbackAnswerTable.queryFamily,
            modelName: answerFeedbackAnswerTable.modelName,
            reasoningConfiguration: answerFeedbackAnswerTable.reasoningConfiguration,
            applicationRevision: answerFeedbackAnswerTable.applicationRevision,
            promptConfigurationRevision: answerFeedbackAnswerTable.promptConfigurationRevision,
            reviewDisposition: answerFeedbackRevisionTable.reviewDisposition,
          })
          .from(answerFeedbackCurrentTable)
          .innerJoin(
            answerFeedbackRevisionTable,
            eq(answerFeedbackCurrentTable.revisionId, answerFeedbackRevisionTable.id),
          )
          .innerJoin(
            answerFeedbackAnswerTable,
            eq(answerFeedbackCurrentTable.answerId, answerFeedbackAnswerTable.id),
          );
        const rows =
          workspaceId === undefined
            ? await query
            : await query.where(eq(answerFeedbackAnswerTable.workspaceId, workspaceId));
        return rows.map(
          (row): AnswerFeedbackMetricProjection => ({
            rating: row.rating,
            reasons: row.reasons,
            hasCorrection: row.correction !== null,
            queryFamily: row.queryFamily,
            modelName: row.modelName,
            reasoningConfiguration: row.reasoningConfiguration,
            applicationRevision: row.applicationRevision,
            ...(row.promptConfigurationRevision === null
              ? {}
              : { promptConfigurationRevision: row.promptConfigurationRevision }),
            reviewDisposition: row.reviewDisposition,
          }),
        );
      },
      catch: persistenceError,
    }),
});

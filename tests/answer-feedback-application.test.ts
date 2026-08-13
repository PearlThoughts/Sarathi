import { Effect } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AnswerFeedbackAnswer,
  AnswerFeedbackError,
  type AnswerFeedbackInvitation,
  type AnswerFeedbackMetricProjection,
  type AnswerFeedbackRepository,
  type AnswerFeedbackRevision,
  type AnswerFeedbackService,
  createAnswerFeedbackService,
  type PrepareAnswerFeedback,
  type SubmittedAnswerFeedback,
} from "../src/modules/answer-feedback/index.ts";

const uuids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];

const createMemoryRepository = (): {
  readonly repository: AnswerFeedbackRepository;
  readonly answers: Map<string, AnswerFeedbackAnswer>;
  readonly revisions: AnswerFeedbackRevision[];
} => {
  const answers = new Map<string, AnswerFeedbackAnswer>();
  const revisions: AnswerFeedbackRevision[] = [];
  const current = new Map<string, AnswerFeedbackRevision>();
  const fail = () => Effect.fail(new AnswerFeedbackError("persistence_unavailable", "failed"));
  const repository: AnswerFeedbackRepository = {
    registerAnswer: (answer) => {
      const existing = [...answers.values()].find(
        (candidate) =>
          candidate.workspaceId === answer.workspaceId &&
          candidate.sourceActivityHash === answer.sourceActivityHash,
      );
      if (existing !== undefined) return Effect.succeed(existing);
      answers.set(answer.id, structuredClone(answer));
      return Effect.succeed(structuredClone(answer));
    },
    markAnswerDelivered: (answerId) => {
      const answer = answers.get(answerId);
      if (answer === undefined) return fail();
      answers.set(answerId, { ...answer, state: "delivered" });
      return Effect.void;
    },
    abandonAnswer: (answerId) => {
      const answer = answers.get(answerId);
      if (answer === undefined) return fail();
      answers.set(answerId, { ...answer, state: "abandoned" });
      return Effect.void;
    },
    findAnswer: (answerId) => Effect.succeed(answers.get(answerId)),
    appendRevision: (input) => {
      const duplicate = revisions.find(
        (revision) =>
          revision.answerId === input.answerId &&
          revision.actorId === input.actorId &&
          revision.idempotencyKeyHash === input.idempotencyKeyHash,
      );
      if (duplicate !== undefined) return Effect.succeed({ revision: duplicate, idempotent: true });
      const revision: AnswerFeedbackRevision = {
        ...input,
        revision:
          revisions.filter(
            (candidate) =>
              candidate.answerId === input.answerId && candidate.actorId === input.actorId,
          ).length + 1,
      };
      revisions.push(structuredClone(revision));
      current.set(`${revision.answerId}:${revision.actorId}`, revision);
      return Effect.succeed({ revision, idempotent: false });
    },
    listRevisions: (answerId, actorId) =>
      Effect.succeed(
        revisions.filter(
          (revision) => revision.answerId === answerId && revision.actorId === actorId,
        ),
      ),
    listCurrentMetricProjections: (workspaceId) => {
      const projections: AnswerFeedbackMetricProjection[] = [];
      for (const revision of current.values()) {
        const answer = answers.get(revision.answerId);
        if (
          answer === undefined ||
          (workspaceId !== undefined && answer.workspaceId !== workspaceId)
        )
          continue;
        projections.push({
          rating: revision.rating,
          reasons: revision.reasons,
          hasCorrection: revision.correction !== undefined,
          queryFamily: answer.queryFamily,
          modelName: answer.modelName,
          reasoningConfiguration: answer.reasoningConfiguration,
          applicationRevision: answer.applicationRevision,
          ...(answer.promptConfigurationRevision === undefined
            ? {}
            : { promptConfigurationRevision: answer.promptConfigurationRevision }),
          reviewDisposition: revision.reviewDisposition,
        });
      }
      return Effect.succeed(projections);
    },
  };
  return { repository, answers, revisions };
};

const prepare = {
  workspaceId: "workspace-a",
  recipientActorId: "recipient-a",
  conversationBoundaryHash: "sha256-conversation-a",
  sourceActivityId: "activity-a",
  answerText: "No. The deployment is not accepted yet.",
  questionText: "Is deployment done?",
  modelName: "openai/model",
  reasoningConfiguration: "medium",
  applicationRevision: "app-revision",
  promptConfigurationRevision: "prompt-revision",
  productRegistryRevision: "registry-revision",
  retrievalFingerprint: "sha256-envelope",
  responseProduct: "operational_answer",
  queryFamily: "status",
  generatedAt: "2026-08-13T10:00:00.000Z",
} as const;

const actor = {
  workspaceId: "workspace-a",
  actorId: "actor-a",
  conversationBoundaryHash: "sha256-conversation-a",
  permitted: true,
} as const;

describe("answer feedback application", () => {
  it("exports the feedback application contract", () => {
    expectTypeOf<PrepareAnswerFeedback>().toBeObject();
    expectTypeOf<AnswerFeedbackInvitation>().toBeObject();
    expectTypeOf<SubmittedAnswerFeedback>().toBeObject();
    expectTypeOf<AnswerFeedbackService>().toBeObject();
  });
  it("prepares an immutable exact-answer snapshot and marks it delivered", async () => {
    const memory = createMemoryRepository();
    const service = createAnswerFeedbackService(memory.repository, {
      now: () => new Date("2026-08-13T10:01:00.000Z"),
      randomUuid: () => uuids[0] ?? "",
    });

    const invitation = await Effect.runPromise(service.prepareAnswer(prepare));
    await Effect.runPromise(service.markAnswerDelivered(invitation.answerId));
    const answer = memory.answers.get(invitation.answerId);

    expect(invitation).toEqual({ answerId: `af_${uuids[0]}` });
    expect(answer).toMatchObject({
      answerText: prepare.answerText,
      questionText: prepare.questionText,
      modelName: prepare.modelName,
      reasoningConfiguration: "medium",
      applicationRevision: "app-revision",
      promptConfigurationRevision: "prompt-revision",
      productRegistryRevision: "registry-revision",
      retrievalFingerprint: "sha256-envelope",
      state: "delivered",
    });
    expect(answer?.answerFingerprint).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(answer?.queryFingerprint).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(answer?.answerFingerprint).not.toBe(answer?.queryFingerprint);
  });

  it("records positive feedback immediately, deduplicates retries, and preserves revisions", async () => {
    const memory = createMemoryRepository();
    let uuidIndex = 0;
    const service = createAnswerFeedbackService(memory.repository, {
      now: () => new Date("2026-08-13T10:01:00.000Z"),
      randomUuid: () => uuids[uuidIndex++] ?? uuids[3] ?? "",
    });
    const invitation = await Effect.runPromise(service.prepareAnswer(prepare));
    await Effect.runPromise(service.markAnswerDelivered(invitation.answerId));
    const useful = {
      answerId: invitation.answerId,
      idempotencyKey: "fi_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      rating: "useful_as_is" as const,
      reasons: [],
    };

    const first = await Effect.runPromise(service.submit(useful, actor));
    const duplicate = await Effect.runPromise(service.submit(useful, actor));
    const revised = await Effect.runPromise(
      service.submit(
        {
          answerId: invitation.answerId,
          idempotencyKey: "fi_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          rating: "partly_useful",
          reasons: ["missing_material_work", "wrong_delivery_status"],
          correction: "State the missing acceptance evidence.",
        },
        actor,
      ),
    );

    expect(first.revision.revision).toBe(1);
    expect(first.idempotent).toBe(false);
    expect(duplicate.revision.id).toBe(first.revision.id);
    expect(duplicate.idempotent).toBe(true);
    expect(revised.revision.revision).toBe(2);
    expect(memory.revisions).toHaveLength(2);
    expect(memory.answers.get(invitation.answerId)?.answerText).toBe(prepare.answerText);
    expect(
      await Effect.runPromise(memory.repository.listRevisions(invitation.answerId, "actor-a")),
    ).toEqual([first.revision, revised.revision]);

    const metrics = await Effect.runPromise(service.metrics("workspace-a"));
    expect(metrics.total).toBe(1);
    expect(metrics.ratings.partly_useful.count).toBe(1);
    expect(metrics.ratings.useful_as_is.count).toBe(0);
    expect(metrics.corrections).toEqual({ count: 1, rate: 1 });
  });

  it.each([
    ["actor_not_permitted", { ...actor, permitted: false }],
    ["workspace_mismatch", { ...actor, workspaceId: "workspace-b" }],
    ["conversation_mismatch", { ...actor, conversationBoundaryHash: "sha256-conversation-b" }],
  ] as const)("rejects %s before adding a revision", async (code, rejectedActor) => {
    const memory = createMemoryRepository();
    let uuidIndex = 0;
    const service = createAnswerFeedbackService(memory.repository, {
      randomUuid: () => uuids[uuidIndex++] ?? uuids[3] ?? "",
    });
    const invitation = await Effect.runPromise(service.prepareAnswer(prepare));
    await Effect.runPromise(service.markAnswerDelivered(invitation.answerId));

    const result = await Effect.runPromise(
      Effect.either(
        service.submit(
          {
            answerId: invitation.answerId,
            idempotencyKey: "fi_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            rating: "not_useful",
            reasons: ["irrelevant"],
          },
          rejectedActor,
        ),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.code).toBe(code);
    expect(memory.revisions).toHaveLength(0);
  });

  it("rejects unknown and abandoned answers", async () => {
    const memory = createMemoryRepository();
    let uuidIndex = 0;
    const service = createAnswerFeedbackService(memory.repository, {
      randomUuid: () => uuids[uuidIndex++] ?? uuids[3] ?? "",
    });
    const action = {
      answerId: "af_99999999-9999-4999-8999-999999999999",
      idempotencyKey: "fi_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      rating: "not_useful" as const,
      reasons: ["other" as const],
    };

    const unknown = await Effect.runPromise(Effect.either(service.submit(action, actor)));
    expect(unknown._tag).toBe("Left");
    if (unknown._tag === "Left") expect(unknown.left.code).toBe("unknown_answer");

    const invitation = await Effect.runPromise(service.prepareAnswer(prepare));
    await Effect.runPromise(service.abandonAnswer(invitation.answerId));
    const abandoned = await Effect.runPromise(
      Effect.either(service.submit({ ...action, answerId: invitation.answerId }, actor)),
    );
    expect(abandoned._tag).toBe("Left");
    if (abandoned._tag === "Left") expect(abandoned.left.code).toBe("answer_not_delivered");
  });

  it("has no product, evaluation-rating, training, or source mutation dependency", () => {
    const memory = createMemoryRepository();
    const service = createAnswerFeedbackService(memory.repository);
    expect(Object.keys(service).sort()).toEqual([
      "abandonAnswer",
      "markAnswerDelivered",
      "metrics",
      "prepareAnswer",
      "submit",
    ]);
  });
});

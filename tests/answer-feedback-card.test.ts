import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AdaptiveCardPayload,
  type AnswerFeedbackCardAttachment,
  answerFeedbackActionVerb,
  answerFeedbackCardContentType,
  renderAnswerFeedbackCard,
  renderAnswerFeedbackFailureCard,
  renderAnswerWithFeedbackAttachment,
  renderAnswerWithFeedbackCard,
} from "../src/infrastructure/teams/answer-feedback-card.ts";

const answerId = "af_11111111-1111-4111-8111-111111111111";
const uuids = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
];

const generator = () => {
  let index = 0;
  return () => uuids[index++] ?? uuids[2] ?? "";
};

describe("answer feedback Adaptive Card", () => {
  it("exports the complete Teams rendering contract", () => {
    expect(answerFeedbackCardContentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(renderAnswerFeedbackFailureCard("Try again.").body[0]).toMatchObject({
      text: "Try again.",
      color: "Attention",
    });
    expectTypeOf<AdaptiveCardPayload>().toBeObject();
    expectTypeOf<AnswerFeedbackCardAttachment>().toBeObject();
  });
  it("renders the answer and all three binding choices in one attachment", () => {
    const attachment = renderAnswerWithFeedbackAttachment(
      "**Status:** Ready\n\n- Existing high-quality answer",
      { answerId },
      [],
      generator(),
    );
    const serialized = JSON.stringify(attachment);

    expect(attachment.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(attachment.content.body).toEqual([
      expect.objectContaining({
        type: "TextBlock",
        text: "**Status:** Ready\n\n- Existing high-quality answer",
        wrap: true,
      }),
      expect.objectContaining({
        text: "Was this answer useful?",
        separator: true,
      }),
    ]);
    expect(attachment.content.msteams).toEqual({ width: "Full", entities: [] });
    expect(attachment.content.actions?.map((action) => action.title)).toEqual([
      "✅ Useful as-is",
      "🟡 Partly useful",
      "❌ Not useful",
    ]);
    expect(serialized).toContain("Existing high-quality answer");
    expect(serialized).not.toContain("Question body");
  });

  it("carries real Teams mentions inside the same Adaptive Card", () => {
    const card = renderAnswerWithFeedbackCard(
      "<at>Delivery Reviewer</at>, please confirm acceptance.",
      { answerId },
      [
        {
          source: "teams",
          externalId: "reviewer-id",
          displayName: "Delivery Reviewer",
        },
        {
          source: "teams",
          externalId: "unused-id",
          displayName: "Unused Reviewer",
        },
      ],
      generator(),
    );

    expect(card.msteams).toEqual({
      width: "Full",
      entities: [
        {
          type: "mention",
          text: "<at>Delivery Reviewer</at>",
          mentioned: { id: "reviewer-id", name: "Delivery Reviewer" },
        },
      ],
    });
  });

  it("submits positive feedback directly and discloses multi-select detail forms", () => {
    const card = renderAnswerFeedbackCard({ answerId }, generator());
    const useful = card.actions?.[0] as {
      readonly type: string;
      readonly verb: string;
      readonly associatedInputs: string;
      readonly data: Record<string, unknown>;
    };
    expect(useful).toEqual({
      type: "Action.Execute",
      title: "✅ Useful as-is",
      verb: answerFeedbackActionVerb,
      associatedInputs: "none",
      data: {
        answerId,
        idempotencyKey: `fi_${uuids[0]}`,
        rating: "useful_as_is",
      },
    });

    for (const action of card.actions?.slice(1) ?? []) {
      expect(action.type).toBe("Action.ShowCard");
      const detail = action.card as {
        readonly body: readonly Record<string, unknown>[];
        readonly actions: readonly Record<string, unknown>[];
      };
      expect(detail.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "Input.ChoiceSet",
            id: "feedbackReasons",
            isMultiSelect: true,
          }),
          expect.objectContaining({
            type: "Input.Text",
            id: "feedbackCorrection",
            maxLength: 2_000,
          }),
        ]),
      );
      expect(detail.actions[0]).toEqual(
        expect.objectContaining({
          type: "Action.Execute",
          title: "Submit",
          verb: answerFeedbackActionVerb,
          associatedInputs: "auto",
        }),
      );
      const choiceInput = detail.body.find((item) => item.type === "Input.ChoiceSet") as {
        readonly choices: readonly Record<string, unknown>[];
      };
      expect(choiceInput.choices).toHaveLength(11);
    }
  });

  it("returns a quiet confirmation card with fresh revision controls", () => {
    const card = renderAnswerWithFeedbackCard("Original answer", { answerId }, [], generator(), {
      id: "fr_22222222-2222-4222-8222-222222222222",
      answerId,
      workspaceId: "workspace",
      actorId: "actor",
      revision: 2,
      rating: "partly_useful",
      reasons: ["stale"],
      idempotencyKeyHash: "sha256-idempotency",
      submittedAt: "2026-08-13T10:00:00.000Z",
      reviewDisposition: "unreviewed",
    });

    expect(card.body[0]).toEqual(expect.objectContaining({ text: "Original answer" }));
    expect(card.body[2]).toEqual(
      expect.objectContaining({
        text: "Feedback recorded: Partly useful. You can revise it below.",
      }),
    );
    expect(card.actions).toHaveLength(3);
  });

  it("keeps action payloads opaque and free of URLs, source bodies, prompts, and envelopes", () => {
    const card = renderAnswerWithFeedbackCard(
      "Private answer body with https://private.example/source",
      { answerId },
      [],
      generator(),
    );
    const payloads = (card.actions ?? []).flatMap((action) => {
      if (action.type === "Action.Execute") return [action.data];
      const detailCard = action.card as {
        readonly actions?: readonly Record<string, unknown>[];
      };
      return (detailCard.actions ?? []).map((nested) => nested.data);
    });
    const serialized = JSON.stringify(payloads);
    expect(serialized).toContain(answerId);
    expect(serialized).not.toContain("https://private.example");
    expect(serialized).not.toContain("Private answer body");
    expect(serialized).not.toContain("sourceBody");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("envelope");
    expect(serialized).not.toContain("question");
  });
});

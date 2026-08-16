import type {
  AnswerFeedbackInvitation,
  AnswerFeedbackRating,
  AnswerFeedbackReason,
  AnswerFeedbackRevision,
} from "../../modules/answer-feedback/index.ts";

export const answerFeedbackActionVerb = "sarathi.answer-feedback";
export const answerFeedbackCardContentType = "application/vnd.microsoft.card.adaptive";

export type AdaptiveCardPayload = {
  readonly type: "AdaptiveCard";
  readonly $schema: "http://adaptivecards.io/schemas/adaptive-card.json";
  readonly version: "1.5";
  readonly body: readonly Record<string, unknown>[];
  readonly actions?: readonly Record<string, unknown>[] | undefined;
  readonly msteams?:
    | {
        readonly width: "Full";
        readonly entities: readonly Record<string, unknown>[];
      }
    | undefined;
};

export type AnswerFeedbackCardAttachment = {
  readonly contentType: typeof answerFeedbackCardContentType;
  readonly content: AdaptiveCardPayload;
};

const choices: readonly {
  readonly title: string;
  readonly value: AnswerFeedbackReason;
}[] = [
  { title: "Irrelevant or off-topic", value: "irrelevant" },
  { title: "Missed important work", value: "missing_material_work" },
  { title: "Wrong capability/product mapping", value: "wrong_capability_mapping" },
  { title: "Wrong delivery status", value: "wrong_delivery_status" },
  { title: "Incorrect owner or dependency", value: "wrong_owner_or_dependency" },
  { title: "Repeated the same activity", value: "duplicate_activity" },
  { title: "Difficult to understand", value: "difficult_to_understand" },
  { title: "Too much detail", value: "too_detailed" },
  { title: "Too little detail", value: "insufficient_detail" },
  { title: "Stale information", value: "stale" },
  { title: "Other", value: "other" },
];

type IdGenerator = () => string;

type AnswerFeedbackCardMention = {
  readonly source: "teams";
  readonly externalId: string;
  readonly displayName: string;
};

const idempotencyKey = (randomUuid: IdGenerator): string => `fi_${randomUuid()}`;

const executeAction = (
  title: string,
  answerId: string,
  rating: AnswerFeedbackRating,
  randomUuid: IdGenerator,
  associatedInputs: "none" | "auto",
): Record<string, unknown> => ({
  type: "Action.Execute",
  title,
  verb: answerFeedbackActionVerb,
  associatedInputs,
  data: {
    answerId,
    idempotencyKey: idempotencyKey(randomUuid),
    rating,
  },
});

const detailAction = (
  title: string,
  answerId: string,
  rating: Extract<AnswerFeedbackRating, "partly_useful" | "not_useful">,
  randomUuid: IdGenerator,
): Record<string, unknown> => ({
  type: "Action.ShowCard",
  title,
  card: {
    type: "AdaptiveCard",
    body: [
      {
        type: "TextBlock",
        text: "What needs improvement?",
        weight: "Bolder",
        wrap: true,
      },
      {
        type: "Input.ChoiceSet",
        id: "feedbackReasons",
        isMultiSelect: true,
        style: "expanded",
        choices,
      },
      {
        type: "TextBlock",
        text: "What should Sarathi have said instead?",
        weight: "Bolder",
        wrap: true,
        spacing: "Medium",
      },
      {
        type: "Input.Text",
        id: "feedbackCorrection",
        isMultiline: true,
        maxLength: 2_000,
        placeholder: "Optional correction",
      },
    ],
    actions: [executeAction("Submit", answerId, rating, randomUuid, "auto")],
  },
});

const ratingActions = (
  answerId: string,
  randomUuid: IdGenerator,
): readonly Record<string, unknown>[] => [
  executeAction("✅ Useful as-is", answerId, "useful_as_is", randomUuid, "none"),
  detailAction("🟡 Partly useful", answerId, "partly_useful", randomUuid),
  detailAction("❌ Not useful", answerId, "not_useful", randomUuid),
];

const ratingLabel = (rating: AnswerFeedbackRating): string => {
  switch (rating) {
    case "useful_as_is":
      return "Useful as-is";
    case "partly_useful":
      return "Partly useful";
    case "not_useful":
      return "Not useful";
  }
};

export const renderAnswerFeedbackCard = (
  invitation: AnswerFeedbackInvitation,
  randomUuid: IdGenerator = () => crypto.randomUUID(),
  confirmation?: AnswerFeedbackRevision | undefined,
): AdaptiveCardPayload => ({
  type: "AdaptiveCard",
  $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
  version: "1.5",
  body: [
    ...(confirmation === undefined
      ? []
      : [
          {
            type: "TextBlock",
            text: `Feedback recorded: ${ratingLabel(confirmation.rating)}. You can revise it below.`,
            wrap: true,
            color: "Good",
          },
        ]),
    {
      type: "TextBlock",
      text: "Was this answer useful?",
      weight: "Bolder",
      wrap: true,
      spacing: confirmation === undefined ? "None" : "Medium",
    },
  ],
  actions: ratingActions(invitation.answerId, randomUuid),
});

const adaptiveCardMentionEntities = (
  answerText: string,
  mentions: readonly AnswerFeedbackCardMention[],
): readonly Record<string, unknown>[] =>
  mentions
    .filter(({ displayName }) => answerText.includes(`<at>${displayName}</at>`))
    .map(({ externalId, displayName }) => ({
      type: "mention",
      text: `<at>${displayName}</at>`,
      mentioned: { id: externalId, name: displayName },
    }));

export const renderAnswerWithFeedbackCard = (
  answerText: string,
  invitation: AnswerFeedbackInvitation,
  mentions: readonly AnswerFeedbackCardMention[] = [],
  randomUuid: IdGenerator = () => crypto.randomUUID(),
  confirmation?: AnswerFeedbackRevision | undefined,
): AdaptiveCardPayload => {
  const feedback = renderAnswerFeedbackCard(invitation, randomUuid, confirmation);
  const mentionEntities = adaptiveCardMentionEntities(answerText, mentions);
  return {
    ...feedback,
    body: [
      {
        type: "TextBlock",
        text: answerText,
        wrap: true,
        spacing: "None",
      },
      {
        type: "TextBlock",
        text: "Was this answer useful?",
        weight: "Bolder",
        wrap: true,
        separator: true,
        spacing: "Medium",
      },
      ...(confirmation === undefined
        ? []
        : [
            {
              type: "TextBlock",
              text: `Feedback recorded: ${ratingLabel(confirmation.rating)}. You can revise it below.`,
              wrap: true,
              color: "Good",
              spacing: "Small",
            },
          ]),
    ],
    msteams: { width: "Full", entities: mentionEntities },
  };
};

export const renderAnswerWithFeedbackAttachment = (
  answerText: string,
  invitation: AnswerFeedbackInvitation,
  mentions: readonly AnswerFeedbackCardMention[] = [],
  randomUuid?: IdGenerator | undefined,
): AnswerFeedbackCardAttachment => ({
  contentType: answerFeedbackCardContentType,
  content: renderAnswerWithFeedbackCard(answerText, invitation, mentions, randomUuid),
});

export const renderAnswerFeedbackFailureCard = (message: string): AdaptiveCardPayload => ({
  type: "AdaptiveCard",
  $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
  version: "1.5",
  body: [{ type: "TextBlock", text: message, wrap: true, color: "Attention" }],
});

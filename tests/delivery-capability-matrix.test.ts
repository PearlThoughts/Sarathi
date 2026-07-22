import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createDeliveryAssistant,
  type DeliveryQuerySource,
  type DeliveryQuestionIntent,
} from "../src/modules/delivery-intelligence/index.ts";

const capabilityQuestions: readonly {
  readonly question: string;
  readonly intents: readonly DeliveryQuestionIntent[];
}[] = [
  { question: "What are our active goals?", intents: ["goals"] },
  { question: "What commitments have we made?", intents: ["commitments"] },
  { question: "What is the project scope?", intents: ["scope"] },
  { question: "What are the requirements?", intents: ["requirements"] },
  {
    question: "What is the current status of Modern Website Builder?",
    intents: ["status"],
  },
  { question: "Who owns each module?", intents: ["ownership"] },
  {
    question: "Who is waiting for whom in the active sprint?",
    intents: ["dependencies"],
  },
  { question: "Is anybody stuck?", intents: ["blockers"] },
  {
    question: "What did the team deliver last sprint, and what are they doing this week?",
    intents: ["delivered", "current_work"],
  },
  { question: "Post the top 5 risks.", intents: ["risks"] },
  { question: "What issue keeps recurring?", intents: ["recurring"] },
  { question: "What decisions have been made?", intents: ["decisions"] },
  { question: "What is the team's bandwidth?", intents: ["capacity"] },
  {
    question: "What are the delivery risks and next action?",
    intents: ["risks", "next_actions"],
  },
  {
    question: "What are the project milestones and deadlines?",
    intents: ["milestones"],
  },
  {
    question: "How is the routing module implemented in code?",
    intents: ["implementation"],
  },
  { question: "Post the team work summary for today.", intents: ["activity"] },
  {
    question: "What should I know before the delivery standup?",
    intents: ["general"],
  },
];

const genericSource: DeliveryQuerySource = {
  source: "projection",
  selectors: [
    "objects",
    "relations",
    "observations",
    "claims",
    "metrics",
    "conflicts",
    "knowledge",
    "github_live",
  ],
  execute: (context, plan) =>
    Effect.succeed({
      items: plan.operations.map((operation, index) => ({
        id: operation.id,
        workspaceId: context.workspaceId,
        source:
          operation.select === "github_live"
            ? ("github" as const)
            : plan.requiredSources?.includes("teams") === true
              ? ("teams" as const)
              : ("jira" as const),
        selector: operation.select,
        intent: operation.purpose,
        title: plan.subject?.phrase ?? plan.subject?.externalKey ?? operation.purpose,
        summary: `Resolved ${plan.subject?.phrase ?? plan.subject?.externalKey ?? operation.purpose} from the delivery model`,
        citationUrl:
          operation.purpose === "next_actions"
            ? "https://example.com/risks/0"
            : `https://example.com/${operation.purpose}/${index}`,
        sensitivity: "internal" as const,
        authority: 0.9,
        observedAt: context.requestedAt,
        dedupeKey: `${operation.purpose}:${index}`,
      })),
      conflicts: [],
      unavailableSources: [],
      complete: true,
    }),
};

describe("AI Delivery Assistant capability matrix", () => {
  it.each(
    capabilityQuestions,
  )("answers $question through reusable query operations", async (row) => {
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [genericSource] }).answer({
        workspaceId: "workspace-1851",
        actorId: "actor-1851",
        maximumSensitivity: "internal",
        financeAccess: false,
        requestedAt: "2026-07-20T13:09:00.000Z",
        timeZone: "Asia/Kolkata",
        question: row.question,
      }),
    );

    expect(answer.plan.intents).toEqual(row.intents);
    expect(answer.status).toBe("ok");
    expect(answer.text.split("\n").length).toBeLessThanOrEqual(5);
    expect(answer.text.split("\n")[0]).not.toMatch(/^(?:-|\d+\.)\s/);
    expect(answer.text).toMatch(/- .+ \*\*/u);
    if (row.intents.includes("next_actions")) expect(answer.text).toContain("1. ➡️ **Next:**");
    else expect(answer.text).not.toContain("Recommended next step");
    expect(answer.citations.length).toBeGreaterThan(0);
  });
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  type CapabilityLedger,
  createDeliveryAssistant,
  type DeliveryAnswerComposer,
  type DeliveryQuerySource,
  type DeliveryQuestionIntent,
  type DeliveryResultItem,
} from "../src/modules/delivery-intelligence/index.ts";

const capabilityLedger: CapabilityLedger = {
  version: 1,
  capabilities: [
    {
      key: "delivery-model",
      title: "Delivery model",
      aliases: [{ value: "resolved" }],
    },
  ],
};

const reportComposer: DeliveryAnswerComposer = {
  compose: (input) => {
    const report = input.periodDeliveryReport;
    const referenceCandidates = [
      ...(report?.capsules.flatMap(({ citations }) => citations) ?? []),
      ...input.items.map(({ source, citationUrl: url }) => ({ source, url })),
    ];
    const selectedReferences = [
      ...new Map(referenceCandidates.map((reference) => [reference.url, reference])).values(),
    ].slice(0, 10);
    const references = selectedReferences.map(
      ({ url }, index) => `- [Reference ${index + 1}](${url})`,
    );
    if (report === undefined)
      return Effect.succeed({
        text: [
          "## Status",
          ...input.items
            .filter(({ intent }) => intent !== "next_actions")
            .map(({ summary }) => `- ${summary}`),
          ...(input.items.some(({ intent }) => intent === "next_actions")
            ? [
                "## Next",
                ...input.items
                  .filter(({ intent }) => intent === "next_actions")
                  .map(({ summary }) => `- ${summary}`),
              ]
            : []),
          "### References",
          ...references,
        ].join("\n"),
        citations: selectedReferences.map(({ url }, index) => ({
          label: `Reference ${index + 1}`,
          url,
        })),
      });
    const review = report?.sprintReview;
    return Effect.succeed({
      text:
        review === undefined
          ? [
              "## Delivered",
              "- Delivery activity was consolidated by capability.",
              "## In progress",
              "- Active work remains visible in the delivery model.",
              "## Waiting or blocked",
              "- No material wait was observed.",
              "## Decisions needed",
              "- No decision was identified.",
              "## References",
              ...references,
            ].join("\n")
          : [
              "## Sprint overview",
              "- Delivery health and the main management concern were reviewed.",
              "## Previous sprint",
              "- **Planned at start:** committed work was consolidated by capability.",
              "- **Delivered:** completed work was consolidated by capability.",
              "- **Rolled over:** active work was consolidated by capability.",
              "- **Added during sprint:** no material addition was observed.",
              "- **Dropped or superseded:** no dropped work was observed.",
              "## Current sprint",
              "- Active work, ownership and health were consolidated.",
              "## Q3 alignment",
              ...review.initiatives.map(
                ({ title, health, healthExplanation }) =>
                  `- **${title} — ${health}:** ${healthExplanation}`,
              ),
              "## Waiting or decisions",
              "- No material wait was observed.",
              "## Jira hygiene",
              "- No Jira correction was identified.",
              "## References",
              ...references,
            ].join("\n"),
      citations: selectedReferences.map(({ url }, index) => ({
        label: `Reference ${index + 1}`,
        url,
      })),
    });
  },
};

const capabilityQuestions: readonly {
  readonly question: string;
  readonly intents: readonly DeliveryQuestionIntent[];
}[] = [
  { question: "What are our active goals?", intents: ["goals"] },
  { question: "What commitments have we made?", intents: ["commitments"] },
  { question: "What is the project scope?", intents: ["scope"] },
  { question: "What are the requirements?", intents: ["requirements"] },
  {
    question: "What is the current status of Atlas Site Composer?",
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
    intents: ["delivered", "goals", "commitments", "dependencies", "blockers", "current_work"],
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
  execute: (context, plan) => {
    const items: DeliveryResultItem[] = plan.operations.map((operation, index) => ({
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
      indexedAt: context.requestedAt,
      dedupeKey: `${operation.purpose}:${index}`,
      ...(operation.purpose === "delivered" ? { completionStage: "deployed" as const } : {}),
      ...(operation.time?.kind === "jira_sprint"
        ? {
            planning: {
              externalKey: `DEMO-${index + 1}`,
              status: operation.purpose === "delivered" ? "Done" : "In Progress",
              sprint:
                operation.time.sprint === "previous" ? "Delivery Sprint 8" : "Delivery Sprint 9",
              hasDependency: false,
              hasAcceptanceInformation: false,
              previousSprint: {
                id: "81",
                name: "Delivery Sprint 8",
                state: "closed" as const,
                startAt: "2026-07-01T03:30:00.000Z",
                endAt: "2026-07-14T03:30:00.000Z",
              },
              currentSprint: {
                id: "82",
                name: "Delivery Sprint 9",
                state: "active" as const,
                startAt: "2026-07-15T03:30:00.000Z",
                endAt: "2026-07-28T03:30:00.000Z",
              },
              sprintClassifications:
                operation.time.sprint === "current"
                  ? (["current_sprint"] as const)
                  : operation.purpose === "delivered"
                    ? (["planned_at_start", "completed_during_sprint"] as const)
                    : (["planned_at_start"] as const),
            },
          }
        : {}),
    }));
    const representedSources = new Set(items.map(({ source }) => source));
    const firstOperation = plan.operations[0];
    if (firstOperation !== undefined)
      for (const source of plan.requiredSources ?? []) {
        if (representedSources.has(source)) continue;
        items.push({
          id: `${firstOperation.id}-${source}`,
          workspaceId: context.workspaceId,
          source,
          selector: firstOperation.select,
          intent: firstOperation.purpose,
          title: plan.subject?.phrase ?? plan.subject?.externalKey ?? firstOperation.purpose,
          summary: `Resolved ${plan.subject?.phrase ?? plan.subject?.externalKey ?? firstOperation.purpose} from the delivery model`,
          citationUrl: `https://example.com/${source}/${firstOperation.purpose}`,
          sensitivity: "internal",
          authority: 0.9,
          observedAt: context.requestedAt,
          indexedAt: context.requestedAt,
          dedupeKey: `${firstOperation.purpose}:${source}`,
          ...(firstOperation.purpose === "delivered"
            ? { completionStage: "deployed" as const }
            : {}),
        });
      }
    return Effect.succeed({
      items,
      conflicts: [],
      unavailableSources: [],
      complete: true,
      ...(plan.operations.some(({ select }) => select === "period_census")
        ? {
            periodCensus: {
              version: 1 as const,
              boundary: {
                kind: "source_defined" as const,
                source: "jira" as const,
                reference: "test delivery period",
              },
              timeZone: context.timeZone,
              examinedCandidateCount: items.length,
              candidateCount: items.length,
              deliveredCandidateCount: items.filter(
                ({ completionStage }) => completionStage !== undefined,
              ).length,
              excludedCandidateCount: 0,
              duplicateCandidateCount: 0,
              unmappedCandidateCount: 0,
              exclusions: {},
              unavailableSources: [],
              sourceCoverage: [],
              pagination: {
                pageSize: 200,
                pagesRead: 1,
                exhausted: true,
                maximumCandidates: 50_000,
              },
              complete: true,
              replayChecksum: "sha256-capability-matrix",
            },
          }
        : {}),
    });
  },
};

describe("AI Delivery Assistant capability matrix", () => {
  it.each(
    capabilityQuestions,
  )("answers $question through reusable query operations", async (row) => {
    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [genericSource],
        answerComposer: reportComposer,
        capabilityLedger,
      }).answer({
        workspaceId: "workspace-atlas",
        actorId: "actor-atlas",
        maximumSensitivity: "internal",
        financeAccess: false,
        requestedAt: "2026-07-20T13:09:00.000Z",
        timeZone: "Asia/Kolkata",
        question: row.question,
      }),
    );

    expect(answer.plan.intents).toEqual(row.intents);
    expect(answer.status).toBe("ok");
    expect(answer.text.split("\n")[0]).toMatch(/^## /);
    expect(answer.text).toMatch(/^- /m);
    expect(answer.text).toContain(
      answer.responseProduct === "period_delivery_brief" ||
        answer.responseProduct === "leadership_report"
        ? "## References"
        : "### References",
    );
    expect(answer.text).not.toContain("Coverage");
    expect(answer.text).not.toContain("Evidence");
    if (row.question.includes("last sprint")) {
      expect(answer.text).toContain(
        "**Previous sprint — Delivery Sprint 8:** 1 Jul 2026 to 14 Jul 2026.",
      );
      expect(answer.text).toContain(
        "**Current sprint — Delivery Sprint 9:** 15 Jul 2026 to 28 Jul 2026.",
      );
    }
    if (row.intents.includes("next_actions")) expect(answer.text).toContain("## Next");
    else expect(answer.text).not.toContain("Recommended next step");
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it("keeps an answer complete when optional live verification is unavailable but required projected evidence is present", async () => {
    const optionalLiveSource: DeliveryQuerySource = {
      source: "teams",
      selectors: ["objects", "observations"],
      execute: () =>
        Effect.succeed({
          items: [],
          conflicts: [],
          unavailableSources: ["teams"],
          complete: false,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [genericSource, optionalLiveSource],
        answerComposer: reportComposer,
        capabilityLedger,
      }).answer({
        workspaceId: "workspace-atlas",
        actorId: "actor-atlas",
        maximumSensitivity: "internal",
        financeAccess: false,
        requestedAt: "2026-07-20T13:09:00.000Z",
        timeZone: "Asia/Kolkata",
        question: "What was delivered this week?",
      }),
    );

    expect(answer.status).toBe("ok");
    expect(answer.acceptance.completenessPassed).toBe(true);
    expect(answer.citations.length).toBeGreaterThanOrEqual(2);
  });
});

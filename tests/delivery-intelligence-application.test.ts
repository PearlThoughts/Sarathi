import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { RepositoryError } from "../src/domain/errors.ts";
import {
  createDeliveryAssistant,
  type DeliveryAnswerComposer,
  type DeliveryClaim,
  type DeliveryQuerySource,
  type DeliveryResultItem,
  deliveryClaimValueHash,
  deliveryResponseBudget,
  planDeliveryQuestion,
} from "../src/modules/delivery-intelligence/index.ts";

const request = {
  workspaceId: "workspace-example",
  actorId: "actor-example",
  maximumSensitivity: "internal",
  financeAccess: false,
  requestedAt: "2026-07-20T13:09:00.000Z",
  timeZone: "Asia/Kolkata",
  question: "What did the team do today?",
} as const;

const item = (
  source: "github" | "jira" | "teams" | "vault",
  id: string,
  summary: string,
  intent: "activity" | "dependencies" | "status" | "risks" | "next_actions" = "activity",
): DeliveryResultItem => ({
  id,
  workspaceId: request.workspaceId,
  source,
  selector:
    intent === "activity" ? "observations" : intent === "dependencies" ? "relations" : "objects",
  intent,
  title: summary,
  summary,
  citationUrl: `https://example.com/${source}/${id}`,
  sensitivity: "internal",
  authority: 0.9,
  observedAt: "2026-07-20T10:00:00.000Z",
  dedupeKey: summary.toLowerCase(),
});

describe("delivery intelligence application", () => {
  it("allows bounded live sources to finish before the Teams response deadline", () => {
    expect(deliveryResponseBudget).toEqual({
      sourceTimeoutMs: 4_500,
      compositionTimeoutMs: 2_500,
      totalBudgetMs: 6_500,
    });
    expect(deliveryResponseBudget.sourceTimeoutMs).toBeLessThan(
      deliveryResponseBudget.totalBudgetMs,
    );
  });

  it("rejects finance before any source call", async () => {
    const execute = vi.fn(() =>
      Effect.succeed({
        items: [],
        conflicts: [],
        unavailableSources: [],
        complete: true,
      }),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["metrics"],
      execute,
    };
    await expect(
      Effect.runPromise(
        createDeliveryAssistant({ sources: [source] }).answer({
          ...request,
          question: "What is the project budget?",
        }),
      ),
    ).rejects.toThrow("confidential finance entitlement");
    expect(execute).not.toHaveBeenCalled();
  });

  it("deduplicates cross-source facts and returns a decision-ready cited response", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [
            item("github", "1", "Merged delivery report"),
            {
              ...item("jira", "2", "Merged delivery report"),
              dedupeKey: "merged delivery report",
            },
            item("teams", "3", "Team confirmed rollout"),
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer(request),
    );
    expect(answer.text.split("\n").length).toBeLessThanOrEqual(5);
    expect(answer.text.split("\n")[0]).toBe(
      "Here’s the current project activity across connected sources.",
    );
    expect(answer.text).toContain("- 🧩 **Code:**");
    expect(answer.text).toContain("1. ➡️ **Recommended next step:**");
    expect(answer.text.match(/Merged delivery report/g)).toHaveLength(1);
    expect(answer.citations).toHaveLength(2);
    expect(answer.status).toBe("ok");
  });

  it("delegates with a real Teams mention only when the source resolves the target identity", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("teams", "review", "Pavithra, please review the delivery issue"),
              actionTarget: {
                source: "teams",
                externalId: "pavithra-entra-id",
                displayName: "Pavithra",
              },
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer(request),
    );

    expect(answer.text).toContain(
      "1. ➡️ **Next:** <at>Pavithra</at>, please confirm the next step and due date",
    );
    expect(answer.mentions).toEqual([
      {
        source: "teams",
        externalId: "pavithra-entra-id",
        displayName: "Pavithra",
      },
    ]);
  });

  it("does not delegate merely because a non-actionable update mentions a person", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("teams", "thanks", "Delivery Lead: Thanks to Pavithra for the update"),
              actionTarget: {
                source: "teams",
                externalId: "pavithra-entra-id",
                displayName: "Pavithra",
              },
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };

    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer(request),
    );

    expect(answer.text).not.toContain("<at>Pavithra</at>");
    expect(answer.mentions).toEqual([]);
  });

  it("preserves each requested intent when one Jira issue supports a compound answer", async () => {
    const sharedCitation = "https://example.com/jira/DEMO-9";
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("jira", "risk", "DEMO-9 is a high delivery risk", "risks"),
              citationUrl: sharedCitation,
              dedupeKey: "jira:DEMO-9:risk",
            },
            {
              ...item("jira", "action", "Owner — DEMO-9 In Progress", "next_actions"),
              citationUrl: sharedCitation,
              dedupeKey: "jira:DEMO-9:next",
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What are the delivery risks and next action?",
      }),
    );

    expect(answer.text.split("\n")).toEqual([
      "Here’s the delivery situation that needs attention.",
      `- ⚠️ **Risks:** DEMO-9 is a high delivery risk [Jira 1](${sharedCitation})`,
      `- ➡️ **Next action:** Owner — DEMO-9 In Progress [Jira 2](${sharedCitation})`,
      `1. ➡️ **Recommended next step:** Assign a mitigation owner and checkpoint to the highest risk. [Jira 2](${sharedCitation})`,
    ]);
    expect(answer.citations).toHaveLength(2);
  });

  it("prefers structured Jira lifecycle state for status answers", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects", "knowledge"],
      execute: () =>
        Effect.succeed({
          items: [
            { ...item("vault", "boundary", "Builder scope table", "status"), authority: 1 },
            item("jira", "done", "DEMO-10 Done: Builder navigation fix", "status"),
            item("jira", "active", "DEMO-11 In Progress: Builder acceptance", "status"),
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What is the current status of Builder?",
      }),
    );
    expect(answer.text).toContain("DEMO-10 Done");
    expect(answer.text).toContain("DEMO-11 In Progress");
    expect(answer.text).not.toContain("Builder scope table");
  });

  it("discloses competing claims rather than choosing one silently", async () => {
    const claim = (id: string, value: string, source: "jira" | "teams"): DeliveryClaim => ({
      id,
      workspaceId: request.workspaceId,
      subjectKey: "DEMO-1",
      predicate: "status",
      value,
      valueHash: deliveryClaimValueHash(value),
      authority: source === "jira" ? 1 : 0.8,
      sensitivity: "internal",
      observedAt: "2026-07-20T10:00:00.000Z",
      active: true,
      deleted: false,
      source: {
        source,
        sourceId: `${source}-source`,
        sourceItemId: id,
        citationUrl: `https://example.com/${source}/${id}`,
      },
    });
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["objects"],
      execute: () =>
        Effect.succeed({
          items: [
            item("jira", "status", "DEMO-1 is blocked", "status"),
            item("jira", "dependency", "DEMO-1 waits for DEMO-2", "dependencies"),
          ],
          conflicts: [
            {
              workspaceId: request.workspaceId,
              subjectKey: "DEMO-1",
              predicate: "status",
              claims: [claim("1", "blocked", "jira"), claim("2", "ready", "teams")],
            },
          ],
          unavailableSources: [],
          complete: true,
        }),
    };
    const statusPlan = planDeliveryQuestion("What is the current status of DEMO-1?");
    const dependencyPlan = planDeliveryQuestion("Who is waiting for whom?");
    if (statusPlan === undefined) throw new Error("Expected deterministic status plan");
    if (dependencyPlan === undefined) throw new Error("Expected deterministic dependency plan");
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer({
        ...request,
        question: "What is the current status of DEMO-1?",
        plan: {
          ...statusPlan,
          intents: ["status", "dependencies"],
          operations: [...statusPlan.operations, ...dependencyPlan.operations],
          maximumLines: 2,
        },
      }),
    );
    expect(answer.text.split("\n")).toHaveLength(4);
    expect(answer.text).not.toContain("Dependencies:");
    expect(answer.text).toContain("**Conflict — DEMO-1 status:** blocked");
    expect(answer.text).toContain("vs ready");
    expect(answer.conflicts).toHaveLength(1);
  });

  it("filters wrong-workspace and excessive-sensitivity results before composition", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [
            {
              ...item("jira", "other", "Other workspace"),
              workspaceId: "other",
            },
            {
              ...item("jira", "restricted", "Restricted"),
              sensitivity: "restricted",
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer(request),
    );
    expect(answer.status).toBe("empty");
    expect(answer.citations).toEqual([]);
  });

  it("reports indexed Jira and Vault as partial when the projection store fails", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.fail(
          new RepositoryError({
            message: "test projection failure",
            operation: "test",
          }),
        ),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({ sources: [source] }).answer(request),
    );
    expect(answer.status).toBe("partial");
    expect(answer.unavailableSources).toEqual(["jira", "vault"]);
    expect(answer.text).toContain("- ⚠️ **Coverage:** Jira, Vault unavailable.");
  });

  it("synthesizes only authorized deduplicated records and validates model citations", async () => {
    const compose = vi.fn<DeliveryAnswerComposer["compose"]>((_input) =>
      Effect.succeed({
        text: `I found the current delivery activity.\n- **Delivery:** Merged code and project activity. [Code](https://example.com/github/code)\n1. **Next:** Confirm the team-owned follow-up. [Team](https://example.com/teams/team)`,
        citations: [
          { label: "Code", url: "https://example.com/github/code" },
          { label: "Team", url: "https://example.com/teams/team" },
        ],
      }),
    );
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [
            item("github", "code", "Merged code"),
            item("teams", "team", "Confirmed next step"),
            {
              ...item("jira", "other", "Other workspace"),
              workspaceId: "other",
            },
            {
              ...item("jira", "restricted", "Restricted"),
              sensitivity: "restricted",
            },
          ],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: { compose },
      }).answer(request),
    );
    const composition = compose.mock.calls[0]?.[0];
    expect(composition?.items.map(({ id }) => id)).toEqual(["code", "team"]);
    expect(answer.text).toContain("Merged code and project activity");
    expect(answer.citations).toHaveLength(2);
  });

  it("falls back to the bounded deterministic answer for an invented model citation", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [item("github", "code", "Merged code"), item("teams", "team", "Team update")],
          conflicts: [],
          unavailableSources: [],
          complete: true,
        }),
    };
    const answer = await Effect.runPromise(
      createDeliveryAssistant({
        sources: [source],
        answerComposer: {
          compose: () =>
            Effect.succeed({
              text: "Invented [source](https://evil.example.test/x)",
              citations: [{ label: "source", url: "https://evil.example.test/x" }],
            }),
        },
      }).answer(request),
    );
    expect(answer.text).not.toContain("evil.example.test");
    expect(answer.text).toContain("Merged code");
  });
});

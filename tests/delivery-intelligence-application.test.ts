import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  createDeliveryAssistant,
  type DeliveryClaim,
  type DeliveryQuerySource,
  type DeliveryResultItem,
  deliveryClaimValueHash,
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
  source: "github" | "jira" | "teams",
  id: string,
  summary: string,
  intent: "activity" | "dependencies" | "status" = "activity",
): DeliveryResultItem => ({
  id,
  workspaceId: request.workspaceId,
  source,
  selector: intent === "activity" ? "observations" : intent === "status" ? "objects" : "relations",
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
  it("rejects finance before any source call", async () => {
    const execute = vi.fn(() =>
      Effect.succeed({ items: [], conflicts: [], unavailableSources: [], complete: true }),
    );
    const source: DeliveryQuerySource = { source: "projection", selectors: ["metrics"], execute };
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

  it("deduplicates cross-source facts and returns at most three cited lines", async () => {
    const source: DeliveryQuerySource = {
      source: "projection",
      selectors: ["observations"],
      execute: () =>
        Effect.succeed({
          items: [
            item("github", "1", "Merged delivery report"),
            { ...item("jira", "2", "Merged delivery report"), dedupeKey: "merged delivery report" },
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
    expect(answer.text.split("\n").length).toBeLessThanOrEqual(3);
    expect(answer.text.match(/Merged delivery report/g)).toHaveLength(1);
    expect(answer.citations).toHaveLength(2);
    expect(answer.status).toBe("ok");
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
    expect(answer.text.split("\n")).toHaveLength(2);
    expect(answer.text).not.toContain("Dependencies:");
    expect(answer.text).toContain("Conflict — DEMO-1 status: blocked");
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
            { ...item("jira", "other", "Other workspace"), workspaceId: "other" },
            { ...item("jira", "restricted", "Restricted"), sensitivity: "restricted" },
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
});

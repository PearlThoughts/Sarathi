import { describe, expect, it } from "vitest";
import {
  assertNonFinancialAttributes,
  type DeliveryClaim,
  deliveryClaimValueHash,
  findDeliveryConflicts,
  planDeliveryQuestion,
  resolveDeliveryTimeConstraint,
  validateDeliveryQueryPlan,
} from "../src/modules/delivery-intelligence/index.ts";

describe("delivery intelligence domain", () => {
  it("keeps scope and requirements independent of time", () => {
    const plan = planDeliveryQuestion("What is the project scope and its requirements?");
    expect(plan?.intents).toEqual(["scope", "requirements"]);
    expect(plan?.operations).toHaveLength(2);
    expect(plan?.operations.every((operation) => operation.time === undefined)).toBe(true);
  });

  it("assigns independent time constraints to compound delivery questions", () => {
    const plan = planDeliveryQuestion(
      "What did the team deliver last sprint, and what are they doing this week?",
    );
    expect(plan?.intents).toEqual(["delivered", "current_work"]);
    expect(plan?.operations[0]?.time).toEqual({ kind: "jira_sprint", sprint: "previous" });
    expect(plan?.operations[1]?.time).toEqual({ kind: "workspace_week" });
  });

  it("uses relation traversal for dependency and ownership questions", () => {
    const plan = planDeliveryQuestion(
      "Who owns the work and who is waiting for whom in the active sprint?",
    );
    expect(plan?.intents).toEqual(["ownership", "dependencies"]);
    expect(plan?.operations[0]?.traversal?.maximumDepth).toBe(1);
    expect(plan?.operations[1]?.traversal).toEqual({
      kinds: ["depends_on", "blocks"],
      direction: "both",
      maximumDepth: 2,
    });
    expect(plan?.operations[1]?.time).toEqual({ kind: "jira_sprint", sprint: "current" });
  });

  it("isolates finance plans and rejects finance attributes in shared objects", () => {
    expect(planDeliveryQuestion("What is the current project budget?")?.requiresFinance).toBe(true);
    expect(() =>
      assertNonFinancialAttributes({ owner: "actor-example", budgetAmount: 100 }),
    ).toThrow("confidential finance metric boundary");
    expect(() =>
      assertNonFinancialAttributes({ owner: "actor-example", status: "active" }),
    ).not.toThrow();
  });

  it("rejects unbounded or unknown model-proposed plans", () => {
    expect(() =>
      validateDeliveryQueryPlan({
        version: 1,
        intents: ["dependencies"],
        operations: [
          {
            id: "unsafe",
            purpose: "dependencies",
            select: "sql",
            limit: 1000,
          },
        ],
        answerMode: "model_assisted",
        maximumLines: 3,
        requiresFinance: false,
      }),
    ).toThrow("unknown selector");
  });

  it("derives conflicts without overwriting competing claims", () => {
    const claim = (
      id: string,
      value: string,
      authority: number,
      source: "jira" | "teams",
    ): DeliveryClaim => ({
      id,
      workspaceId: "workspace-example",
      subjectKey: "project:example",
      predicate: "delivery-status",
      value,
      valueHash: deliveryClaimValueHash(value),
      authority,
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
    const conflicts = findDeliveryConflicts([
      claim("jira-1", "blocked", 0.95, "jira"),
      claim("teams-1", "ready", 0.7, "teams"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.claims.map((entry) => entry.value)).toEqual(["blocked", "ready"]);
  });

  it("resolves workspace-local time only when a query requests it", () => {
    expect(
      resolveDeliveryTimeConstraint(
        { kind: "workspace_day" },
        "2026-07-20T13:09:00.000Z",
        "Asia/Kolkata",
      ),
    ).toEqual({
      fromInclusive: "2026-07-19T18:30:00.000Z",
      toExclusive: "2026-07-20T18:30:00.000Z",
    });
  });
});

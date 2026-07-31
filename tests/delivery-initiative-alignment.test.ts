import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createDeliveryAssistant,
  type DeliveryQuerySource,
  type DeliveryResultItem,
} from "../src/modules/delivery-intelligence/index.ts";

const workspaceId = "workspace-launchpad";
const requestedAt = "2026-07-31T08:00:00.000Z";

const item = (
  overrides: Partial<DeliveryResultItem> & Pick<DeliveryResultItem, "id" | "source" | "intent">,
): DeliveryResultItem => ({
  workspaceId,
  selector: "objects",
  title: overrides.id,
  summary: overrides.id,
  citationUrl: `https://sources.example.test/${overrides.id}`,
  sensitivity: "internal",
  authority: 1,
  observedAt: requestedAt,
  dedupeKey: overrides.id,
  ...overrides,
});

const source = (
  name: DeliveryQuerySource["source"],
  items: readonly DeliveryResultItem[],
): DeliveryQuerySource => ({
  source: name,
  selectors: ["objects"],
  execute: () =>
    Effect.succeed({
      items,
      conflicts: [],
      unavailableSources: [],
      complete: true,
    }),
});

describe("initiative-first delivery alignment", () => {
  it("groups structured work under declared initiatives and leaves unmatched work explicit", async () => {
    const assistant = createDeliveryAssistant({
      sources: [
        source("intent", [
          item({
            id: "initiative-admin",
            source: "strategy",
            intent: "current_work",
            title: "Admin workflow",
            summary: "Quarter 3 initiative. Plan status: In Progress.",
            citationUrl: "https://sources.example.test/quarterly-plan",
            evidenceRole: "declared_intent",
          }),
          item({
            id: "initiative-routing",
            source: "strategy",
            intent: "current_work",
            title: "Lead routing dashboard",
            summary:
              "Quarter 3 initiative. Also known as: routing dashboard. Plan status: In Progress.",
            citationUrl: "https://sources.example.test/quarterly-plan",
            evidenceRole: "declared_intent",
          }),
          item({
            id: "goal-growth",
            source: "strategy",
            intent: "goals",
            title: "Growth",
            summary: "Quarter 3 goal. Plan status: Active.",
            citationUrl: "https://sources.example.test/quarterly-plan",
            evidenceRole: "declared_intent",
          }),
        ]),
        source("jira", [
          item({
            id: "work-routing",
            source: "jira",
            intent: "current_work",
            title: "Add owner filters to the routing dashboard",
            summary: "Build the new routing dashboard owner filters.",
            lifecycleState: "active",
          }),
          item({
            id: "work-unassigned",
            source: "jira",
            intent: "current_work",
            title: "Renew a vendor certificate",
            summary: "Operational maintenance.",
            lifecycleState: "active",
          }),
        ]),
      ],
      now: () => new Date(requestedAt),
      totalBudgetMs: 1_000,
      sourceTimeoutMs: 500,
      compositionTimeoutMs: 250,
    });

    const answer = await Effect.runPromise(
      assistant.answer({
        workspaceId,
        actorId: "actor-manager",
        maximumSensitivity: "internal",
        financeAccess: false,
        requestedAt,
        timeZone: "Asia/Kolkata",
        question: "Are this week's planned deliverables aligned with this quarter's goals?",
      }),
    );

    expect(answer.text).toContain("## Initiative alignment");
    expect(answer.text).toContain(
      "**Lead routing dashboard** — Add owner filters to the routing dashboard",
    );
    expect(answer.text).toContain("## Unassigned work");
    expect(answer.text).toContain("- Renew a vendor certificate");
    expect(answer.text).not.toContain("**Planned:**");
  });
});

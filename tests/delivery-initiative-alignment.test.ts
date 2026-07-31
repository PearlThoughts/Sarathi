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
          item({
            id: "initiative-token",
            source: "strategy",
            intent: "current_work",
            title: "Improve GA mapping token refresh",
            summary: "Quarter 3 initiative. Plan status: In Progress.",
            citationUrl: "https://sources.example.test/quarterly-plan",
            evidenceRole: "declared_intent",
          }),
          item({
            id: "initiative-cve",
            source: "strategy",
            intent: "current_work",
            title: "CVE remediation",
            summary: "Quarter 3 initiative. Plan status: In Progress.",
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
          item({
            id: "work-token",
            source: "jira",
            intent: "current_work",
            title: "Renew LinkedIn access token and refresh token",
            summary: "Renew the social network integration credentials.",
            lifecycleState: "active",
          }),
          item({
            id: "work-cve",
            source: "jira",
            intent: "current_work",
            title: "Remediate dependency CVEs",
            summary: "Update vulnerable application dependencies.",
            lifecycleState: "active",
          }),
          ...Array.from({ length: 6 }, (_, index) =>
            item({
              id: `work-maintenance-${index + 1}`,
              source: "jira",
              intent: "current_work",
              title: `Operational maintenance task ${index + 1}`,
              summary: "Routine operational maintenance.",
              lifecycleState: "active",
            }),
          ),
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
    expect(answer.text).toContain("**CVE remediation** — Remediate dependency CVEs");
    expect(answer.text).toContain("## Unassigned work");
    expect(answer.text).toContain("- Renew a vendor certificate");
    expect(answer.text).toContain("- Renew LinkedIn access token and refresh token");
    expect(answer.text).not.toContain(
      "**Improve GA mapping token refresh** — Renew LinkedIn access token and refresh token",
    );
    expect(answer.text).toContain("- **Jira:**");
    expect(answer.text).toContain("_+4 more_");
    expect(answer.citations.filter(({ label }) => label.startsWith("Jira"))).toHaveLength(6);
    expect(answer.text).not.toContain("**Planned:**");
  });
});

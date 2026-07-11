import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createTeamsProactiveReminderDelivery } from "../src/infrastructure/graph/index.ts";
import { createJiraComplianceReminderSource } from "../src/infrastructure/jira/index.ts";
import { createPostgresComplianceReminderAudit } from "../src/infrastructure/postgres/index.ts";

describe("Finance reminder adapters", () => {
  it("limits Jira selection to the requested planning window", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          issues: [
            {
              key: "TEST-1",
              fields: {
                summary: "Synthetic reminder",
                status: { name: "Open" },
                duedate: "2026-07-14",
              },
            },
          ],
        }),
      ),
    );
    const source = createJiraComplianceReminderSource({
      baseUrl: "https://jira.example.invalid",
      email: "synthetic@example.invalid",
      apiToken: "synthetic",
      projectKey: "TEST",
      labels: ["compliance"],
      fetcher: fetcher as unknown as typeof fetch,
    });
    const result = await Effect.runPromise(
      source.findOpenItems({
        workspaceId: "finance",
        kind: "planning",
        today: "2026-07-11",
        window: { startDate: "2026-07-11", endDate: "2026-07-17" },
      }),
    );
    expect(result).toMatchObject([{ workspaceId: "finance", item: { id: "TEST-1" } }]);
    expect(fetcher.mock.calls[0]?.[1]?.body).toContain("2026-07-17");
  });

  it("uses a renewable token for proactive Teams delivery", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "synthetic-message" }), { status: 201 }),
      );
    const delivery = createTeamsProactiveReminderDelivery({
      chatId: "synthetic-chat",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(
      Effect.runPromise(
        delivery.deliver({
          workspaceId: "finance",
          idempotencyKey: "finance:synthetic",
          digest: { kind: "planning", today: "2026-07-11", itemCount: 0, text: "Synthetic" },
        }),
      ),
    ).resolves.toEqual({ externalId: "synthetic-message" });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer synthetic-token",
    });
  });

  it("atomically reserves a key and permits a retryable outcome to be retried", async () => {
    let state: "missing" | "processing" | "retryable_failure" = "missing";
    const audit = createPostgresComplianceReminderAudit({
      query: async (text) => {
        if (text.startsWith("insert into compliance_reminder_audit")) {
          if (state === "missing" || state === "retryable_failure") {
            state = "processing";
            return { rows: [{ state }] };
          }
          return { rows: [] };
        }
        if (text.startsWith("update compliance_reminder_audit")) {
          state = "retryable_failure";
          return { rows: [{ state }] };
        }
        return { rows: [] };
      },
    });
    const key = { workspaceId: "finance", idempotencyKey: "key" };
    await expect(Effect.runPromise(audit.reserve(key))).resolves.toEqual({ kind: "acquired" });
    await expect(Effect.runPromise(audit.reserve(key))).resolves.toEqual({ kind: "duplicate" });
    await Effect.runPromise(
      audit.append({
        ...key,
        digest: { kind: "planning", today: "2026-07-11", itemCount: 0, text: "Synthetic" },
        state: "retryable_failure",
        occurredAt: "2026-07-11T00:00:00.000Z",
        retryAt: "2026-07-11T00:05:00.000Z",
      }),
    );
    await expect(Effect.runPromise(audit.reserve(key))).resolves.toEqual({ kind: "acquired" });
  });
});

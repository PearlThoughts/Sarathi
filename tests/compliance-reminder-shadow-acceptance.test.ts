import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type {
  ComplianceReminderAudit,
  ComplianceReminderAuditStore,
  ComplianceReminderRequest,
} from "../src/modules/compliance-reminders/index.ts";
import { runComplianceReminderShadowAcceptance } from "../src/modules/compliance-reminders/index.ts";

describe("Finance shadow runtime acceptance", () => {
  it("proves reservation, due retry, scheduler containment, and zero delivery", async () => {
    const request: ComplianceReminderRequest = {
      workspaceId: "finance",
      idempotencyKey: "finance:shadow-acceptance:synthetic",
      kind: "exceptions",
      today: "2026-07-12",
      dryRun: false,
      occurredAt: "2026-07-12T00:00:00.000Z",
      retryAt: "9999-12-31T23:59:59.999Z",
    };
    let audit: ComplianceReminderAudit | undefined;
    let completed = false;
    const store: ComplianceReminderAuditStore = {
      provider: "compliance-reminder-audit",
      reserve: () =>
        Effect.succeed(audit === undefined ? { kind: "acquired" } : { kind: "duplicate" }),
      append: (value) => Effect.sync(() => (audit = value)),
      dueRetries: () => Effect.succeed(audit?.state === "retryable_failure" ? [request] : []),
      hasDueRetry: () => Effect.succeed(audit?.state === "retryable_failure"),
      recordDryRunEvidence: () => Effect.void,
      completeShadowAcceptance: () => Effect.sync(() => (completed = true)),
    };
    const result = await runComplianceReminderShadowAcceptance(request, {
      source: {
        provider: "compliance-reminder-source",
        findOpenItems: () =>
          Effect.succeed([
            {
              workspaceId: "finance",
              item: {
                id: "TEST-1",
                title: "Synthetic compliance item",
                status: "Open",
                dueDate: "2026-07-11",
                source: {
                  system: "manual-yaml",
                  externalId: "TEST-1",
                  confidence: "declared",
                },
                sensitivity: "internal",
              },
            },
          ]),
      },
      audit: store,
    });

    expect(result).toMatchObject({
      state: "shadow_accepted",
      itemCount: 1,
      auditReservation: "verified",
      dueRetry: "verified",
      schedulerError: "contained",
      noDeliveryAttempts: 1,
      externalDeliveries: 0,
    });
    expect(result.digestHash).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(audit?.state).toBe("retryable_failure");
    expect(audit?.digest.text).toBe("[redacted shadow acceptance]");
    expect(completed).toBe(true);
  });
});

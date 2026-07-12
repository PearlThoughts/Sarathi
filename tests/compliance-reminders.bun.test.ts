import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { RepositoryError } from "../src/domain/errors.ts";
import type { WorkspaceFollowUpItem } from "../src/modules/compliance-reminders/domain/compliance-reminder.ts";
import {
  type ComplianceReminderAudit,
  type ComplianceReminderAuditStore,
  type ComplianceReminderDelivery,
  type ComplianceReminderRequest,
  type ComplianceReminderSource,
  runComplianceReminder,
} from "../src/modules/compliance-reminders/index.ts";

const request: ComplianceReminderRequest = {
  workspaceId: "finance",
  idempotencyKey: "finance:planning:2026-07-11",
  kind: "planning",
  today: "2026-07-11",
  window: { startDate: "2026-07-11", endDate: "2026-07-17" },
  dryRun: false,
  occurredAt: "2026-07-11T09:00:00.000Z",
  retryAt: "2026-07-11T09:05:00.000Z",
};

const item: WorkspaceFollowUpItem = {
  workspaceId: "finance",
  item: {
    id: "synthetic-item",
    title: "Synthetic compliance work",
    status: "Open",
    dueDate: "2026-07-14",
    source: { system: "manual-yaml", externalId: "synthetic-source", confidence: "declared" },
    sensitivity: "internal",
  },
};

const source = (entries: readonly WorkspaceFollowUpItem[]): ComplianceReminderSource => ({
  provider: "compliance-reminder-source",
  findOpenItems: () => Effect.succeed(entries),
});

const auditStore = (
  existing: ComplianceReminderAudit | undefined,
  appended: ComplianceReminderAudit[],
  appendFailure = false,
): ComplianceReminderAuditStore => ({
  provider: "compliance-reminder-audit",
  reserve: () =>
    Effect.succeed(
      existing === undefined
        ? { kind: "acquired" as const }
        : { kind: "duplicate" as const, audit: existing },
    ),
  append: (audit) =>
    appendFailure
      ? Effect.fail(new RepositoryError({ message: "audit append failed" }))
      : Effect.sync(() => appended.push(audit)),
  dueRetries: () => Effect.succeed([]),
  hasDueRetry: () => Effect.succeed(false),
  recordDryRunEvidence: () => Effect.void,
  completeShadowAcceptance: () => Effect.void,
});

const delivery = (shouldFail = false): ComplianceReminderDelivery => ({
  provider: "compliance-reminder-delivery",
  deliver: () =>
    shouldFail
      ? Effect.fail(new RepositoryError({ message: "delivery failed" }))
      : Effect.succeed({ externalId: "synthetic-delivery" }),
});

describe("compliance reminders", () => {
  test("plans dry runs without delivery or audit side effects", async () => {
    const appended: ComplianceReminderAudit[] = [];
    const result = await Effect.runPromise(
      runComplianceReminder(
        { ...request, dryRun: true },
        { source: source([item]), delivery: delivery(), audit: auditStore(undefined, appended) },
      ),
    );
    expect(result.state).toBe("planned");
    expect(appended).toEqual([]);
  });

  test("rejects items from another workspace", async () => {
    const result = Effect.runPromise(
      runComplianceReminder(request, {
        source: source([{ ...item, workspaceId: "1851" }]),
        delivery: delivery(),
        audit: auditStore(undefined, []),
      }),
    );
    await expect(result).rejects.toThrow("source returned an item from another workspace");
  });

  test("suppresses an existing idempotency key", async () => {
    const appended: ComplianceReminderAudit[] = [];
    const existing: ComplianceReminderAudit = {
      workspaceId: "finance",
      idempotencyKey: request.idempotencyKey,
      request,
      digest: {
        kind: "planning",
        today: request.today,
        itemCount: 0,
        text: "prior",
        window: request.window,
      },
      state: "delivered",
      occurredAt: request.occurredAt,
    };
    const result = await Effect.runPromise(
      runComplianceReminder(request, {
        source: source([item]),
        delivery: delivery(),
        audit: auditStore(existing, appended),
      }),
    );
    expect(result.state).toBe("suppressed_duplicate");
    expect(appended).toEqual([]);
  });

  test("records delivered and retryable failure outcomes", async () => {
    const delivered: ComplianceReminderAudit[] = [];
    const failed: ComplianceReminderAudit[] = [];
    const success = await Effect.runPromise(
      runComplianceReminder(request, {
        source: source([item]),
        delivery: delivery(),
        audit: auditStore(undefined, delivered),
      }),
    );
    const failure = await Effect.runPromise(
      runComplianceReminder(request, {
        source: source([item]),
        delivery: delivery(true),
        audit: auditStore(undefined, failed),
      }),
    );
    expect(success.state).toBe("delivered");
    expect(delivered[0]?.state).toBe("delivered");
    expect(failure.state).toBe("retryable_failure");
    expect(failed[0]?.retryAt).toBe(request.retryAt);
  });

  test("does not recast an audit failure after delivery as a retryable delivery failure", async () => {
    const result = Effect.runPromise(
      runComplianceReminder(request, {
        source: source([item]),
        delivery: delivery(),
        audit: auditStore(undefined, [], true),
      }),
    );
    await expect(result).rejects.toThrow("audit append failed");
  });
});

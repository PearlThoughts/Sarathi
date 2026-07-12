import { Effect } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import { stableSha256 } from "../../../domain/hash.ts";
import type { ComplianceReminderRequest } from "../domain/compliance-reminder.ts";
import type { ComplianceReminderAuditStore } from "../ports/compliance-reminder-audit.ts";
import type { ComplianceReminderSource } from "../ports/compliance-reminder-source.ts";
import { runComplianceReminderSchedulerTick } from "./compliance-reminder-scheduler.ts";
import { runComplianceReminder } from "./run-compliance-reminder.ts";

type ComplianceReminderShadowAcceptance = {
  readonly state: "shadow_accepted";
  readonly kind: ComplianceReminderRequest["kind"];
  readonly itemCount: number;
  readonly digestHash: string;
  readonly auditReservation: "verified";
  readonly dueRetry: "verified";
  readonly schedulerError: "contained";
  readonly noDeliveryAttempts: number;
  readonly externalDeliveries: 0;
  readonly occurredAt: string;
};

export const runComplianceReminderShadowAcceptance = async (
  request: ComplianceReminderRequest,
  dependencies: {
    readonly source: ComplianceReminderSource;
    readonly audit: ComplianceReminderAuditStore;
  },
): Promise<ComplianceReminderShadowAcceptance> => {
  let noDeliveryAttempts = 0;
  const shadowAudit: ComplianceReminderAuditStore = {
    ...dependencies.audit,
    append: (audit) =>
      dependencies.audit.append({
        ...audit,
        digest: { ...audit.digest, text: "[redacted shadow acceptance]" },
      }),
  };
  const result = await Effect.runPromise(
    runComplianceReminder(request, {
      source: dependencies.source,
      audit: shadowAudit,
      delivery: {
        provider: "compliance-reminder-delivery",
        deliver: () => {
          noDeliveryAttempts += 1;
          return Effect.fail(
            new RepositoryError({ message: "Shadow acceptance forbids external delivery." }),
          );
        },
      },
    }),
  );
  let acceptance: ComplianceReminderShadowAcceptance | undefined;
  let evidenceError: unknown;
  try {
    const duplicateReservation = await Effect.runPromise(
      dependencies.audit.reserve({
        workspaceId: request.workspaceId,
        idempotencyKey: request.idempotencyKey,
        occurredAt: request.occurredAt,
      }),
    );
    const dueRetry = await Effect.runPromise(
      dependencies.audit.hasDueRetry({
        workspaceId: request.workspaceId,
        idempotencyKey: request.idempotencyKey,
        now: request.retryAt,
      }),
    );
    const schedulerProbe = await runComplianceReminderSchedulerTick(
      {
        enabled: false,
        workspaceId: request.workspaceId,
        timezone: "UTC",
        weeklyDigestTime: "00:00",
        exceptionDigestTime: "00:00",
      },
      async () => undefined,
      async () => {
        throw new Error("shadow acceptance scheduler source failure");
      },
      new Date(request.occurredAt),
    );
    if (
      result.state !== "retryable_failure" ||
      duplicateReservation.kind !== "duplicate" ||
      !dueRetry ||
      !schedulerProbe.retryLoadFailed
    ) {
      throw new Error("Finance shadow acceptance evidence is incomplete.");
    }
    acceptance = {
      state: "shadow_accepted",
      kind: request.kind,
      itemCount: result.digest.itemCount,
      digestHash: stableSha256(result.digest.text),
      auditReservation: "verified",
      dueRetry: "verified",
      schedulerError: "contained",
      noDeliveryAttempts,
      externalDeliveries: 0,
      occurredAt: request.occurredAt,
    };
  } catch (error) {
    evidenceError = error;
  }
  let cleanupError: unknown;
  try {
    await Effect.runPromise(
      dependencies.audit.completeShadowAcceptance({
        workspaceId: request.workspaceId,
        idempotencyKey: request.idempotencyKey,
      }),
    );
  } catch (error) {
    cleanupError = error;
  }
  if (evidenceError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [evidenceError, cleanupError],
      "Shadow acceptance and cleanup failed.",
    );
  }
  if (evidenceError !== undefined) throw evidenceError;
  if (cleanupError !== undefined) throw cleanupError;
  if (acceptance === undefined)
    throw new Error("Finance shadow acceptance evidence is incomplete.");
  return acceptance;
};

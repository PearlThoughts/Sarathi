import { Effect, Either } from "effect";
import { type RepositoryError, ValidationError } from "../../../domain/errors.ts";
import {
  formatExceptionDigest,
  formatPlanningDigest,
} from "../../follow-up/application/format-follow-up-digest.ts";
import type {
  ComplianceReminderRequest,
  ComplianceReminderResult,
} from "../domain/compliance-reminder.ts";
import type { ComplianceReminderAuditStore } from "../ports/compliance-reminder-audit.ts";
import type { ComplianceReminderDelivery } from "../ports/compliance-reminder-delivery.ts";
import type { ComplianceReminderSource } from "../ports/compliance-reminder-source.ts";

export const runComplianceReminder = (
  request: ComplianceReminderRequest,
  dependencies: {
    readonly source: ComplianceReminderSource;
    readonly delivery: ComplianceReminderDelivery;
    readonly audit: ComplianceReminderAuditStore;
  },
): Effect.Effect<ComplianceReminderResult, RepositoryError | ValidationError> =>
  Effect.gen(function* () {
    if (request.kind === "planning" && request.window === undefined) {
      return yield* Effect.fail(
        new ValidationError({ field: "window", message: "planning reminders require a window" }),
      );
    }

    const entries = yield* dependencies.source.findOpenItems({
      workspaceId: request.workspaceId,
      kind: request.kind,
      today: request.today,
      window: request.window,
    });
    if (entries.some((entry) => entry.workspaceId !== request.workspaceId)) {
      return yield* Effect.fail(
        new ValidationError({
          field: "workspaceId",
          message: "source returned an item from another workspace",
        }),
      );
    }

    const items = entries.map((entry) => entry.item);
    const digest =
      request.kind === "planning"
        ? formatPlanningDigest(
            items,
            request.today,
            request.window as NonNullable<typeof request.window>,
          )
        : formatExceptionDigest(items, request.today);

    if (request.dryRun) {
      return { state: "planned", digest, idempotencyKey: request.idempotencyKey };
    }

    const existing = yield* dependencies.audit.reserve({
      workspaceId: request.workspaceId,
      idempotencyKey: request.idempotencyKey,
    });
    if (existing !== undefined) {
      return {
        state: "suppressed_duplicate",
        digest: existing.digest,
        idempotencyKey: request.idempotencyKey,
      };
    }

    const delivery = yield* dependencies.delivery
      .deliver({ workspaceId: request.workspaceId, idempotencyKey: request.idempotencyKey, digest })
      .pipe(Effect.either);
    if (Either.isLeft(delivery)) {
      yield* dependencies.audit.append({
        workspaceId: request.workspaceId,
        idempotencyKey: request.idempotencyKey,
        digest,
        state: "retryable_failure",
        occurredAt: request.occurredAt,
        retryAt: request.retryAt,
      });
      return { state: "retryable_failure", digest, idempotencyKey: request.idempotencyKey };
    }

    yield* dependencies.audit.append({
      workspaceId: request.workspaceId,
      idempotencyKey: request.idempotencyKey,
      digest,
      state: "delivered",
      occurredAt: request.occurredAt,
      externalId: delivery.right.externalId,
    });
    return { state: "delivered", digest, idempotencyKey: request.idempotencyKey };
  });

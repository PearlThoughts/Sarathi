import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { ComplianceReminderAudit } from "../domain/compliance-reminder.ts";

export type ComplianceReminderAuditStore = {
  readonly provider: "compliance-reminder-audit";
  /**
   * Atomically reserves an idempotency key. The adapter owns the reservation
   * lease and recovery policy so concurrent scheduler runs cannot duplicate a
   * delivery.
   */
  readonly reserve: (input: {
    readonly workspaceId: string;
    readonly idempotencyKey: string;
  }) => Effect.Effect<ComplianceReminderAudit | undefined, RepositoryError>;
  readonly append: (audit: ComplianceReminderAudit) => Effect.Effect<void, RepositoryError>;
};

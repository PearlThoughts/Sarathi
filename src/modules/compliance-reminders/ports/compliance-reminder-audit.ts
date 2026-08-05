import type { Effect } from 'effect';
import type { RepositoryError } from '../../../domain/errors.ts';
import type { ComplianceReminderAudit } from '../domain/compliance-reminder.ts';

export type ComplianceReminderAuditStore = {
  readonly provider: 'compliance-reminder-audit';
  readonly findByIdempotencyKey: (input: {
    readonly workspaceId: string;
    readonly idempotencyKey: string;
  }) => Effect.Effect<ComplianceReminderAudit | undefined, RepositoryError>;
  readonly append: (audit: ComplianceReminderAudit) => Effect.Effect<void, RepositoryError>;
};

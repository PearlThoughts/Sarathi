import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type {
  ComplianceReminderAuditStore,
  ComplianceReminderReservation,
} from "../../modules/compliance-reminders/index.ts";

type Database = {
  readonly query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
};

const unavailable = () =>
  new RepositoryError({ message: "Durable compliance reminder audit is unavailable." });

const ensureTable = async (database: Database): Promise<void> => {
  await database.query(
    "create table if not exists compliance_reminder_audit (workspace_id text not null, idempotency_hash text not null, state text not null, digest_json text, occurred_at text, retry_at text, external_id text, updated_at text not null, primary key (workspace_id, idempotency_hash))",
  );
};

export const createPostgresComplianceReminderAudit = (
  database: Database,
): ComplianceReminderAuditStore => ({
  provider: "compliance-reminder-audit",
  reserve: (input) =>
    Effect.tryPromise({
      try: async (): Promise<ComplianceReminderReservation> => {
        await ensureTable(database);
        const now = new Date().toISOString();
        const result = await database.query(
          "insert into compliance_reminder_audit (workspace_id, idempotency_hash, state, updated_at) values ($1, $2, 'processing', $3) on conflict (workspace_id, idempotency_hash) do update set state = 'processing', updated_at = excluded.updated_at where compliance_reminder_audit.state = 'retryable_failure' returning state",
          [input.workspaceId, stableSha256(input.idempotencyKey), now],
        );
        return result.rows.length === 1 ? { kind: "acquired" } : { kind: "duplicate" };
      },
      catch: unavailable,
    }),
  append: (audit) =>
    Effect.tryPromise({
      try: async () => {
        await ensureTable(database);
        const result = await database.query(
          "update compliance_reminder_audit set state = $3, digest_json = $4, occurred_at = $5, retry_at = $6, external_id = $7, updated_at = $8 where workspace_id = $1 and idempotency_hash = $2 returning state",
          [
            audit.workspaceId,
            stableSha256(audit.idempotencyKey),
            audit.state,
            JSON.stringify(audit.digest),
            audit.occurredAt,
            audit.retryAt ?? null,
            audit.externalId ?? null,
            new Date().toISOString(),
          ],
        );
        if (result.rows.length === 0) throw new Error("Reminder audit reservation is missing.");
      },
      catch: unavailable,
    }),
});

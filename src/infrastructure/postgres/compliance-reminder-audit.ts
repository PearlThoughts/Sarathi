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
    "create table if not exists compliance_reminder_audit (workspace_id text not null, idempotency_hash text not null, state text not null, request_json text, digest_json text, occurred_at text, retry_at text, external_id text, updated_at text not null, primary key (workspace_id, idempotency_hash))",
  );
  await database.query(
    "alter table compliance_reminder_audit add column if not exists request_json text",
  );
  await database.query(
    "create table if not exists compliance_reminder_dry_run_evidence (workspace_id text not null, idempotency_hash text not null, kind text not null, item_count integer not null, digest_hash text not null, occurred_at text not null, primary key (workspace_id, idempotency_hash))",
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
          "insert into compliance_reminder_audit (workspace_id, idempotency_hash, state, updated_at) values ($1, $2, 'processing', $3) on conflict (workspace_id, idempotency_hash) do update set state = 'processing', updated_at = excluded.updated_at where compliance_reminder_audit.state = 'retryable_failure' and compliance_reminder_audit.retry_at <= $3 returning state",
          [input.workspaceId, stableSha256(input.idempotencyKey), input.occurredAt || now],
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
          "update compliance_reminder_audit set state = $3, request_json = $4, digest_json = $5, occurred_at = $6, retry_at = $7, external_id = $8, updated_at = $9 where workspace_id = $1 and idempotency_hash = $2 returning state",
          [
            audit.workspaceId,
            stableSha256(audit.idempotencyKey),
            audit.state,
            JSON.stringify(audit.request),
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
  dueRetries: (input) =>
    Effect.tryPromise({
      try: async () => {
        await ensureTable(database);
        const result = await database.query(
          "select request_json from compliance_reminder_audit where workspace_id = $1 and state = 'retryable_failure' and retry_at <= $2 and request_json is not null order by retry_at asc",
          [input.workspaceId, input.now],
        );
        return result.rows.flatMap((row) => {
          const value = row.request_json;
          if (typeof value !== "string") return [];
          try {
            return [JSON.parse(value)];
          } catch {
            return [];
          }
        });
      },
      catch: unavailable,
    }),
  recordDryRunEvidence: (evidence) =>
    Effect.tryPromise({
      try: async () => {
        await ensureTable(database);
        await database.query(
          "insert into compliance_reminder_dry_run_evidence (workspace_id, idempotency_hash, kind, item_count, digest_hash, occurred_at) values ($1, $2, $3, $4, $5, $6) on conflict (workspace_id, idempotency_hash) do update set kind = excluded.kind, item_count = excluded.item_count, digest_hash = excluded.digest_hash, occurred_at = excluded.occurred_at",
          [
            evidence.workspaceId,
            stableSha256(evidence.idempotencyKey),
            evidence.kind,
            evidence.itemCount,
            evidence.digestHash,
            evidence.occurredAt,
          ],
        );
      },
      catch: unavailable,
    }),
});

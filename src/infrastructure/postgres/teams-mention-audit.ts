import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type { TeamsMentionAudit } from "../../modules/teams-mention/ports/teams-mention-ports.ts";

type Database = {
  readonly query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
};

export const defaultTeamsMentionLeaseDurationMs = 15 * 60 * 1_000;

type TeamsMentionAuditConfiguration = {
  readonly leaseDurationMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
};

const positiveLeaseDuration = (value: number | undefined): number => {
  const duration = value ?? defaultTeamsMentionLeaseDurationMs;
  if (!Number.isInteger(duration) || duration < 1) {
    throw new Error("Teams mention lease duration must be a positive integer.");
  }
  return duration;
};

const attemptFromRow = (row: Record<string, unknown> | undefined): number => {
  const attempt = row?.attempt;
  return typeof attempt === "number" && Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
};

export const createPostgresTeamsMentionAudit = (
  database: Database,
  configuration: TeamsMentionAuditConfiguration = {},
): TeamsMentionAudit => {
  const leaseDurationMs = positiveLeaseDuration(configuration.leaseDurationMs);
  const now = configuration.now ?? (() => new Date());
  const leaseWindow = (): { readonly observedAt: string; readonly expiresAt: string } => {
    const observedAt = now();
    return {
      observedAt: observedAt.toISOString(),
      expiresAt: new Date(observedAt.getTime() + leaseDurationMs).toISOString(),
    };
  };

  let schemaReady: Promise<void> | undefined;
  const ensureSchema = (): Promise<void> =>
    (schemaReady ??= (async () => {
      await database.query(
        "create table if not exists teams_mention_audit (activity_hash text primary key, state text not null, workspace_id text, updated_at text not null, lease_expires_at text, attempt integer not null default 0)",
      );
      await database.query(
        "alter table teams_mention_audit add column if not exists lease_expires_at text",
      );
      await database.query(
        "alter table teams_mention_audit add column if not exists attempt integer not null default 0",
      );
    })());

  return {
    acquireLease: (activityId) =>
      Effect.tryPromise({
        try: async () => {
          const id = stableSha256(activityId);
          await ensureSchema();
          const window = leaseWindow();
          const result = await database.query(
            "insert into teams_mention_audit (activity_hash, state, updated_at, lease_expires_at, attempt) values ($1, 'processing', $2, $3, 1) on conflict (activity_hash) do update set state = 'processing', workspace_id = null, updated_at = excluded.updated_at, lease_expires_at = excluded.lease_expires_at, attempt = teams_mention_audit.attempt + 1 where teams_mention_audit.state = 'failed-retryable' or (teams_mention_audit.state = 'processing' and (teams_mention_audit.lease_expires_at is null or teams_mention_audit.lease_expires_at <= excluded.updated_at)) returning activity_hash, state, attempt",
            [id, window.observedAt, window.expiresAt],
          );
          if (result.rows.length > 0) {
            return { kind: "acquired" as const, attempt: attemptFromRow(result.rows[0]) };
          }
          const existing = await database.query(
            "select state, attempt from teams_mention_audit where activity_hash = $1",
            [id],
          );
          const state = existing.rows[0]?.state;
          if (state === "delivered") return { kind: "duplicate-delivered" as const };
          if (state === "failed-terminal") return { kind: "terminal" as const };
          return { kind: "in-progress" as const };
        },
        catch: () => new RepositoryError({ message: "Durable mention audit is unavailable." }),
      }),
    renewLease: (activityId, attempt) =>
      Effect.tryPromise({
        try: async () => {
          const window = leaseWindow();
          const result = await database.query(
            "update teams_mention_audit set updated_at = $3, lease_expires_at = $4 where activity_hash = $1 and state = 'processing' and attempt = $2 and (lease_expires_at is null or lease_expires_at > $3) returning activity_hash",
            [stableSha256(activityId), attempt, window.observedAt, window.expiresAt],
          );
          return result.rows.length > 0;
        },
        catch: () => new RepositoryError({ message: "Durable mention audit is unavailable." }),
      }),
    markDelivered: (activityId, workspaceId, attempt) =>
      Effect.tryPromise({
        try: async () => {
          await database.query(
            "update teams_mention_audit set state = 'delivered', workspace_id = $3, updated_at = $4, lease_expires_at = null where activity_hash = $1 and state = 'processing' and attempt = $2",
            [stableSha256(activityId), attempt, workspaceId, now().toISOString()],
          );
        },
        catch: () => new RepositoryError({ message: "Durable mention audit is unavailable." }),
      }),
    markFailed: (activityId, state, attempt, workspaceId) =>
      Effect.tryPromise({
        try: async () => {
          await database.query(
            "update teams_mention_audit set state = $3, workspace_id = $4, updated_at = $5, lease_expires_at = null where activity_hash = $1 and state = 'processing' and attempt = $2",
            [stableSha256(activityId), attempt, state, workspaceId, now().toISOString()],
          );
        },
        catch: () => new RepositoryError({ message: "Durable mention audit is unavailable." }),
      }),
  };
};

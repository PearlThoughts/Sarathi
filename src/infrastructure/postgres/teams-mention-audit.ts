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

export const createPostgresTeamsMentionAudit = (database: Database): TeamsMentionAudit => ({
  acquireLease: (activityId) =>
    Effect.tryPromise({
      try: async () => {
        const id = stableSha256(activityId);
        await database.query(
          "create table if not exists teams_mention_audit (activity_hash text primary key, state text not null, workspace_id text, updated_at text not null)",
        );
        const result = await database.query(
          "insert into teams_mention_audit (activity_hash, state, updated_at) values ($1, 'processing', $2) on conflict (activity_hash) do nothing returning activity_hash",
          [id, new Date().toISOString()],
        );
        return result.rows.length > 0
          ? { kind: "acquired" as const, attempt: 1 }
          : { kind: "in-progress" as const };
      },
      catch: () => new RepositoryError({ message: "Durable mention audit is unavailable." }),
    }),
  markDelivered: (activityId, workspaceId) =>
    Effect.tryPromise({
      try: async () => {
        await database.query(
          "update teams_mention_audit set state = 'delivered', workspace_id = $2, updated_at = $3 where activity_hash = $1",
          [stableSha256(activityId), workspaceId, new Date().toISOString()],
        );
      },
      catch: () => new RepositoryError({ message: "Durable mention audit is unavailable." }),
    }),
  markFailed: (activityId, state, workspaceId) =>
    Effect.tryPromise({
      try: async () => {
        await database.query(
          "update teams_mention_audit set state = $2, workspace_id = $3, updated_at = $4 where activity_hash = $1",
          [stableSha256(activityId), state, workspaceId, new Date().toISOString()],
        );
      },
      catch: () => new RepositoryError({ message: "Durable mention audit is unavailable." }),
    }),
});

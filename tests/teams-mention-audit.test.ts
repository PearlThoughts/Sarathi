import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createPostgresTeamsMentionAudit,
  defaultTeamsMentionLeaseDurationMs,
} from "../src/infrastructure/postgres/index.ts";
import { deliveryTransportTimeoutMs } from "../src/modules/delivery-intelligence/index.ts";

type AuditRow = {
  state: string;
  attempt: number;
  updatedAt: string;
  leaseExpiresAt?: string | undefined;
  workspaceId?: string | undefined;
};

const databaseFixture = () => {
  const rows = new Map<string, AuditRow>();
  return {
    rows,
    database: {
      query: async (sql: string, values: readonly unknown[] = []) => {
        if (sql.startsWith("create table") || sql.startsWith("alter table")) return { rows: [] };
        const id = String(values[0]);
        if (sql.startsWith("insert")) {
          const observedAt = String(values[1]);
          const leaseExpiresAt = String(values[2]);
          const existing = rows.get(id);
          const expired =
            existing?.state === "processing" &&
            (existing.leaseExpiresAt === undefined || existing.leaseExpiresAt <= observedAt);
          if (existing === undefined || existing.state === "failed-retryable" || expired) {
            const next = {
              state: "processing",
              attempt: (existing?.attempt ?? 0) + 1,
              updatedAt: observedAt,
              leaseExpiresAt,
            };
            rows.set(id, next);
            return { rows: [{ activity_hash: id, state: next.state, attempt: next.attempt }] };
          }
          return { rows: [] };
        }
        if (sql.startsWith("select")) {
          const row = rows.get(id);
          return { rows: row === undefined ? [] : [{ state: row.state, attempt: row.attempt }] };
        }
        const existing = rows.get(id);
        if (sql.includes("set updated_at = $3")) {
          const attempt = Number(values[1]);
          const observedAt = String(values[2]);
          if (
            existing?.state !== "processing" ||
            existing.attempt !== attempt ||
            (existing.leaseExpiresAt !== undefined && existing.leaseExpiresAt <= observedAt)
          ) {
            return { rows: [] };
          }
          rows.set(id, {
            ...existing,
            updatedAt: observedAt,
            leaseExpiresAt: String(values[3]),
          });
          return { rows: [{ activity_hash: id }] };
        }
        if (existing?.state !== "processing" || existing.attempt !== Number(values[1])) {
          return { rows: [] };
        }
        if (sql.includes("state = 'delivered'")) {
          rows.set(id, {
            ...existing,
            state: "delivered",
            workspaceId: String(values[2]),
            updatedAt: String(values[3]),
            leaseExpiresAt: undefined,
          });
        } else {
          rows.set(id, {
            ...existing,
            state: String(values[2]),
            workspaceId: values[3] === undefined ? undefined : String(values[3]),
            updatedAt: String(values[4]),
            leaseExpiresAt: undefined,
          });
        }
        return { rows: [] };
      },
    },
  };
};

describe("Postgres Teams mention audit", () => {
  it("keeps the default lease beyond the longest declared response budget", () => {
    expect(defaultTeamsMentionLeaseDurationMs).toBeGreaterThan(
      deliveryTransportTimeoutMs("leadership_report"),
    );
  });

  it("hashes activity IDs and rejects an unexpired duplicate", async () => {
    const fixture = databaseFixture();
    const audit = createPostgresTeamsMentionAudit(fixture.database);

    await expect(Effect.runPromise(audit.acquireLease("activity"))).resolves.toEqual({
      kind: "acquired",
      attempt: 1,
    });
    await expect(Effect.runPromise(audit.acquireLease("activity"))).resolves.toEqual({
      kind: "in-progress",
    });
    expect([...fixture.rows.keys()][0]).not.toBe("activity");
  });

  it("reacquires retryable and expired work with a higher fencing attempt", async () => {
    const fixture = databaseFixture();
    let now = new Date("2026-08-01T00:00:00.000Z");
    const audit = createPostgresTeamsMentionAudit(fixture.database, {
      leaseDurationMs: 1_000,
      now: () => now,
    });

    await expect(Effect.runPromise(audit.acquireLease("retryable"))).resolves.toEqual({
      kind: "acquired",
      attempt: 1,
    });
    await Effect.runPromise(audit.markFailed("retryable", "failed-retryable", 1));
    await expect(Effect.runPromise(audit.acquireLease("retryable"))).resolves.toEqual({
      kind: "acquired",
      attempt: 2,
    });

    await expect(Effect.runPromise(audit.acquireLease("expired"))).resolves.toEqual({
      kind: "acquired",
      attempt: 1,
    });
    now = new Date("2026-08-01T00:00:01.001Z");
    await expect(Effect.runPromise(audit.acquireLease("expired"))).resolves.toEqual({
      kind: "acquired",
      attempt: 2,
    });
  });

  it("fences renewal and terminal updates by attempt", async () => {
    const fixture = databaseFixture();
    const audit = createPostgresTeamsMentionAudit(fixture.database);

    await Effect.runPromise(audit.acquireLease("activity"));
    await Effect.runPromise(audit.markFailed("activity", "failed-retryable", 1));
    await Effect.runPromise(audit.acquireLease("activity"));

    await expect(Effect.runPromise(audit.renewLease("activity", 1))).resolves.toBe(false);
    await Effect.runPromise(audit.markDelivered("activity", "workspace", 1));
    await expect(Effect.runPromise(audit.acquireLease("activity"))).resolves.toEqual({
      kind: "in-progress",
    });
    await expect(Effect.runPromise(audit.renewLease("activity", 2))).resolves.toBe(true);
    await Effect.runPromise(audit.markDelivered("activity", "workspace", 2));
    await expect(Effect.runPromise(audit.acquireLease("activity"))).resolves.toEqual({
      kind: "duplicate-delivered",
    });
  });

  it("keeps terminal failures non-retryable", async () => {
    const fixture = databaseFixture();
    const audit = createPostgresTeamsMentionAudit(fixture.database);

    await Effect.runPromise(audit.acquireLease("activity"));
    await Effect.runPromise(audit.markFailed("activity", "failed-terminal", 1));
    await expect(Effect.runPromise(audit.acquireLease("activity"))).resolves.toEqual({
      kind: "terminal",
    });
  });
});

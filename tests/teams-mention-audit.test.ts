import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createPostgresTeamsMentionAudit } from "../src/infrastructure/postgres/index.ts";

describe("Postgres Teams mention audit", () => {
  it("hashes activity IDs and prevents a duplicate lease", async () => {
    const rows = new Map<string, string>();
    const audit = createPostgresTeamsMentionAudit({
      query: async (sql, values = []) => {
        if (sql.startsWith("create table")) return { rows: [] };
        const id = String(values[0]);
        if (sql.startsWith("insert")) {
          if (rows.has(id)) return { rows: [] };
          rows.set(id, "processing");
          return { rows: [{ activity_hash: id }] };
        }
        rows.set(id, String(values[1]));
        return { rows: [] };
      },
    });
    await expect(Effect.runPromise(audit.acquireLease("activity"))).resolves.toEqual({
      kind: "acquired",
      attempt: 1,
    });
    await expect(Effect.runPromise(audit.acquireLease("activity"))).resolves.toEqual({
      kind: "in-progress",
    });
    expect([...rows.keys()][0]).not.toBe("activity");
  });
});

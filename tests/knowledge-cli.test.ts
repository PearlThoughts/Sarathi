import { describe, expect, test } from "vitest";
import { runKnowledgeCommand } from "../src/cli/commands/knowledge-runtime.ts";
import { runReleaseCli } from "../src/cli/release.ts";

describe("knowledge CLI", () => {
  test("exposes the additive migration and rollback plan through the Effect CLI handler", async () => {
    const result = await runKnowledgeCommand(["migrate", "plan"], {});
    expect(result).toMatchObject({
      exitCode: 0,
      output: {
        ok: true,
        operation: "migrate-plan",
        knowledgeMigrationPlan: {
          additive: true,
          migrations: ["0000_enable-pgvector", "0001_knowledge-layer"],
          protectedTables: [
            "compliance_reminder_audit",
            "compliance_reminder_dry_run_evidence",
            "teams_mention_audit",
          ],
        },
      },
    });
  });

  test("is composed under the existing release CLI and fails safely without configuration", async () => {
    await expect(
      runReleaseCli({ args: ["knowledge", "migrate", "plan", "--json"], env: {} }),
    ).resolves.toMatchObject({ exitCode: 0 });
    const failed = await runReleaseCli({ args: ["knowledge", "status"], env: {} });
    expect(failed).toEqual({
      exitCode: 1,
      output: {
        ok: false,
        message: "Knowledge operation failed; inspect privacy-safe service diagnostics.",
      },
    });
    expect(JSON.stringify(failed)).not.toContain("API_KEY");
  });

  test("rejects unsupported ingestion scopes without touching a source", async () => {
    const result = await runKnowledgeCommand(["ingest", "everything"], {
      SARATHI_STRATEGY_DATABASE_URL: "secret-database-value",
    });
    expect(result.exitCode).toBe(1);
    expect(JSON.stringify(result)).not.toContain("secret-database-value");
  });
});

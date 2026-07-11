import { describe, expect, it } from "vitest";
import {
  applyStrategyKernelPostgresMigrations,
  closeStrategyKernelPostgresDatabase,
  createPostgresStrategyKernelRepository,
  openStrategyKernelPostgresDatabase,
  type StrategyKernelPostgresDatabase,
} from "../src/infrastructure/postgres/index.ts";
import type { Organization, Workspace } from "../src/modules/strategy-kernel/index.ts";

const now = "2026-07-11T10:00:00.000Z";

const organization: Organization = {
  id: "org-synthetic",
  name: "Synthetic Organization",
  createdAt: now,
  updatedAt: now,
};

const workspace: Workspace = {
  id: "workspace-synthetic",
  organizationId: organization.id,
  key: "synthetic",
  name: "Synthetic Workspace",
  kind: "project",
  defaultSensitivity: "internal",
  createdAt: now,
  updatedAt: now,
};

describe("Postgres strategy kernel repository", () => {
  it("constructs and closes a pool without opening a connection", async () => {
    const database = openStrategyKernelPostgresDatabase(
      "postgres://synthetic:synthetic@localhost:5432/synthetic",
    );
    await closeStrategyKernelPostgresDatabase(database);
  });

  it("applies portable migrations transactionally and records them", async () => {
    const statements: string[] = [];
    const query = async (text: string) => {
      statements.push(text);
      return { rows: [] };
    };
    const database = {
      query,
      connect: async () =>
        ({ query, release: () => undefined }) as unknown as import("pg").PoolClient,
    } satisfies StrategyKernelPostgresDatabase;

    expect(await applyStrategyKernelPostgresMigrations(database)).toEqual([
      "001_strategy_kernel",
      "002_workspace_pack_runtime",
      "003_evidence_import_watermark",
      "004_evidence_import_consent",
    ]);
    expect(statements.filter((statement) => statement === "begin")).toHaveLength(4);
    expect(statements.filter((statement) => statement === "commit")).toHaveLength(4);
    expect(
      statements.some((statement) => statement.includes("create table if not exists workspace")),
    ).toBe(true);
  });

  it("uses natural-key upserts and returns null-free typed evidence", async () => {
    const statements: Array<{ readonly text: string; readonly values: readonly unknown[] }> = [];
    const database = {
      query: async (text: string, values: readonly unknown[] = []) => {
        statements.push({ text, values });
        if (text.startsWith("select * from evidence_item")) {
          return {
            rows: [
              {
                id: "evidence-1",
                workspace_id: workspace.id,
                source_system: "teams",
                source_type: "message",
                external_id: "message-1",
                external_url: null,
                actor_id: null,
                occurred_at: now,
                title: "Synthetic evidence",
                body_excerpt: "Synthetic excerpt",
                content_hash: "hash",
                sensitivity: "internal",
                consent_status: null,
                consent_scope: null,
                consent_recorded_at: null,
                consent_recorded_by: null,
                ingested_at: now,
              },
            ],
          };
        }
        return { rows: [] };
      },
      connect: async () => {
        throw new Error("not used by repository test");
      },
    } satisfies StrategyKernelPostgresDatabase;
    const repository = createPostgresStrategyKernelRepository(database);

    await repository.saveOrganization(organization);
    await repository.saveWorkspace(workspace);

    expect(await repository.listWorkspaceEvidence(workspace.id)).toEqual([
      {
        id: "evidence-1",
        workspaceId: workspace.id,
        sourceSystem: "teams",
        sourceType: "message",
        externalId: "message-1",
        occurredAt: now,
        title: "Synthetic evidence",
        bodyExcerpt: "Synthetic excerpt",
        contentHash: "hash",
        sensitivity: "internal",
        ingestedAt: now,
      },
    ]);
    expect(
      statements.some(
        ({ text }) =>
          text.includes("insert into workspace") &&
          text.includes("on conflict (organization_id, key) do update"),
      ),
    ).toBe(true);
  });
});

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runReleaseCli } from "../src/cli/release.ts";
import {
  applyStrategyKernelSqliteMigrations,
  createSqliteStrategyKernelRepository,
  openStrategyKernelSqliteDatabase,
} from "../src/infrastructure/sqlite/index.ts";
import {
  seedIntentIdForWorkspacePackSeed,
  workspaceIdForWorkspacePack,
} from "../src/modules/workspace-packs/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const launchpadPackDirectory = join(testDirectory, "fixtures", "workspace-packs", "launchpad");

describe("file-backed release CLI workspace reconciliation", () => {
  it("reconciles a workspace pack into durable SQLite with a safe summary", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "sarathi-pack-runtime-"));
    const databasePath = join(temporaryDirectory, "runtime.sqlite");

    try {
      const first = await runReleaseCli({
        args: ["workspace", "reconcile", "--pack", launchpadPackDirectory, "--db", databasePath],
        env: {},
        fetcher: async () => {
          throw new Error("unexpected fetch");
        },
      });
      const firstOutput = JSON.stringify(first.output);

      expect(first.exitCode).toBe(0);
      expect(first.output).toMatchObject({
        ok: true,
        mode: "file-backed",
        source: "workspace-pack-directory",
        database: "sqlite",
        workspace: {
          loaded: true,
          kind: "project",
          defaultSensitivity: "internal",
        },
        persisted: {
          workspaces: 1,
          actors: 2,
          externalResourceMappings: 4,
          seedIntents: 3,
          policies: 4,
          templates: 3,
        },
      });
      expect(firstOutput).not.toContain("LPAD");
      expect(firstOutput).not.toContain("example/launchpad-service");
      expect(firstOutput).not.toContain(launchpadPackDirectory);

      const second = await runReleaseCli({
        args: ["workspace", "reconcile", "--db", databasePath],
        env: {
          SARATHI_PRIVATE_WORKSPACE_PACK_DIR: launchpadPackDirectory,
        },
        fetcher: async () => {
          throw new Error("unexpected fetch");
        },
      });

      expect(second.exitCode).toBe(0);
      expect(second.output).toMatchObject({
        ok: true,
        mode: "file-backed",
        persisted: {
          workspaces: 0,
          actors: 0,
          externalResourceMappings: 0,
          seedIntents: 0,
          policies: 0,
          templates: 0,
        },
      });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("does not overwrite ratified intent when the pack seed drifts", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "sarathi-pack-drift-"));
    const databasePath = join(temporaryDirectory, "runtime.sqlite");

    try {
      await runReleaseCli({
        args: ["workspace", "reconcile", "--pack", launchpadPackDirectory, "--db", databasePath],
        env: {},
        fetcher: async () => {
          throw new Error("unexpected fetch");
        },
      });

      const database = openStrategyKernelSqliteDatabase(databasePath);
      applyStrategyKernelSqliteMigrations(database);
      const repository = createSqliteStrategyKernelRepository(database);
      const intentId = seedIntentIdForWorkspacePackSeed("launchpad", "qa-evidence");
      const workspaceId = workspaceIdForWorkspacePack("launchpad");

      await repository.saveIntentNode({
        id: intentId,
        workspaceId,
        kind: "commitment",
        title: "Human ratified QA evidence commitment",
        body: "Human-edited runtime intent must remain authoritative.",
        state: "ratified",
        sensitivity: "internal",
        createdBy: "human",
        createdAt: "2026-07-09T12:00:00.000Z",
        updatedAt: "2026-07-09T12:00:00.000Z",
      });
      database.close();

      const result = await runReleaseCli({
        args: ["workspace", "reconcile", "--pack", launchpadPackDirectory, "--db", databasePath],
        env: {},
        fetcher: async () => {
          throw new Error("unexpected fetch");
        },
      });
      const verificationDatabase = openStrategyKernelSqliteDatabase(databasePath);
      const verificationRepository = createSqliteStrategyKernelRepository(verificationDatabase);
      const preservedIntent = await verificationRepository.getIntentNode(intentId);
      const driftFindings = await verificationRepository.listWorkspaceDriftFindings(workspaceId);

      verificationDatabase.close();

      expect(result.exitCode).toBe(0);
      expect(result.output).toMatchObject({
        ok: true,
        mode: "file-backed",
        persisted: {
          seedIntents: 0,
          driftFindings: 1,
        },
      });
      expect(preservedIntent).toMatchObject({
        id: intentId,
        title: "Human ratified QA evidence commitment",
        body: "Human-edited runtime intent must remain authoritative.",
        state: "ratified",
      });
      expect(driftFindings).toContainEqual(
        expect.objectContaining({
          findingType: "pack_conflict",
          relatedEntityId: intentId,
        }),
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

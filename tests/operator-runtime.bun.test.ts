import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { openSqliteOperatorRuntime } from "../src/cli/commands/operator-runtime.ts";
import {
  applyStrategyKernelSqliteMigrations,
  createSqliteStrategyKernelRepository,
  openStrategyKernelSqliteDatabase,
} from "../src/infrastructure/sqlite/index.ts";
import type { Workspace } from "../src/modules/strategy-kernel/index.ts";

const temporaryDirectories: string[] = [];
const timestamp = "2026-07-10T06:00:00.000Z";

const createDatabase = async (workspaces: readonly Workspace[]): Promise<string> => {
  const directory = mkdtempSync(join(tmpdir(), "sarathi-operator-runtime-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "runtime.sqlite");
  const database = openStrategyKernelSqliteDatabase(databasePath);
  applyStrategyKernelSqliteMigrations(database);
  const repository = createSqliteStrategyKernelRepository(database);

  await repository.saveOrganization({
    id: "org-synthetic",
    name: "Synthetic Organization",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  for (const workspace of workspaces) {
    await repository.saveWorkspace(workspace);
  }
  database.close();
  return databasePath;
};

const workspace = (id: string, key: string): Workspace => ({
  id,
  organizationId: "org-synthetic",
  key,
  name: `Synthetic ${key}`,
  kind: "project",
  defaultSensitivity: "internal",
  createdAt: timestamp,
  updatedAt: timestamp,
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite operator runtime", () => {
  it("does not create a database when the selected path does not exist", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sarathi-operator-runtime-missing-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "missing.sqlite");

    await expect(
      Effect.runPromise(
        openSqliteOperatorRuntime({
          mode: "sqlite",
          databasePath,
          workspaceSelector: "workspace-a",
        }),
      ),
    ).rejects.toThrowError(/Selected SQLite database does not exist/u);
    expect(existsSync(databasePath)).toBe(false);
  });

  it("opens one durable repository and resolves a workspace by ID or key", async () => {
    const databasePath = await createDatabase([workspace("workspace-a", "launchpad")]);

    for (const workspaceSelector of ["workspace-a", "launchpad"]) {
      const runtime = await Effect.runPromise(
        openSqliteOperatorRuntime({ mode: "sqlite", databasePath, workspaceSelector }),
      );

      try {
        expect(runtime.workspace).toMatchObject({ id: "workspace-a", key: "launchpad" });
        expect(await runtime.repository.listWorkspaceEvidence(runtime.workspace.id)).toEqual([]);
      } finally {
        runtime.close();
      }
    }
  });

  it("fails closed when the selector does not match a persisted workspace", async () => {
    const databasePath = await createDatabase([workspace("workspace-a", "launchpad")]);

    await expect(
      Effect.runPromise(
        openSqliteOperatorRuntime({
          mode: "sqlite",
          databasePath,
          workspaceSelector: "missing",
        }),
      ),
    ).rejects.toThrowError(/Workspace selector did not match a persisted workspace/u);
  });

  it("fails closed when a selector matches one workspace ID and another workspace key", async () => {
    const databasePath = await createDatabase([
      workspace("workspace-a", "shared-selector"),
      workspace("shared-selector", "workspace-b"),
    ]);

    await expect(
      Effect.runPromise(
        openSqliteOperatorRuntime({
          mode: "sqlite",
          databasePath,
          workspaceSelector: "shared-selector",
        }),
      ),
    ).rejects.toThrowError(/Workspace selector matched multiple persisted workspaces/u);
  });
});

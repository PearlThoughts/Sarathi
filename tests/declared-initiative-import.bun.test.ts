import { describe, expect, it } from "bun:test";
import {
  applyStrategyKernelSqliteMigrations,
  createSqliteStrategyKernelRepository,
  openStrategyKernelSqliteDatabase,
} from "../src/infrastructure/sqlite/index.ts";
import {
  type DeclaredInitiativeSnapshot,
  importDeclaredInitiativeSnapshot,
  parseDeclaredInitiativeSnapshot,
} from "../src/modules/strategy-kernel/index.ts";

const workspaceId = "workspace-launchpad";

const snapshot = (revision: string): DeclaredInitiativeSnapshot =>
  parseDeclaredInitiativeSnapshot({
    version: 1,
    workspaceKey: "launchpad",
    period: {
      key: "quarter-3",
      title: "Quarter 3",
      horizonStart: "2026-07-01T00:00:00.000Z",
      horizonEnd: "2026-10-01T00:00:00.000Z",
    },
    source: {
      system: "spreadsheet",
      externalId: "plan-sheet",
      url: "https://docs.example.test/spreadsheets/plan",
      title: "Quarterly plan",
      revision,
      revisedAt: "2026-07-31T08:00:00.000Z",
    },
    items: [
      {
        key: "growth",
        kind: "goal",
        title: "Growth",
        status: "Active",
      },
      {
        key: "lead-routing",
        kind: "initiative",
        parentKey: "growth",
        title: "Partner intake dashboard",
        aliases: ["routing dashboard"],
        status: "In Progress",
        sourceRow: 12,
      },
    ],
  });

describe("declared initiative import", () => {
  it("persists a stable hierarchy, updates changed rows, and archives removed rows", async () => {
    const database = openStrategyKernelSqliteDatabase();
    applyStrategyKernelSqliteMigrations(database);
    const repository = createSqliteStrategyKernelRepository(database);
    await repository.saveOrganization({
      id: "organization-launchpad",
      name: "Launchpad",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    await repository.saveWorkspace({
      id: workspaceId,
      organizationId: "organization-launchpad",
      key: "launchpad",
      name: "Launchpad",
      kind: "project",
      defaultSensitivity: "internal",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    const first = await importDeclaredInitiativeSnapshot({
      repository,
      workspaceId,
      expectedWorkspaceKey: "launchpad",
      snapshot: snapshot("revision-1"),
      importedAt: "2026-07-31T08:01:00.000Z",
    });
    const second = await importDeclaredInitiativeSnapshot({
      repository,
      workspaceId,
      expectedWorkspaceKey: "launchpad",
      snapshot: snapshot("revision-1"),
      importedAt: "2026-07-31T08:02:00.000Z",
    });
    const changed = {
      ...snapshot("revision-2"),
      source: {
        ...snapshot("revision-2").source,
        revisedAt: "2026-08-07T08:00:00.000Z",
      },
      items: [
        {
          key: "growth",
          kind: "goal" as const,
          title: "Sustainable growth",
          status: "Active" as const,
        },
      ],
    };
    const third = await importDeclaredInitiativeSnapshot({
      repository,
      workspaceId,
      expectedWorkspaceKey: "launchpad",
      snapshot: changed,
      importedAt: "2026-08-07T08:01:00.000Z",
    });
    const nodes = await repository.listWorkspaceIntent(workspaceId);

    expect(first).toMatchObject({ goals: 1, initiatives: 1, upserted: 2, archived: 0 });
    expect(second).toMatchObject({ unchanged: 2, upserted: 0, archived: 0 });
    expect(third).toMatchObject({ upserted: 1, archived: 1 });
    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Sustainable growth", state: "active" }),
        expect.objectContaining({ title: "Partner intake dashboard", state: "archived" }),
      ]),
    );
    database.close();
  });

  it("rejects a snapshot for a different selected workspace", async () => {
    const database = openStrategyKernelSqliteDatabase();
    applyStrategyKernelSqliteMigrations(database);
    const repository = createSqliteStrategyKernelRepository(database);

    await expect(
      importDeclaredInitiativeSnapshot({
        repository,
        workspaceId,
        expectedWorkspaceKey: "another-workspace",
        snapshot: snapshot("revision-1"),
        importedAt: "2026-07-31T08:01:00.000Z",
      }),
    ).rejects.toThrow("does not match selected workspace");
    database.close();
  });
});

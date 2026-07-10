import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runReleaseCli } from "../src/cli/release.ts";
import {
  applyStrategyKernelSqliteMigrations,
  createSqliteStrategyKernelRepository,
  openStrategyKernelSqliteDatabase,
  readEvidenceImportWatermark,
} from "../src/infrastructure/sqlite/index.ts";
import {
  actorIdForWorkspacePackActor,
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
        args: [
          "workspace",
          "reconcile",
          "--pack",
          launchpadPackDirectory,
          "--db",
          databasePath,
          "--workspace",
          "launchpad",
        ],
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
        args: ["workspace", "reconcile", "--db", databasePath, "--workspace", "launchpad"],
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
        args: [
          "workspace",
          "reconcile",
          "--pack",
          launchpadPackDirectory,
          "--db",
          databasePath,
          "--workspace",
          "launchpad",
        ],
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
        args: [
          "workspace",
          "reconcile",
          "--pack",
          launchpadPackDirectory,
          "--db",
          databasePath,
          "--workspace",
          "launchpad",
        ],
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

  it("imports local evidence exports idempotently and stores a safe watermark", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "sarathi-evidence-import-"));
    const databasePath = join(temporaryDirectory, "runtime.sqlite");
    const sourcePath = join(temporaryDirectory, "evidence.jsonl");

    try {
      await runReleaseCli({
        args: [
          "workspace",
          "reconcile",
          "--pack",
          launchpadPackDirectory,
          "--db",
          databasePath,
          "--workspace",
          "launchpad",
        ],
        env: {},
        fetcher: async () => {
          throw new Error("unexpected fetch");
        },
      });
      writeFileSync(
        sourcePath,
        [
          JSON.stringify({
            sourceSystem: "jira",
            sourceType: "issue",
            externalId: "LPAD-101",
            occurredAt: "2026-07-08T12:00:00.000Z",
            title: "Synthetic launch issue",
            bodyExcerpt: "Implementation work exists for launch readiness.",
            sensitivity: "internal",
          }),
          JSON.stringify({
            sourceSystem: "pulse",
            sourceType: "event",
            externalId: "pulse-101",
            occurredAt: "2026-07-08T13:00:00.000Z",
            title: "Synthetic pulse signal",
            bodyExcerpt: "Pulse export says QA evidence is missing.",
            sensitivity: "internal",
          }),
        ].join("\n"),
      );

      const first = await runReleaseCli({
        args: [
          "evidence",
          "import",
          "--source",
          sourcePath,
          "--db",
          databasePath,
          "--workspace",
          workspaceIdForWorkspacePack("launchpad"),
          "--source-key",
          "synthetic-export",
        ],
        env: {},
        fetcher: async () => {
          throw new Error("unexpected fetch");
        },
      });
      const second = await runReleaseCli({
        args: [
          "evidence",
          "import",
          "--source",
          sourcePath,
          "--db",
          databasePath,
          "--workspace",
          workspaceIdForWorkspacePack("launchpad"),
          "--source-key",
          "synthetic-export",
        ],
        env: {},
        fetcher: async () => {
          throw new Error("unexpected fetch");
        },
      });
      const outputText = JSON.stringify(first.output);
      const database = openStrategyKernelSqliteDatabase(databasePath);
      const repository = createSqliteStrategyKernelRepository(database);
      const evidence = await repository.listWorkspaceEvidence(
        workspaceIdForWorkspacePack("launchpad"),
      );
      const watermark = readEvidenceImportWatermark(
        database,
        workspaceIdForWorkspacePack("launchpad"),
        "synthetic-export",
      );

      database.close();

      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(first.output).toMatchObject({
        ok: true,
        mode: "file-backed",
        source: "local-evidence-export",
        imported: {
          recordsRead: 2,
          evidenceItemsSaved: 2,
        },
        watermark: {
          updated: true,
          records: 2,
          cursorStored: true,
        },
      });
      expect(outputText).not.toContain(sourcePath);
      expect(outputText).not.toContain("LPAD-101");
      expect(outputText).not.toContain("pulse-101");
      expect(evidence).toHaveLength(2);
      expect(watermark).toMatchObject({
        workspaceId: workspaceIdForWorkspacePack("launchpad"),
        sourceKey: "synthetic-export",
        recordCount: 2,
        lastCursor: "2026-07-08T13:00:00.000Z",
      });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("writes a file-backed drift review without leaking restricted evidence into internal output", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "sarathi-drift-report-"));
    const databasePath = join(temporaryDirectory, "runtime.sqlite");
    const sourcePath = join(temporaryDirectory, "evidence.json");
    const reportPath = join(temporaryDirectory, "drift-review.md");
    const workspaceId = workspaceIdForWorkspacePack("launchpad");

    try {
      await runReleaseCli({
        args: [
          "workspace",
          "reconcile",
          "--pack",
          launchpadPackDirectory,
          "--db",
          databasePath,
          "--workspace",
          "launchpad",
        ],
        env: {},
        fetcher: async () => {
          throw new Error("unexpected fetch");
        },
      });
      writeFileSync(
        sourcePath,
        JSON.stringify({
          records: [
            {
              sourceSystem: "github",
              sourceType: "pull_request",
              externalId: "synthetic-pr-7",
              occurredAt: "2026-07-08T14:00:00.000Z",
              title: "Synthetic delivery pull request",
              bodyExcerpt: "Implementation work is visible but not linked to a goal.",
              sensitivity: "internal",
            },
            {
              sourceSystem: "teams",
              sourceType: "message",
              externalId: "restricted-message-1",
              occurredAt: "2026-07-08T15:00:00.000Z",
              title: "Restricted leadership escalation",
              bodyExcerpt: "Restricted leadership evidence must stay out of team reports.",
              sensitivity: "restricted",
            },
          ],
        }),
      );
      await runReleaseCli({
        args: [
          "evidence",
          "import",
          "--source",
          sourcePath,
          "--db",
          databasePath,
          "--workspace",
          workspaceId,
          "--source-key",
          "synthetic-report-export",
        ],
        env: {},
        fetcher: async () => {
          throw new Error("unexpected fetch");
        },
      });

      const database = openStrategyKernelSqliteDatabase(databasePath);
      applyStrategyKernelSqliteMigrations(database);
      const repository = createSqliteStrategyKernelRepository(database);
      const staleCommitmentId = "intent-overdue-synthetic";

      await repository.saveIntentNode({
        id: staleCommitmentId,
        workspaceId,
        kind: "commitment",
        title: "Overdue synthetic QA commitment",
        body: "Synthetic commitment should be stale until evidence is attached.",
        state: "active",
        dueAt: "2026-07-01T12:00:00.000Z",
        sensitivity: "internal",
        createdBy: "human",
        createdAt: "2026-07-01T12:00:00.000Z",
        updatedAt: "2026-07-01T12:00:00.000Z",
      });
      await repository.saveAccountabilityAction({
        id: "action-overdue-synthetic",
        workspaceId,
        intentNodeId: staleCommitmentId,
        actorId: actorIdForWorkspacePackActor("delivery-lead"),
        channel: "teams_channel",
        state: "pending",
        dueAt: "2026-07-02T12:00:00.000Z",
        escalationLevel: 0,
        evidenceRequired: true,
        sensitivity: "internal",
      });
      await repository.saveDriftFinding({
        id: "drift-restricted-leadership",
        workspaceId,
        findingType: "visibility_violation",
        title: "Restricted leadership finding",
        body: "Restricted leadership body must not appear in internal output.",
        state: "open",
        sensitivity: "restricted",
        createdAt: "2026-07-08T16:00:00.000Z",
      });
      database.close();

      const result = await runReleaseCli({
        args: [
          "report",
          "drift-review",
          "--db",
          databasePath,
          "--workspace",
          workspaceId,
          "--out",
          reportPath,
          "--format",
          "markdown",
          "--max-sensitivity",
          "internal",
        ],
        env: {},
        fetcher: async () => {
          throw new Error("unexpected fetch");
        },
      });
      const resultText = JSON.stringify(result.output);
      const report = readFileSync(reportPath, "utf8");

      expect(result.exitCode).toBe(0);
      expect(result.output).toMatchObject({
        ok: true,
        mode: "file-backed",
        report: {
          kind: "weekly_drift_review",
          written: true,
        },
      });
      expect(resultText).not.toContain(reportPath);
      expect(resultText).not.toContain("Restricted leadership");
      expect(report).toContain("Goal has no linked work");
      expect(report).toContain("Work evidence is not linked to intent");
      expect(report).toContain("Commitment is stale");
      expect(report).toContain("Required evidence is missing");
      expect(report).toContain("Synthetic delivery pull request");
      expect(report).not.toContain("Restricted leadership");
      expect(report).not.toContain("restricted-message-1");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

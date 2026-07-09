import { describe, expect, it } from "vitest";
import {
  deriveAccountabilitySensitivity,
  deriveClaimFromEvidence,
  deriveProjectionSensitivity,
  type EvidenceItem,
  type IntentNode,
  inheritMostRestrictiveSensitivity,
  type StrategyKernelMigration,
  type StrategyKernelRepository,
  strategyKernelMigrations,
  strategyKernelTableNames,
  type WorkspacePackManifest,
  type WorkspacePackReconciliationDecision,
  type WorkspacePackReconciliationRule,
  type WorkspacePackRelation,
  type WorkspacePackSeedIntent,
  workspacePackReconciliationRules,
} from "../src/modules/strategy-kernel/index.ts";

const occurredAt = "2026-07-09T00:00:00.000Z";

const evidence = (sensitivity: EvidenceItem["sensitivity"]): EvidenceItem => ({
  id: `evidence-${sensitivity}`,
  workspaceId: "workspace-launchpad",
  sourceSystem: "teams",
  sourceType: "message",
  externalId: `message-${sensitivity}`,
  actorId: "actor-delivery-lead",
  occurredAt,
  title: "Launch readiness note",
  bodyExcerpt: "Synthetic launch project update.",
  contentHash: `sha256-${sensitivity}`,
  sensitivity,
  ingestedAt: occurredAt,
});

const intent: IntentNode = {
  id: "intent-launch-goal",
  workspaceId: "workspace-launchpad",
  kind: "goal",
  title: "Launch the synthetic workspace",
  body: "Ship the launchpad without private data.",
  state: "active",
  sensitivity: "internal",
  createdBy: "human",
  createdAt: occurredAt,
  updatedAt: occurredAt,
};

describe("strategy kernel", () => {
  it("inherits the most restrictive sensitivity for derived artifacts", () => {
    expect(inheritMostRestrictiveSensitivity(["public", "internal", "restricted"])).toBe(
      "restricted",
    );

    const claim = deriveClaimFromEvidence(
      {
        id: "claim-1",
        evidenceItemId: "evidence-restricted",
        workspaceId: "workspace-launchpad",
        claimType: "possible_commitment",
        text: "Owner committed to QA evidence.",
        confidence: 0.91,
        state: "pending",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
      evidence("restricted"),
    );

    expect(claim.sensitivity).toBe("restricted");
  });

  it("derives projection and accountability sensitivity from intent plus evidence", () => {
    const relatedEvidence = [evidence("public"), evidence("confidential")];

    expect(deriveProjectionSensitivity(intent, relatedEvidence)).toBe("confidential");
    expect(deriveAccountabilitySensitivity(intent, relatedEvidence)).toBe("confidential");
  });

  it("declares portable migrations for every strategy kernel table", () => {
    const firstMigration: StrategyKernelMigration = strategyKernelMigrations[0];
    const migrationSql = strategyKernelMigrations.flatMap((migration) => migration.sql).join("\n");

    expect(firstMigration.id).toBe("001_strategy_kernel");

    for (const tableName of strategyKernelTableNames) {
      expect(migrationSql).toContain(`create table if not exists ${tableName}`);
    }
  });

  it("keeps workspace packs reconciliation-oriented instead of overwrite-oriented", () => {
    const firstRule: WorkspacePackReconciliationRule = workspacePackReconciliationRules[0];
    const firstDecision: WorkspacePackReconciliationDecision = firstRule.decision;
    const decisions = workspacePackReconciliationRules.map((rule) => rule.decision);

    expect(firstDecision).toBe("create_missing_config");
    expect(decisions).toContain("create_missing_config");
    expect(decisions).toContain("propose_seed_intent");
    expect(decisions).toContain("tighten_policy");
    expect(decisions).toContain("create_drift_review");
    expect(decisions).not.toContain("blind_overwrite");
  });

  it("models workspaces as isolated by default with optional typed relations", () => {
    const relation: WorkspacePackRelation = {
      targetWorkspaceKey: "portfolio-review",
      relationType: "synthesizes_into",
      description: "Only approved summary fields graduate to the portfolio workspace.",
    };
    const seed: WorkspacePackSeedIntent = {
      key: "launch-readiness",
      kind: "goal",
      title: "Reach launch readiness",
      body: "The synthetic workspace should reach launch readiness with evidence.",
      sensitivity: "internal",
    };
    const pack: WorkspacePackManifest = {
      version: 1,
      workspace: {
        key: "launchpad",
        name: "Launchpad Delivery",
        kind: "project",
        defaultSensitivity: "internal",
        relations: [relation],
      },
      actors: [
        {
          key: "delivery-lead",
          displayName: "Delivery Lead",
          role: "delivery_manager",
          canRatifyIntent: true,
          canApproveSensitivityDowngrade: false,
        },
      ],
      mappings: [
        {
          system: "teams",
          resourceType: "channel",
          externalId: "synthetic-launchpad-delivery",
          purpose: "conversation",
          sensitivity: "internal",
        },
      ],
      policies: {
        accountability: {
          defaultChannel: "teams_channel",
          silenceAfterHours: 24,
          escalationAfterHours: 48,
          evidenceRequiredForDone: true,
        },
        visibility: {
          defaultSensitivity: "internal",
          allowSensitivityDowngradeOnlyWithApproval: true,
        },
        deployReadiness: {
          requireIssueKey: true,
          requireQaEvidence: true,
          requireRollbackOwner: true,
        },
        qaEvidence: {
          acceptedEvidenceSystems: ["github", "jira", "vault"],
        },
      },
      seeds: {
        goals: [seed],
        commitments: [],
        bets: [],
      },
      templates: [
        {
          name: "daily-delivery-brief",
          path: "templates/daily-delivery-brief.md",
          sensitivity: "internal",
        },
      ],
    };

    expect(relation.relationType).toBe("synthesizes_into");
    expect(seed.kind).toBe("goal");
    expect(pack.policies.visibility.allowSensitivityDowngradeOnlyWithApproval).toBe(true);
  });

  it("exposes repository ports for persistence adapters", () => {
    const repositoryMethod: keyof StrategyKernelRepository = "saveKernelEvent";

    expect(repositoryMethod).toBe("saveKernelEvent");
  });
});

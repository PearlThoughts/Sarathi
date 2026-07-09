import { describe, expect, it } from "vitest";
import {
  loadWorkspacePack,
  loadWorkspacePackFromYamlFiles,
  type RuntimeIntentSnapshot,
  type RuntimeIntentState,
  type RuntimePolicySnapshot,
  reconcileWorkspacePack,
  type WorkspacePackDecisionTarget,
  type WorkspacePackLoadInput,
  type WorkspacePackReconciliationItem,
  type WorkspacePackRuntimeSnapshot,
  type WorkspacePackSourceFile,
} from "../src/modules/workspace-packs/index.ts";

const launchpadFiles: readonly WorkspacePackSourceFile[] = [
  {
    path: "workspace.yaml",
    contents: `version: 1
workspace:
  key: launchpad
  name: Launchpad Delivery
  kind: project
  defaultSensitivity: internal
  relations:
    - targetWorkspaceKey: portfolio-review
      relationType: synthesizes_into
      description: Approved summary fields roll up without raw evidence leakage.
`,
  },
  {
    path: "actors.yaml",
    contents: `actors:
  - key: delivery-lead
    displayName: Delivery Lead
    role: delivery_manager
    canRatifyIntent: true
    canApproveSensitivityDowngrade: false
  - key: technical-lead
    displayName: Technical Lead
    role: technical_lead
    canRatifyIntent: true
    canApproveSensitivityDowngrade: false
`,
  },
  {
    path: "mappings/jira.yaml",
    contents: `mappings:
  - system: jira
    resourceType: project
    externalId: LPAD
    purpose: execution
    sensitivity: internal
`,
  },
  {
    path: "mappings/github.yaml",
    contents: `mappings:
  - system: github
    resourceType: repository
    externalId: example/launchpad-service
    purpose: evidence
    sensitivity: internal
`,
  },
  {
    path: "mappings/teams.yaml",
    contents: `mappings:
  - system: teams
    resourceType: channel
    externalId: synthetic-launchpad-delivery
    purpose: conversation
    sensitivity: internal
`,
  },
  {
    path: "mappings/vault.yaml",
    contents: `mappings:
  - system: vault
    resourceType: folder
    externalId: Synthetic/Launchpad
    purpose: governance
    sensitivity: internal
`,
  },
  {
    path: "policies/accountability.yaml",
    contents: `accountability:
  defaultChannel: teams_channel
  silenceAfterHours: 24
  escalationAfterHours: 48
  evidenceRequiredForDone: true
`,
  },
  {
    path: "policies/visibility.yaml",
    contents: `visibility:
  defaultSensitivity: internal
  allowSensitivityDowngradeOnlyWithApproval: true
`,
  },
  {
    path: "policies/deploy-readiness.yaml",
    contents: `deployReadiness:
  requireIssueKey: true
  requireQaEvidence: true
  requireRollbackOwner: true
`,
  },
  {
    path: "policies/qa-evidence.yaml",
    contents: `qaEvidence:
  acceptedEvidenceSystems:
    - github
    - jira
    - vault
`,
  },
  {
    path: "seeds/goals.yaml",
    contents: `goals:
  - key: launch-readiness
    kind: goal
    title: Reach launch readiness
    body: The synthetic workspace should reach launch readiness with evidence and no private data.
    sensitivity: internal
`,
  },
  {
    path: "seeds/commitments.yaml",
    contents: `commitments:
  - key: qa-evidence
    kind: commitment
    title: Attach QA evidence before done
    body: Completion requires linked QA evidence from an accepted source system.
    sensitivity: internal
`,
  },
  {
    path: "seeds/bets.yaml",
    contents: `bets:
  - key: controlled-rollup
    kind: bet
    title: Controlled workspace rollup
    body: Approved summary fields can roll up to a portfolio workspace without exposing raw evidence.
    sensitivity: internal
`,
  },
  {
    path: "templates/daily-delivery-brief.md",
    contents: "# Daily Delivery Brief\n",
  },
  {
    path: "templates/drift-review.md",
    contents: "# Drift Review\n",
  },
  {
    path: "templates/client-update.md",
    contents: "# Client Update\n",
  },
];

const requireValue = <Value>(value: Value | undefined, message: string): Value => {
  if (value === undefined) {
    throw new Error(message);
  }

  return value;
};

describe("workspace packs", () => {
  it("loads the launchpad pack from YAML content fragments", () => {
    const pack = loadWorkspacePack(launchpadFiles);
    const directPack = loadWorkspacePackFromYamlFiles(launchpadFiles);
    const loadInput: WorkspacePackLoadInput = launchpadFiles;
    const runtimeState: RuntimeIntentState = "candidate";
    const runtimeIntents: readonly RuntimeIntentSnapshot[] = [
      ...pack.seeds.goals,
      ...pack.seeds.commitments,
      ...pack.seeds.bets,
    ].map((seed) => ({
      ...seed,
      state: runtimeState,
    }));
    const runtimePolicies: RuntimePolicySnapshot = pack.policies;
    const target: WorkspacePackDecisionTarget = "seed_intent";
    const runtime: WorkspacePackRuntimeSnapshot = {
      workspaceKey: "launchpad",
      actorKeys: pack.actors.map((actor) => actor.key),
      mappings: pack.mappings,
      policies: runtimePolicies,
      intents: runtimeIntents,
      templatePaths: pack.templates.map((template) => template.path),
    };

    expect(loadWorkspacePack(loadInput)).toEqual(directPack);
    expect(target).toBe("seed_intent");
    expect(reconcileWorkspacePack(pack, runtime)).toEqual([]);
    expect(pack).toMatchObject({
      version: 1,
      workspace: {
        key: "launchpad",
        name: "Launchpad Delivery",
        kind: "project",
        defaultSensitivity: "internal",
      },
      policies: {
        accountability: {
          evidenceRequiredForDone: true,
        },
        visibility: {
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
    });
    expect(pack.actors.map((actor) => actor.key)).toEqual(["delivery-lead", "technical-lead"]);
    expect(pack.mappings).toHaveLength(4);
    expect(pack.seeds.goals).toHaveLength(1);
    expect(pack.seeds.commitments).toHaveLength(1);
    expect(pack.seeds.bets).toHaveLength(1);
    expect(pack.templates.map((template) => template.name).sort()).toEqual([
      "client-update",
      "daily-delivery-brief",
      "drift-review",
    ]);
  });

  it("proposes missing config and seed intents without overwriting runtime state", () => {
    const pack = loadWorkspacePack(launchpadFiles);
    const decisions: readonly WorkspacePackReconciliationItem[] = reconcileWorkspacePack(pack, {
      workspaceKey: "launchpad",
      actorKeys: ["delivery-lead"],
      mappings: [requireValue(pack.mappings[0], "Expected launchpad pack to include mappings.")],
      policies: pack.policies,
      intents: [],
      templatePaths: ["templates/daily-delivery-brief.md"],
    });

    expect(decisions).toContainEqual(
      expect.objectContaining({
        decision: "create_missing_config",
        target: "actor",
        key: "technical-lead",
      }),
    );
    expect(decisions).toContainEqual(
      expect.objectContaining({
        decision: "create_missing_config",
        target: "mapping",
        key: "github:repository:example/launchpad-service:evidence",
      }),
    );
    expect(decisions).toContainEqual(
      expect.objectContaining({
        decision: "propose_seed_intent",
        target: "seed_intent",
        key: "launch-readiness",
      }),
    );
    expect(decisions.map((decision) => decision.decision)).not.toContain("no_change");
  });

  it("distinguishes stricter pack policies from drift that would weaken runtime policy", () => {
    const pack = loadWorkspacePack(launchpadFiles);
    const decisions = reconcileWorkspacePack(pack, {
      workspaceKey: "launchpad",
      actorKeys: pack.actors.map((actor) => actor.key),
      mappings: pack.mappings,
      policies: {
        accountability: {
          defaultChannel: "teams_channel",
          silenceAfterHours: 72,
          escalationAfterHours: 12,
          evidenceRequiredForDone: false,
        },
        visibility: {
          defaultSensitivity: "public",
          allowSensitivityDowngradeOnlyWithApproval: false,
        },
        deployReadiness: {
          requireIssueKey: false,
          requireQaEvidence: false,
          requireRollbackOwner: false,
        },
        qaEvidence: {
          acceptedEvidenceSystems: ["github", "jira", "vault", "manual"],
        },
      },
      intents: [
        {
          ...requireValue(pack.seeds.goals[0], "Expected launchpad pack to include a goal seed."),
          title: "Human-edited launch goal",
          state: "human_edited",
        },
      ],
      templatePaths: pack.templates.map((template) => template.path),
    });

    expect(decisions).toContainEqual(
      expect.objectContaining({
        decision: "tighten_policy",
        target: "policy",
        key: "visibility.defaultSensitivity",
      }),
    );
    expect(decisions).toContainEqual(
      expect.objectContaining({
        decision: "tighten_policy",
        target: "policy",
        key: "accountability.evidenceRequiredForDone",
      }),
    );
    expect(decisions).toContainEqual(
      expect.objectContaining({
        decision: "create_drift_review",
        target: "policy",
        key: "accountability.escalationAfterHours",
      }),
    );
    expect(decisions).toContainEqual(
      expect.objectContaining({
        decision: "create_drift_review",
        target: "seed_intent",
        key: "launch-readiness",
      }),
    );
  });

  it("accepts already structured pack objects", () => {
    const pack = loadWorkspacePack(launchpadFiles);

    expect(loadWorkspacePack(pack)).toEqual(pack);
  });

  it("fails loudly for malformed YAML and wrong-shaped fragments", () => {
    expect(() =>
      loadWorkspacePack([
        {
          path: "workspace.yaml",
          contents: "version: [",
        },
      ]),
    ).toThrow(/workspace\.yaml could not be parsed as YAML/);

    expect(() =>
      loadWorkspacePack([
        ...launchpadFiles.filter((file) => file.path !== "actors.yaml"),
        {
          path: "actors.yaml",
          contents: "actors: delivery-lead",
        },
      ]),
    ).toThrow(/workspace pack YAML fragments\.actors to be an array/);
  });

  it("fails loudly for unsupported template filenames", () => {
    expect(() =>
      loadWorkspacePack([
        ...launchpadFiles,
        {
          path: "templates/weekly-summary.md",
          contents: "# Weekly Summary\n",
        },
      ]),
    ).toThrow(/templates\/weekly-summary\.md has an unsupported name/);
  });
});

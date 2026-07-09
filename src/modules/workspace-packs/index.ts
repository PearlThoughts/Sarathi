import { parse as parseYaml } from "yaml";
import type {
  Actor,
  DriftFinding,
  ExternalResourceMapping,
  ExternalSystem,
  IntentNode,
  IntentNodeState,
  Organization,
  Workspace,
  WorkspaceActorRole,
  WorkspacePackManifest,
  WorkspacePackMapping,
  WorkspacePackPolicies,
  WorkspacePackReconciliationDecision,
  WorkspacePackSeedIntent,
  WorkspacePackTemplate,
} from "../strategy-kernel/index.ts";

export type WorkspacePackSourceFile = {
  readonly path: string;
  readonly contents: string;
};

export type WorkspacePackLoadInput = WorkspacePackManifest | readonly WorkspacePackSourceFile[];

export type RuntimePolicySnapshot = Partial<WorkspacePackPolicies>;

export type RuntimeIntentState = IntentNodeState | "done" | "human_edited";

export type RuntimeIntentSnapshot = WorkspacePackSeedIntent & {
  readonly state: RuntimeIntentState;
};

export type WorkspacePackRuntimeSnapshot = {
  readonly workspaceKey?: string | undefined;
  readonly actorKeys?: readonly string[] | undefined;
  readonly mappings?: readonly WorkspacePackMapping[] | undefined;
  readonly policies?: RuntimePolicySnapshot | undefined;
  readonly intents?: readonly RuntimeIntentSnapshot[] | undefined;
  readonly templatePaths?: readonly string[] | undefined;
};

export type WorkspacePackDecisionTarget =
  | "workspace"
  | "actor"
  | "mapping"
  | "policy"
  | "seed_intent"
  | "template";

export type WorkspacePackReconciliationItem = {
  readonly decision: Exclude<WorkspacePackReconciliationDecision, "no_change">;
  readonly target: WorkspacePackDecisionTarget;
  readonly key: string;
  readonly reason: string;
};

export type WorkspacePackPolicyRecord = {
  readonly id: string;
  readonly workspaceId: string;
  readonly policyKey: keyof WorkspacePackPolicies;
  readonly payloadJson: string;
  readonly updatedAt: string;
};

export type WorkspacePackTemplateRecord = {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: WorkspacePackTemplate["name"];
  readonly path: string;
  readonly sensitivity: WorkspacePackTemplate["sensitivity"];
  readonly updatedAt: string;
};

type WorkspacePackPersistencePlan = {
  readonly organization: Organization;
  readonly workspace?: Workspace | undefined;
  readonly actors: readonly Actor[];
  readonly workspaceActorRoles: readonly WorkspaceActorRole[];
  readonly externalSystems: readonly ExternalSystem[];
  readonly externalResourceMappings: readonly ExternalResourceMapping[];
  readonly seedIntents: readonly IntentNode[];
  readonly driftFindings: readonly DriftFinding[];
  readonly policies: readonly WorkspacePackPolicyRecord[];
  readonly templates: readonly WorkspacePackTemplateRecord[];
};

type WorkspacePackPersistencePlanInput = {
  readonly pack: WorkspacePackManifest;
  readonly decisions: readonly WorkspacePackReconciliationItem[];
  readonly organizationId: string;
  readonly organizationName: string;
  readonly occurredAt: string;
};

type MutablePackFragments = {
  version?: number | undefined;
  workspace?: unknown;
  actors: unknown[];
  mappings: unknown[];
  policies: Partial<Record<keyof WorkspacePackPolicies, unknown>>;
  seeds: Partial<Record<keyof WorkspacePackManifest["seeds"], unknown>>;
  templates: unknown[];
};

const sensitivityRank = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
} as const;

const requiredPolicyKeys = [
  "accountability",
  "visibility",
  "deployReadiness",
  "qaEvidence",
] as const satisfies readonly (keyof WorkspacePackPolicies)[];

export const loadWorkspacePack = (input: WorkspacePackLoadInput): WorkspacePackManifest => {
  if (Array.isArray(input)) {
    return loadWorkspacePackFromYamlFiles(input);
  }

  return assertWorkspacePackManifest(input, "structured workspace pack");
};

export const loadWorkspacePackFromYamlFiles = (
  files: readonly WorkspacePackSourceFile[],
): WorkspacePackManifest => {
  const fragments: MutablePackFragments = {
    actors: [],
    mappings: [],
    policies: {},
    seeds: {},
    templates: [],
  };

  for (const file of files) {
    if (file.path.endsWith(".md")) {
      continue;
    }

    const parsed = parseWorkspacePackYaml(file);

    mergeOptionalTopLevel(fragments, parsed, "version");
    mergeOptionalTopLevel(fragments, parsed, "workspace");
    mergeArrayFragment(fragments.actors, parsed, "actors", file.path);
    mergeArrayFragment(fragments.templates, parsed, "templates", file.path);
    mergeArrayFragment(fragments.mappings, parsed, "mappings", file.path);
    mergeRecordFragment(fragments.policies, parsed, requiredPolicyKeys, file.path);
    mergeRecordFragment(fragments.seeds, parsed, ["goals", "commitments", "bets"], file.path);
  }

  return assertWorkspacePackManifest(
    {
      version: fragments.version,
      workspace: fragments.workspace,
      actors: fragments.actors.flat(),
      mappings: fragments.mappings.flat(),
      policies: fragments.policies,
      seeds: {
        goals: fragments.seeds.goals ?? [],
        commitments: fragments.seeds.commitments ?? [],
        bets: fragments.seeds.bets ?? [],
      },
      templates:
        fragments.templates.length === 0 ? inferTemplates(files) : fragments.templates.flat(),
    },
    "workspace pack YAML fragments",
  );
};

export const reconcileWorkspacePack = (
  pack: WorkspacePackManifest,
  runtime: WorkspacePackRuntimeSnapshot,
): readonly WorkspacePackReconciliationItem[] => [
  ...missingConfigDecisions(pack, runtime),
  ...seedIntentDecisions(pack, runtime),
  ...policyDecisions(pack, runtime),
];

export const buildWorkspacePackPersistencePlan = ({
  pack,
  decisions,
  organizationId,
  organizationName,
  occurredAt,
}: WorkspacePackPersistencePlanInput): WorkspacePackPersistencePlan => {
  const workspaceId = workspaceIdForWorkspacePack(pack.workspace.key);
  const decisionTargets = new Set(decisions.map(decisionKey));
  const shouldCreateWorkspace = decisions.some(
    (decision) => decision.target === "workspace" && decision.decision === "create_missing_config",
  );
  const policyKeys = policyKeysToPersist(decisions);

  return {
    organization: {
      id: organizationId,
      name: organizationName,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    workspace: shouldCreateWorkspace
      ? {
          id: workspaceId,
          organizationId,
          key: pack.workspace.key,
          name: pack.workspace.name,
          kind: pack.workspace.kind,
          defaultSensitivity: pack.workspace.defaultSensitivity,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        }
      : undefined,
    actors: pack.actors
      .filter((actor) => decisionTargets.has(`actor:${actor.key}`))
      .map((actor) => ({
        id: actorIdForWorkspacePackActor(actor.key),
        organizationId,
        kind: actor.role === "stakeholder" ? "external_stakeholder" : "person",
        displayName: actor.displayName,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      })),
    workspaceActorRoles: pack.actors
      .filter((actor) => decisionTargets.has(`actor:${actor.key}`))
      .map((actor) => ({
        id: workspaceActorRoleIdForWorkspacePackActor(pack.workspace.key, actor.key, actor.role),
        workspaceId,
        actorId: actorIdForWorkspacePackActor(actor.key),
        role: actor.role,
        canRatifyIntent: actor.canRatifyIntent,
        canApproveSensitivityDowngrade: actor.canApproveSensitivityDowngrade,
        createdAt: occurredAt,
      })),
    externalSystems: uniqueExternalSystems(
      pack.mappings.filter((mapping) => decisionTargets.has(`mapping:${mappingKey(mapping)}`)),
      organizationId,
      occurredAt,
    ),
    externalResourceMappings: pack.mappings
      .filter((mapping) => decisionTargets.has(`mapping:${mappingKey(mapping)}`))
      .map((mapping) => ({
        id: externalResourceMappingIdForWorkspacePackMapping(pack.workspace.key, mapping),
        workspaceId,
        externalSystemId: externalSystemIdForWorkspacePackMapping(mapping.system),
        resourceType: mapping.resourceType as ExternalResourceMapping["resourceType"],
        externalId: mapping.externalId,
        purpose: mapping.purpose,
        sensitivity: mapping.sensitivity,
        createdAt: occurredAt,
      })),
    seedIntents: allSeeds(pack)
      .filter((seed) => decisionTargets.has(`seed_intent:${seed.key}:propose_seed_intent`))
      .map((seed) => ({
        id: seedIntentIdForWorkspacePackSeed(pack.workspace.key, seed.key),
        workspaceId,
        kind: seed.kind,
        title: seed.title,
        body: seed.body,
        state: "candidate",
        sensitivity: seed.sensitivity,
        createdBy: "import",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      })),
    driftFindings: decisions
      .filter((decision) => decision.decision === "create_drift_review")
      .map((decision) => ({
        id: driftFindingIdForWorkspacePackDecision(pack.workspace.key, decision),
        workspaceId,
        findingType: "pack_conflict",
        title: `Workspace pack conflict for ${decision.target}`,
        body: decision.reason,
        state: "open",
        ...(decision.target === "seed_intent"
          ? {
              relatedEntityType: "intent_node" as const,
              relatedEntityId: seedIntentIdForWorkspacePackSeed(pack.workspace.key, decision.key),
            }
          : {}),
        sensitivity: pack.workspace.defaultSensitivity,
        createdAt: occurredAt,
      })),
    policies: policyKeys.map((policyKey) => ({
      id: workspacePackPolicyId(workspaceId, policyKey),
      workspaceId,
      policyKey,
      payloadJson: JSON.stringify(pack.policies[policyKey]),
      updatedAt: occurredAt,
    })),
    templates: pack.templates
      .filter((template) => decisionTargets.has(`template:${template.path}`))
      .map((template) => ({
        id: workspacePackTemplateId(workspaceId, template.path),
        workspaceId,
        name: template.name,
        path: template.path,
        sensitivity: template.sensitivity,
        updatedAt: occurredAt,
      })),
  };
};

export const summarizeWorkspacePackPersistencePlan = (
  plan: WorkspacePackPersistencePlan,
): Record<string, number> => ({
  workspaces: plan.workspace === undefined ? 0 : 1,
  actors: plan.actors.length,
  actorRoles: plan.workspaceActorRoles.length,
  externalSystems: plan.externalSystems.length,
  externalResourceMappings: plan.externalResourceMappings.length,
  seedIntents: plan.seedIntents.length,
  driftFindings: plan.driftFindings.length,
  policies: plan.policies.length,
  templates: plan.templates.length,
});

export const summarizeWorkspacePackReconciliation = (
  decisions: readonly WorkspacePackReconciliationItem[],
): readonly { readonly decision: string; readonly target: string; readonly count: number }[] => {
  const counts = new Map<string, number>();

  for (const item of decisions) {
    const key = `${item.decision}:${item.target}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => {
      const [decision, target] = key.split(":");

      return {
        decision: decision ?? "unknown",
        target: target ?? "unknown",
        count,
      };
    });
};

export const workspaceIdForWorkspacePack = (workspaceKey: string): string =>
  `workspace-${stableIdentifier(workspaceKey)}`;

export const actorIdForWorkspacePackActor = (actorKey: string): string =>
  `actor-${stableIdentifier(actorKey)}`;

const workspaceActorRoleIdForWorkspacePackActor = (
  workspaceKey: string,
  actorKey: string,
  role: string,
): string =>
  `role-${stableIdentifier(workspaceKey)}-${stableIdentifier(actorKey)}-${stableIdentifier(role)}`;

const externalSystemIdForWorkspacePackMapping = (system: WorkspacePackMapping["system"]): string =>
  `system-${stableIdentifier(system)}`;

const externalResourceMappingIdForWorkspacePackMapping = (
  workspaceKey: string,
  mapping: WorkspacePackMapping,
): string => `mapping-${stableIdentifier(workspaceKey)}-${stableIdentifier(mappingKey(mapping))}`;

export const seedIntentIdForWorkspacePackSeed = (workspaceKey: string, seedKey: string): string =>
  `intent-seed-${stableIdentifier(workspaceKey)}-${stableIdentifier(seedKey)}`;

const workspacePackPolicyId = (
  workspaceId: string,
  policyKey: keyof WorkspacePackPolicies,
): string => `policy-${stableIdentifier(workspaceId)}-${stableIdentifier(policyKey)}`;

const workspacePackTemplateId = (workspaceId: string, templatePath: string): string =>
  `template-${stableIdentifier(workspaceId)}-${stableIdentifier(templatePath)}`;

const parseWorkspacePackYaml = (file: WorkspacePackSourceFile): Record<string, unknown> => {
  let parsed: unknown;

  try {
    parsed = parseYaml(file.contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Workspace pack file ${file.path} could not be parsed as YAML: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Workspace pack file ${file.path} must contain a YAML object.`);
  }

  return parsed;
};

const mergeOptionalTopLevel = <Key extends keyof MutablePackFragments>(
  fragments: MutablePackFragments,
  parsed: Record<string, unknown>,
  key: Key,
): void => {
  if (parsed[key] !== undefined) {
    if (fragments[key] !== undefined) {
      throw new Error(`Workspace pack file declares duplicate top-level field ${String(key)}.`);
    }

    fragments[key] = parsed[key] as MutablePackFragments[Key];
  }
};

const mergeArrayFragment = (
  target: unknown[],
  parsed: Record<string, unknown>,
  key: string,
  path: string,
): void => {
  const value = parsed[key];

  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Workspace pack file ${path} field ${key} must be an array.`);
  }

  target.push(value);
};

const mergeRecordFragment = <Key extends string>(
  target: Partial<Record<Key, unknown>>,
  parsed: Record<string, unknown>,
  keys: readonly Key[],
  path: string,
): void => {
  for (const key of keys) {
    if (parsed[key] !== undefined) {
      const existing = target[key];

      if (existing !== undefined) {
        if (Array.isArray(existing) && Array.isArray(parsed[key])) {
          target[key] = [...existing, ...parsed[key]];
          continue;
        }

        throw new Error(`Workspace pack file ${path} declares duplicate field ${key}.`);
      }

      target[key] = parsed[key];
    }
  }
};

const inferTemplates = (
  files: readonly WorkspacePackSourceFile[],
): WorkspacePackManifest["templates"] =>
  files
    .filter((file) => file.path.startsWith("templates/") && file.path.endsWith(".md"))
    .map((file) => {
      const name = file.path.slice("templates/".length, -".md".length);

      if (!isWorkspacePackTemplateName(name)) {
        throw new Error(`Workspace pack template ${file.path} has an unsupported name.`);
      }

      return {
        name,
        path: file.path,
        sensitivity: "internal",
      };
    });

const assertWorkspacePackManifest = (value: unknown, source: string): WorkspacePackManifest => {
  if (!isRecord(value)) {
    throw new Error(`Expected ${source} to be an object.`);
  }

  const version = expectLiteral(value.version, 1, `${source}.version`);
  const workspace = expectRecord(value.workspace, `${source}.workspace`);
  const policies = expectRecord(value.policies, `${source}.policies`);
  const seeds = expectRecord(value.seeds, `${source}.seeds`);

  const manifest: WorkspacePackManifest = {
    version,
    workspace: {
      key: expectString(workspace.key, `${source}.workspace.key`),
      name: expectString(workspace.name, `${source}.workspace.name`),
      kind: expectOneOf(
        workspace.kind,
        ["project", "product", "client_account", "initiative", "operating_unit"],
        `${source}.workspace.kind`,
      ),
      defaultSensitivity: expectSensitivity(
        workspace.defaultSensitivity,
        `${source}.workspace.defaultSensitivity`,
      ),
      relations: expectOptionalArray(workspace.relations, `${source}.workspace.relations`).map(
        (relation, index) => {
          const relationRecord = expectRecord(relation, `${source}.workspace.relations[${index}]`);

          return {
            targetWorkspaceKey: expectString(
              relationRecord.targetWorkspaceKey,
              `${source}.workspace.relations[${index}].targetWorkspaceKey`,
            ),
            relationType: expectOneOf(
              relationRecord.relationType,
              ["contains", "depends_on", "peer", "shares_policy", "synthesizes_into"],
              `${source}.workspace.relations[${index}].relationType`,
            ),
            description:
              relationRecord.description === undefined
                ? undefined
                : expectString(
                    relationRecord.description,
                    `${source}.workspace.relations[${index}].description`,
                  ),
          };
        },
      ),
    },
    actors: expectArray(value.actors, `${source}.actors`).map((actor, index) => {
      const actorRecord = expectRecord(actor, `${source}.actors[${index}]`);

      return {
        key: expectString(actorRecord.key, `${source}.actors[${index}].key`),
        displayName: expectString(
          actorRecord.displayName,
          `${source}.actors[${index}].displayName`,
        ),
        role: expectOneOf(
          actorRecord.role,
          [
            "operating_owner",
            "delivery_manager",
            "technical_lead",
            "contributor",
            "stakeholder",
            "sarathi",
          ],
          `${source}.actors[${index}].role`,
        ),
        canRatifyIntent: expectBoolean(
          actorRecord.canRatifyIntent,
          `${source}.actors[${index}].canRatifyIntent`,
        ),
        canApproveSensitivityDowngrade: expectBoolean(
          actorRecord.canApproveSensitivityDowngrade,
          `${source}.actors[${index}].canApproveSensitivityDowngrade`,
        ),
      };
    }),
    mappings: expectArray(value.mappings, `${source}.mappings`).map((mapping, index) => {
      const mappingRecord = expectRecord(mapping, `${source}.mappings[${index}]`);

      return {
        system: expectOneOf(
          mappingRecord.system,
          ["jira", "teams", "github", "vault", "email", "meeting", "manual"],
          `${source}.mappings[${index}].system`,
        ),
        resourceType: expectString(
          mappingRecord.resourceType,
          `${source}.mappings[${index}].resourceType`,
        ),
        externalId: expectString(
          mappingRecord.externalId,
          `${source}.mappings[${index}].externalId`,
        ),
        purpose: expectOneOf(
          mappingRecord.purpose,
          ["conversation", "execution", "evidence", "governance", "projection"],
          `${source}.mappings[${index}].purpose`,
        ),
        sensitivity: expectSensitivity(
          mappingRecord.sensitivity,
          `${source}.mappings[${index}].sensitivity`,
        ),
      };
    }),
    policies: {
      accountability: {
        defaultChannel: expectOneOf(
          expectRecord(policies.accountability, `${source}.policies.accountability`).defaultChannel,
          ["teams_dm", "teams_channel", "email", "manual"],
          `${source}.policies.accountability.defaultChannel`,
        ),
        silenceAfterHours: expectNumber(
          expectRecord(policies.accountability, `${source}.policies.accountability`)
            .silenceAfterHours,
          `${source}.policies.accountability.silenceAfterHours`,
        ),
        escalationAfterHours: expectNumber(
          expectRecord(policies.accountability, `${source}.policies.accountability`)
            .escalationAfterHours,
          `${source}.policies.accountability.escalationAfterHours`,
        ),
        evidenceRequiredForDone: expectBoolean(
          expectRecord(policies.accountability, `${source}.policies.accountability`)
            .evidenceRequiredForDone,
          `${source}.policies.accountability.evidenceRequiredForDone`,
        ),
      },
      visibility: {
        defaultSensitivity: expectSensitivity(
          expectRecord(policies.visibility, `${source}.policies.visibility`).defaultSensitivity,
          `${source}.policies.visibility.defaultSensitivity`,
        ),
        allowSensitivityDowngradeOnlyWithApproval: expectBoolean(
          expectRecord(policies.visibility, `${source}.policies.visibility`)
            .allowSensitivityDowngradeOnlyWithApproval,
          `${source}.policies.visibility.allowSensitivityDowngradeOnlyWithApproval`,
        ),
      },
      deployReadiness: {
        requireIssueKey: expectBoolean(
          expectRecord(policies.deployReadiness, `${source}.policies.deployReadiness`)
            .requireIssueKey,
          `${source}.policies.deployReadiness.requireIssueKey`,
        ),
        requireQaEvidence: expectBoolean(
          expectRecord(policies.deployReadiness, `${source}.policies.deployReadiness`)
            .requireQaEvidence,
          `${source}.policies.deployReadiness.requireQaEvidence`,
        ),
        requireRollbackOwner: expectBoolean(
          expectRecord(policies.deployReadiness, `${source}.policies.deployReadiness`)
            .requireRollbackOwner,
          `${source}.policies.deployReadiness.requireRollbackOwner`,
        ),
      },
      qaEvidence: {
        acceptedEvidenceSystems: expectArray(
          expectRecord(policies.qaEvidence, `${source}.policies.qaEvidence`)
            .acceptedEvidenceSystems,
          `${source}.policies.qaEvidence.acceptedEvidenceSystems`,
        ).map((system, index) =>
          expectOneOf(
            system,
            ["jira", "teams", "github", "vault", "email", "meeting", "manual"],
            `${source}.policies.qaEvidence.acceptedEvidenceSystems[${index}]`,
          ),
        ),
      },
    },
    seeds: {
      goals: expectSeedArray(seeds.goals, `${source}.seeds.goals`),
      commitments: expectSeedArray(seeds.commitments, `${source}.seeds.commitments`),
      bets: expectSeedArray(seeds.bets, `${source}.seeds.bets`),
    },
    templates: expectArray(value.templates, `${source}.templates`).map((template, index) => {
      const templateRecord = expectRecord(template, `${source}.templates[${index}]`);

      return {
        name: expectOneOf(
          templateRecord.name,
          ["daily-delivery-brief", "drift-review", "client-update"],
          `${source}.templates[${index}].name`,
        ),
        path: expectString(templateRecord.path, `${source}.templates[${index}].path`),
        sensitivity: expectSensitivity(
          templateRecord.sensitivity,
          `${source}.templates[${index}].sensitivity`,
        ),
      };
    }),
  };

  return manifest;
};

const expectSeedArray = (value: unknown, path: string): WorkspacePackSeedIntent[] =>
  expectArray(value, path).map((seed, index) => {
    const seedRecord = expectRecord(seed, `${path}[${index}]`);

    return {
      key: expectString(seedRecord.key, `${path}[${index}].key`),
      kind: expectOneOf(
        seedRecord.kind,
        [
          "goal",
          "commitment",
          "bet",
          "decision",
          "assumption",
          "risk",
          "kpi",
          "capacity_reservation",
          "policy",
        ],
        `${path}[${index}].kind`,
      ),
      title: expectString(seedRecord.title, `${path}[${index}].title`),
      body: expectString(seedRecord.body, `${path}[${index}].body`),
      sensitivity: expectSensitivity(seedRecord.sensitivity, `${path}[${index}].sensitivity`),
    };
  });

const missingConfigDecisions = (
  pack: WorkspacePackManifest,
  runtime: WorkspacePackRuntimeSnapshot,
): readonly WorkspacePackReconciliationItem[] => {
  const decisions: WorkspacePackReconciliationItem[] = [];
  const actorKeys = new Set(runtime.actorKeys ?? []);
  const mappingKeys = new Set((runtime.mappings ?? []).map(mappingKey));
  const templatePaths = new Set(runtime.templatePaths ?? []);

  if (runtime.workspaceKey !== pack.workspace.key) {
    decisions.push({
      decision: "create_missing_config",
      target: "workspace",
      key: pack.workspace.key,
      reason: `Workspace ${pack.workspace.key} is not present in runtime configuration.`,
    });
  }

  for (const actor of pack.actors) {
    if (!actorKeys.has(actor.key)) {
      decisions.push({
        decision: "create_missing_config",
        target: "actor",
        key: actor.key,
        reason: `Actor ${actor.key} is declared by the pack but missing at runtime.`,
      });
    }
  }

  for (const mapping of pack.mappings) {
    const key = mappingKey(mapping);

    if (!mappingKeys.has(key)) {
      decisions.push({
        decision: "create_missing_config",
        target: "mapping",
        key,
        reason: `External mapping ${key} is declared by the pack but missing at runtime.`,
      });
    }
  }

  for (const policyKey of requiredPolicyKeys) {
    if (runtime.policies?.[policyKey] === undefined) {
      decisions.push({
        decision: "create_missing_config",
        target: "policy",
        key: policyKey,
        reason: `Policy section ${policyKey} is declared by the pack but missing at runtime.`,
      });
    }
  }

  for (const template of pack.templates) {
    if (!templatePaths.has(template.path)) {
      decisions.push({
        decision: "create_missing_config",
        target: "template",
        key: template.path,
        reason: `Template ${template.path} is declared by the pack but missing at runtime.`,
      });
    }
  }

  return decisions;
};

const seedIntentDecisions = (
  pack: WorkspacePackManifest,
  runtime: WorkspacePackRuntimeSnapshot,
): readonly WorkspacePackReconciliationItem[] => {
  const runtimeIntents = new Map((runtime.intents ?? []).map((intent) => [intent.key, intent]));
  const decisions: WorkspacePackReconciliationItem[] = [];

  for (const seed of allSeeds(pack)) {
    const existingIntent = runtimeIntents.get(seed.key);

    if (existingIntent === undefined) {
      decisions.push({
        decision: "propose_seed_intent",
        target: "seed_intent",
        key: seed.key,
        reason: `Seed intent ${seed.key} should enter the inferred intent inbox for ratification.`,
      });
      continue;
    }

    if (intentDrifted(seed, existingIntent) && existingIntent.state !== "candidate") {
      decisions.push({
        decision: "create_drift_review",
        target: "seed_intent",
        key: seed.key,
        reason: `Seed intent ${seed.key} conflicts with ${existingIntent.state} runtime intent.`,
      });
    }
  }

  return decisions;
};

const policyDecisions = (
  pack: WorkspacePackManifest,
  runtime: WorkspacePackRuntimeSnapshot,
): readonly WorkspacePackReconciliationItem[] => {
  const current = runtime.policies;

  if (current === undefined) {
    return [];
  }

  return [
    ...compareSensitivityPolicy(
      "workspace.defaultSensitivity",
      pack.workspace.defaultSensitivity,
      current.visibility?.defaultSensitivity,
    ),
    ...compareSensitivityPolicy(
      "visibility.defaultSensitivity",
      pack.policies.visibility.defaultSensitivity,
      current.visibility?.defaultSensitivity,
    ),
    ...compareBooleanTightening(
      "visibility.allowSensitivityDowngradeOnlyWithApproval",
      pack.policies.visibility.allowSensitivityDowngradeOnlyWithApproval,
      current.visibility?.allowSensitivityDowngradeOnlyWithApproval,
    ),
    ...compareBooleanTightening(
      "accountability.evidenceRequiredForDone",
      pack.policies.accountability.evidenceRequiredForDone,
      current.accountability?.evidenceRequiredForDone,
    ),
    ...compareNumberCeiling(
      "accountability.silenceAfterHours",
      pack.policies.accountability.silenceAfterHours,
      current.accountability?.silenceAfterHours,
    ),
    ...compareNumberCeiling(
      "accountability.escalationAfterHours",
      pack.policies.accountability.escalationAfterHours,
      current.accountability?.escalationAfterHours,
    ),
    ...compareBooleanTightening(
      "deployReadiness.requireIssueKey",
      pack.policies.deployReadiness.requireIssueKey,
      current.deployReadiness?.requireIssueKey,
    ),
    ...compareBooleanTightening(
      "deployReadiness.requireQaEvidence",
      pack.policies.deployReadiness.requireQaEvidence,
      current.deployReadiness?.requireQaEvidence,
    ),
    ...compareBooleanTightening(
      "deployReadiness.requireRollbackOwner",
      pack.policies.deployReadiness.requireRollbackOwner,
      current.deployReadiness?.requireRollbackOwner,
    ),
    ...compareEvidenceSystems(
      pack.policies.qaEvidence.acceptedEvidenceSystems,
      current.qaEvidence?.acceptedEvidenceSystems,
    ),
  ];
};

const compareSensitivityPolicy = (
  key: string,
  packValue: keyof typeof sensitivityRank,
  runtimeValue: keyof typeof sensitivityRank | undefined,
): readonly WorkspacePackReconciliationItem[] => {
  if (runtimeValue === undefined || packValue === runtimeValue) {
    return [];
  }

  return [
    {
      decision:
        sensitivityRank[packValue] > sensitivityRank[runtimeValue]
          ? "tighten_policy"
          : "create_drift_review",
      target: "policy",
      key,
      reason:
        sensitivityRank[packValue] > sensitivityRank[runtimeValue]
          ? `Pack raises ${key} from ${runtimeValue} to ${packValue}.`
          : `Pack would weaken ${key} from ${runtimeValue} to ${packValue}.`,
    },
  ];
};

const compareBooleanTightening = (
  key: string,
  packValue: boolean,
  runtimeValue: boolean | undefined,
): readonly WorkspacePackReconciliationItem[] => {
  if (runtimeValue === undefined || packValue === runtimeValue) {
    return [];
  }

  return [
    {
      decision: packValue ? "tighten_policy" : "create_drift_review",
      target: "policy",
      key,
      reason: packValue
        ? `Pack requires stricter policy ${key}.`
        : `Pack would relax existing policy ${key}.`,
    },
  ];
};

const compareNumberCeiling = (
  key: string,
  packValue: number,
  runtimeValue: number | undefined,
): readonly WorkspacePackReconciliationItem[] => {
  if (runtimeValue === undefined || packValue === runtimeValue) {
    return [];
  }

  return [
    {
      decision: packValue < runtimeValue ? "tighten_policy" : "create_drift_review",
      target: "policy",
      key,
      reason:
        packValue < runtimeValue
          ? `Pack shortens ${key} from ${runtimeValue} to ${packValue}.`
          : `Pack would lengthen ${key} from ${runtimeValue} to ${packValue}.`,
    },
  ];
};

const compareEvidenceSystems = (
  packSystems: WorkspacePackPolicies["qaEvidence"]["acceptedEvidenceSystems"],
  runtimeSystems: WorkspacePackPolicies["qaEvidence"]["acceptedEvidenceSystems"] | undefined,
): readonly WorkspacePackReconciliationItem[] => {
  if (runtimeSystems === undefined) {
    return [];
  }

  const packSet = new Set(packSystems);
  const runtimeSet = new Set(runtimeSystems);
  const removesRuntimeSystem = runtimeSystems.some((system) => !packSet.has(system));
  const addsRuntimeSystem = packSystems.some((system) => !runtimeSet.has(system));

  if (!removesRuntimeSystem && !addsRuntimeSystem) {
    return [];
  }

  return [
    {
      decision: removesRuntimeSystem ? "tighten_policy" : "create_drift_review",
      target: "policy",
      key: "qaEvidence.acceptedEvidenceSystems",
      reason: removesRuntimeSystem
        ? "Pack narrows accepted QA evidence systems."
        : "Pack would broaden accepted QA evidence systems.",
    },
  ];
};

const allSeeds = (pack: WorkspacePackManifest): readonly WorkspacePackSeedIntent[] => [
  ...pack.seeds.goals,
  ...pack.seeds.commitments,
  ...pack.seeds.bets,
];

const uniqueExternalSystems = (
  mappings: readonly WorkspacePackMapping[],
  organizationId: string,
  occurredAt: string,
): readonly ExternalSystem[] => {
  const systems = new Map<WorkspacePackMapping["system"], ExternalSystem>();

  for (const mapping of mappings) {
    systems.set(mapping.system, {
      id: externalSystemIdForWorkspacePackMapping(mapping.system),
      organizationId,
      kind: mapping.system,
      name: `${mapping.system} workspace pack source`,
      createdAt: occurredAt,
    });
  }

  return [...systems.values()].sort((left, right) => left.id.localeCompare(right.id));
};

const policyKeysToPersist = (
  decisions: readonly WorkspacePackReconciliationItem[],
): readonly (keyof WorkspacePackPolicies)[] => {
  const keys = new Set<keyof WorkspacePackPolicies>();

  for (const decision of decisions) {
    if (decision.target !== "policy" || decision.decision === "create_drift_review") {
      continue;
    }

    const rootKey = decision.key.split(".")[0];

    if (isWorkspacePackPolicyKey(rootKey)) {
      keys.add(rootKey);
    }
  }

  return [...keys].sort();
};

const decisionKey = (decision: WorkspacePackReconciliationItem): string =>
  decision.target === "seed_intent"
    ? `${decision.target}:${decision.key}:${decision.decision}`
    : `${decision.target}:${decision.key}`;

const driftFindingIdForWorkspacePackDecision = (
  workspaceKey: string,
  decision: WorkspacePackReconciliationItem,
): string =>
  `drift-pack-${stableIdentifier(workspaceKey)}-${stableIdentifier(decision.target)}-${stableIdentifier(decision.key)}`;

const stableIdentifier = (value: string): string => value.replace(/[^A-Za-z0-9_.:-]+/g, "_");

const isWorkspacePackPolicyKey = (
  value: string | undefined,
): value is keyof WorkspacePackPolicies =>
  value === "accountability" ||
  value === "visibility" ||
  value === "deployReadiness" ||
  value === "qaEvidence";

const intentDrifted = (
  seed: WorkspacePackSeedIntent,
  existingIntent: RuntimeIntentSnapshot,
): boolean =>
  seed.kind !== existingIntent.kind ||
  seed.title !== existingIntent.title ||
  seed.body !== existingIntent.body ||
  seed.sensitivity !== existingIntent.sensitivity;

const mappingKey = (mapping: WorkspacePackMapping): string =>
  `${mapping.system}:${mapping.resourceType}:${mapping.externalId}:${mapping.purpose}`;

const isWorkspacePackTemplateName = (
  value: string,
): value is WorkspacePackManifest["templates"][number]["name"] =>
  value === "daily-delivery-brief" || value === "drift-review" || value === "client-update";

const expectSensitivity = (value: unknown, path: string): keyof typeof sensitivityRank =>
  expectOneOf(value, ["public", "internal", "confidential", "restricted"], path);

const expectOptionalArray = (value: unknown, path: string): readonly unknown[] => {
  if (value === undefined) {
    return [];
  }

  return expectArray(value, path);
};

const expectArray = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${path} to be an array.`);
  }

  return value;
};

const expectRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`Expected ${path} to be an object.`);
  }

  return value;
};

const expectString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${path} to be a non-empty string.`);
  }

  return value;
};

const expectNumber = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected ${path} to be a finite number.`);
  }

  return value;
};

const expectBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`Expected ${path} to be a boolean.`);
  }

  return value;
};

const expectLiteral = <Value extends string | number | boolean>(
  value: unknown,
  expected: Value,
  path: string,
): Value => {
  if (value !== expected) {
    throw new Error(`Expected ${path} to equal ${String(expected)}.`);
  }

  return expected;
};

const expectOneOf = <Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
): Value => {
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    throw new Error(`Expected ${path} to be one of ${allowed.join(", ")}.`);
  }

  return value as Value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

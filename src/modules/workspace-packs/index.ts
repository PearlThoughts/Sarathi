import { parse as parseYaml } from "yaml";
import type {
  WorkspacePackManifest,
  WorkspacePackMapping,
  WorkspacePackPolicies,
  WorkspacePackReconciliationDecision,
  WorkspacePackSeedIntent,
} from "../strategy-kernel/index.ts";

export type WorkspacePackSourceFile = {
  readonly path: string;
  readonly contents: string;
};

export type WorkspacePackLoadInput = WorkspacePackManifest | readonly WorkspacePackSourceFile[];

export type RuntimePolicySnapshot = Partial<WorkspacePackPolicies>;

export type RuntimeIntentState = "candidate" | "ratified" | "active" | "done" | "human_edited";

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

type MutablePackFragments = {
  version?: number | undefined;
  workspace?: unknown;
  actors?: unknown;
  mappings: unknown[];
  policies: Partial<Record<keyof WorkspacePackPolicies, unknown>>;
  seeds: Partial<Record<keyof WorkspacePackManifest["seeds"], unknown>>;
  templates?: unknown;
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
    mappings: [],
    policies: {},
    seeds: {},
  };

  for (const file of files) {
    if (file.path.endsWith(".md")) {
      continue;
    }

    const parsed = parseWorkspacePackYaml(file);

    mergeOptionalTopLevel(fragments, parsed, "version");
    mergeOptionalTopLevel(fragments, parsed, "workspace");
    mergeOptionalTopLevel(fragments, parsed, "actors");
    mergeOptionalTopLevel(fragments, parsed, "templates");
    mergeArrayFragment(fragments.mappings, parsed, "mappings", file.path);
    mergeRecordFragment(fragments.policies, parsed, requiredPolicyKeys, file.path);
    mergeRecordFragment(fragments.seeds, parsed, ["goals", "commitments", "bets"], file.path);
  }

  return assertWorkspacePackManifest(
    {
      version: fragments.version,
      workspace: fragments.workspace,
      actors: fragments.actors,
      mappings: fragments.mappings.flat(),
      policies: fragments.policies,
      seeds: {
        goals: fragments.seeds.goals ?? [],
        commitments: fragments.seeds.commitments ?? [],
        bets: fragments.seeds.bets ?? [],
      },
      templates: fragments.templates ?? inferTemplates(files),
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
  _path: string,
): void => {
  for (const key of keys) {
    if (parsed[key] !== undefined) {
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

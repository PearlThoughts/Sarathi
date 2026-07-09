import type { SensitivityTier } from "../../../domain/policy.ts";
import type {
  AccountabilityChannel,
  ExternalSystemKind,
  IntentNodeKind,
  WorkspaceActorRoleName,
  WorkspaceKind,
  WorkspaceRelationType,
} from "./strategy-kernel.ts";

export type WorkspacePackVersion = 1;

export type WorkspacePackManifest = {
  readonly version: WorkspacePackVersion;
  readonly workspace: WorkspacePackWorkspace;
  readonly actors: readonly WorkspacePackActor[];
  readonly mappings: readonly WorkspacePackMapping[];
  readonly policies: WorkspacePackPolicies;
  readonly seeds: WorkspacePackSeeds;
  readonly templates: readonly WorkspacePackTemplate[];
};

export type WorkspacePackWorkspace = {
  readonly key: string;
  readonly name: string;
  readonly kind: WorkspaceKind;
  readonly defaultSensitivity: SensitivityTier;
  readonly relations?: readonly WorkspacePackRelation[] | undefined;
};

export type WorkspacePackRelation = {
  readonly targetWorkspaceKey: string;
  readonly relationType: WorkspaceRelationType;
  readonly description?: string | undefined;
};

export type WorkspacePackActor = {
  readonly key: string;
  readonly displayName: string;
  readonly role: WorkspaceActorRoleName;
  readonly canRatifyIntent: boolean;
  readonly canApproveSensitivityDowngrade: boolean;
};

export type WorkspacePackMapping = {
  readonly system: ExternalSystemKind;
  readonly resourceType: string;
  readonly externalId: string;
  readonly purpose: "conversation" | "execution" | "evidence" | "governance" | "projection";
  readonly sensitivity: SensitivityTier;
};

export type WorkspacePackPolicies = {
  readonly accountability: {
    readonly defaultChannel: AccountabilityChannel;
    readonly silenceAfterHours: number;
    readonly escalationAfterHours: number;
    readonly evidenceRequiredForDone: boolean;
  };
  readonly visibility: {
    readonly defaultSensitivity: SensitivityTier;
    readonly allowSensitivityDowngradeOnlyWithApproval: boolean;
  };
  readonly deployReadiness: {
    readonly requireIssueKey: boolean;
    readonly requireQaEvidence: boolean;
    readonly requireRollbackOwner: boolean;
  };
  readonly qaEvidence: {
    readonly acceptedEvidenceSystems: readonly ExternalSystemKind[];
  };
};

export type WorkspacePackSeedIntent = {
  readonly key: string;
  readonly kind: IntentNodeKind;
  readonly title: string;
  readonly body: string;
  readonly sensitivity: SensitivityTier;
};

export type WorkspacePackSeeds = {
  readonly goals: readonly WorkspacePackSeedIntent[];
  readonly commitments: readonly WorkspacePackSeedIntent[];
  readonly bets: readonly WorkspacePackSeedIntent[];
};

export type WorkspacePackTemplate = {
  readonly name: "daily-delivery-brief" | "drift-review" | "client-update";
  readonly path: string;
  readonly sensitivity: SensitivityTier;
};

export type WorkspacePackReconciliationDecision =
  | "create_missing_config"
  | "propose_seed_intent"
  | "tighten_policy"
  | "create_drift_review"
  | "no_change";

export type WorkspacePackReconciliationRule = {
  readonly decision: WorkspacePackReconciliationDecision;
  readonly reason: string;
};

export const workspacePackReconciliationRules = [
  {
    decision: "create_missing_config",
    reason: "Workspace packs may create missing workspace, actor, mapping, and policy records.",
  },
  {
    decision: "propose_seed_intent",
    reason: "Seed goals, commitments, and bets enter the inferred intent inbox for ratification.",
  },
  {
    decision: "tighten_policy",
    reason:
      "A pack may raise sensitivity or evidence requirements without weakening runtime policy.",
  },
  {
    decision: "create_drift_review",
    reason:
      "Conflicts with ratified runtime intent, completed actions, or human-edited decisions become drift findings.",
  },
] as const satisfies readonly [
  WorkspacePackReconciliationRule,
  ...WorkspacePackReconciliationRule[],
];

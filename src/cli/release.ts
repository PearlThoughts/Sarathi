import { existsSync } from "node:fs";
import {
  type AccountabilityPolicy,
  createAccountabilityAction,
} from "../modules/accountability-actions/index.ts";
import {
  acceptClaimAsIntent,
  buildEvidenceItem,
  extractClaimsFromEvidence,
  rejectClaim,
} from "../modules/intent-inbox/index.ts";
import {
  createIntendedProjection,
  verifyProjectionAgainstSimulation,
} from "../modules/projections/index.ts";
import { generateWeeklyDriftReview } from "../modules/strategic-reports/index.ts";
import type {
  AccountabilityAction,
  Actor,
  DriftFinding,
  EvidenceItem,
  ExternalResourceMapping,
  ExternalSystem,
  ExtractedClaim,
  IntentEdge,
  IntentNode,
  KernelEvent,
  Organization,
  Projection,
  StrategyKernelRepository,
  Workspace,
  WorkspaceActorRole,
  WorkspaceRelation,
} from "../modules/strategy-kernel/index.ts";
import { loadWorkspacePack, reconcileWorkspacePack } from "../modules/workspace-packs/index.ts";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type CliOptions = {
  readonly args: readonly string[];
  readonly env?: Record<string, string | undefined> | undefined;
  readonly fetcher?: Fetcher | undefined;
};

type CliResult = {
  readonly exitCode: number;
  readonly output: unknown;
};

type EndpointCheck = {
  readonly endpoint: string;
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
};

type RuntimeSmokeReport = {
  readonly baseUrl: string;
  readonly checks: readonly EndpointCheck[];
  readonly ok: boolean;
};

const defaultBaseUrl = "http://localhost:3000";
const previewOverlayBody = {
  version: 1,
  organizationId: "acme",
  teams: [
    {
      teamId: "engineering",
      sensitivity: "confidential",
      minimumTrustTier: "trusted",
      modelEgress: "approval-required",
    },
  ],
} as const;

const normalizeBaseUrl = (value: string | undefined): string =>
  (value ?? defaultBaseUrl).replace(/\/+$/, "");

const baseUrlFromEnv = (env: Record<string, string | undefined>): string => {
  if (env.SARATHI_PUBLIC_BASE_URL !== undefined && env.SARATHI_PUBLIC_BASE_URL !== "") {
    return normalizeBaseUrl(env.SARATHI_PUBLIC_BASE_URL);
  }

  if (env.RAILWAY_PUBLIC_DOMAIN !== undefined && env.RAILWAY_PUBLIC_DOMAIN !== "") {
    return normalizeBaseUrl(`https://${env.RAILWAY_PUBLIC_DOMAIN}`);
  }

  return defaultBaseUrl;
};

const readEndpoint = async (
  baseUrl: string,
  endpoint: string,
  fetcher: Fetcher,
  init?: RequestInit,
): Promise<EndpointCheck> => {
  const response = await fetcher(`${baseUrl}${endpoint}`, init);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return {
    endpoint,
    ok: response.ok,
    status: response.status,
    body,
  };
};

export const checkRuntimeHealth = async (
  baseUrl: string,
  fetcher: Fetcher = fetch,
): Promise<EndpointCheck> => readEndpoint(normalizeBaseUrl(baseUrl), "/health", fetcher);

export const checkRuntimeSmoke = async (
  baseUrl: string,
  fetcher: Fetcher = fetch,
): Promise<RuntimeSmokeReport> => {
  const normalized = normalizeBaseUrl(baseUrl);
  const checks = await Promise.all([
    readEndpoint(normalized, "/health", fetcher),
    readEndpoint(normalized, "/platform/foundation", fetcher),
    readEndpoint(normalized, "/workspace-model", fetcher),
    readEndpoint(normalized, "/workspace-model/preview", fetcher, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(previewOverlayBody),
    }),
  ]);

  return {
    baseUrl: normalized,
    checks,
    ok: checks.every((check) => check.ok),
  };
};

const verifyRailwayRuntime = (): CliResult => {
  const missing = [
    existsSync("package.json") ? undefined : "package.json",
    existsSync("bun.lock") ? undefined : "bun.lock",
  ].filter((value): value is string => value !== undefined);

  if (missing.length > 0) {
    return {
      exitCode: 1,
      output: {
        ok: false,
        missing,
      },
    };
  }

  return {
    exitCode: 0,
    output: {
      ok: true,
      runtime: "bun",
      startCommand: "bun run start",
      healthEndpoint: "/health",
      smokeCommand: "bun run runtime:smoke",
    },
  };
};

const railwayDeployStatus = (env: Record<string, string | undefined>): CliResult => {
  const hasRailwayProject =
    env.RAILWAY_PROJECT_ID !== undefined &&
    env.RAILWAY_PROJECT_ID !== "" &&
    env.RAILWAY_SERVICE_ID !== undefined &&
    env.RAILWAY_SERVICE_ID !== "";

  return {
    exitCode: 2,
    output: {
      ok: false,
      provider: "railway",
      configured: hasRailwayProject,
      message:
        "Railway deploy is intentionally not wired yet. Link the GitHub repo to a Railway service, set RAILWAY_PROJECT_ID and RAILWAY_SERVICE_ID, then replace this guard with the project release CLI.",
    },
  };
};

const syntheticPolicy: AccountabilityPolicy = {
  defaultChannel: "teams_channel",
  silenceAfterHours: 24,
  escalationAfterHours: 48,
  evidenceRequiredForDone: true,
};

const syntheticPack = {
  version: 1,
  workspace: {
    key: "launchpad",
    name: "Launchpad Delivery",
    kind: "project",
    defaultSensitivity: "internal",
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
  mappings: [],
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
    goals: [],
    commitments: [
      {
        key: "qa-evidence",
        kind: "commitment",
        title: "Attach QA evidence",
        body: "Delivery lead will attach QA evidence before marking done.",
        sensitivity: "internal",
      },
    ],
    bets: [],
  },
  templates: [],
} as const;

const createRuntimeFixture = (
  workspaceId: string,
): {
  readonly now: string;
  readonly actor: Actor;
  readonly intent: IntentNode;
  readonly evidence: EvidenceItem;
} => {
  const now = "2026-07-09T12:00:00.000Z";
  const actor: Actor = {
    id: "actor-delivery-lead",
    organizationId: "org-synthetic",
    kind: "person",
    displayName: "Delivery Lead",
    createdAt: now,
    updatedAt: now,
  };
  const intent: IntentNode = {
    id: "intent-qa-evidence",
    workspaceId,
    kind: "commitment",
    title: "Attach QA evidence",
    body: "Delivery lead will attach QA evidence before marking done.",
    ownerActorId: actor.id,
    state: "ratified",
    dueAt: "2026-07-10T12:00:00.000Z",
    sensitivity: "internal",
    createdBy: "sarathi",
    createdAt: now,
    updatedAt: now,
  };
  const evidence: EvidenceItem = {
    id: "evidence-teams-qa",
    workspaceId,
    sourceSystem: "teams",
    sourceType: "message",
    externalId: "synthetic-message-1",
    actorId: actor.id,
    occurredAt: now,
    title: "QA evidence commitment",
    bodyExcerpt: "I will attach QA evidence by 2026-07-10.",
    contentHash: "sha256-synthetic",
    sensitivity: "internal",
    ingestedAt: now,
  };

  return { now, actor, intent, evidence };
};

const createMemoryStrategyKernelRepository = (): StrategyKernelRepository => {
  const evidence = new Map<string, EvidenceItem>();
  const claims = new Map<string, ExtractedClaim>();
  const intents = new Map<string, IntentNode>();
  const projections = new Map<string, Projection>();
  const actions = new Map<string, AccountabilityAction>();
  const driftFindings = new Map<string, DriftFinding>();
  const events = new Map<string, KernelEvent>();

  const repository: StrategyKernelRepository = {
    withTransaction: async (operation) => operation(repository),
    saveOrganization: async (_organization: Organization) => undefined,
    saveWorkspace: async (_workspace: Workspace) => undefined,
    saveWorkspaceRelation: async (_relation: WorkspaceRelation) => undefined,
    saveActor: async (_actor: Actor) => undefined,
    saveWorkspaceActorRole: async (_role: WorkspaceActorRole) => undefined,
    saveExternalSystem: async (_system: ExternalSystem) => undefined,
    saveExternalResourceMapping: async (_mapping: ExternalResourceMapping) => undefined,
    saveEvidenceItem: async (item) => {
      evidence.set(item.id, item);
    },
    saveExtractedClaim: async (claim) => {
      claims.set(claim.id, claim);
    },
    saveIntentNode: async (node) => {
      intents.set(node.id, node);
    },
    saveIntentEdge: async (_edge: IntentEdge) => undefined,
    saveProjection: async (projection) => {
      projections.set(projection.id, projection);
    },
    saveAccountabilityAction: async (action) => {
      actions.set(action.id, action);
    },
    saveKernelEvent: async (event) => {
      events.set(event.id, event);
    },
    saveDriftFinding: async (finding) => {
      driftFindings.set(finding.id, finding);
    },
    listWorkspaceEvidence: async (workspaceId) =>
      [...evidence.values()].filter((item) => item.workspaceId === workspaceId),
    listWorkspaceIntent: async (workspaceId) =>
      [...intents.values()].filter((intent) => intent.workspaceId === workspaceId),
    listPendingClaims: async (workspaceId) =>
      [...claims.values()].filter(
        (claim) => claim.workspaceId === workspaceId && claim.state === "pending",
      ),
    getExtractedClaim: async (claimId) => claims.get(claimId),
    getIntentNode: async (intentNodeId) => intents.get(intentNodeId),
    listWorkspaceProjections: async (workspaceId) =>
      [...projections.values()].filter((projection) => projection.workspaceId === workspaceId),
    listWorkspaceAccountabilityActions: async (workspaceId) =>
      [...actions.values()].filter((action) => action.workspaceId === workspaceId),
    listWorkspaceDriftFindings: async (workspaceId) =>
      [...driftFindings.values()].filter((finding) => finding.workspaceId === workspaceId),
    listWorkspaceKernelEvents: async (workspaceId) =>
      [...events.values()].filter((event) => event.workspaceId === workspaceId),
  };

  return repository;
};

const isJsonMode = (args: readonly string[]): boolean => args.includes("--json");

const optionValue = (args: readonly string[], option: string): string | undefined => {
  const index = args.indexOf(option);
  return index === -1 ? undefined : args[index + 1];
};

const workspaceIdFromArgs = (args: readonly string[]): string =>
  optionValue(args, "--workspace") ?? "workspace-launchpad";

const runtimeCommand = async (args: readonly string[]): Promise<CliResult | undefined> => {
  const workspaceId = workspaceIdFromArgs(args);
  const repository = createMemoryStrategyKernelRepository();
  const fixture = createRuntimeFixture(workspaceId);

  await repository.saveIntentNode(fixture.intent);

  if (args[0] === "workspace" && args[1] === "reconcile") {
    const pack = loadWorkspacePack(syntheticPack);
    const items = reconcileWorkspacePack(pack, {
      workspaceKey: optionValue(args, "--pack") === undefined ? undefined : "launchpad",
      actorKeys: [],
      mappings: [],
      policies: {},
      intents: [],
      templatePaths: [],
    });

    return {
      exitCode: 0,
      output: {
        ok: true,
        mode: "synthetic",
        workspaceKey: pack.workspace.key,
        decisions: items,
      },
    };
  }

  if (args[0] === "intent" && args[1] === "inbox") {
    const evidence = buildEvidenceItem(fixture.evidence, fixture.now);
    const claims = extractClaimsFromEvidence(evidence, fixture.now);

    return {
      exitCode: 0,
      output: {
        mode: "synthetic",
        workspaceId,
        pendingClaims: claims,
      },
    };
  }

  if (args[0] === "intent" && (args[1] === "accept" || args[1] === "reject")) {
    const evidence = buildEvidenceItem(fixture.evidence, fixture.now);
    const claim = extractClaimsFromEvidence(evidence, fixture.now)[0];

    if (claim === undefined) {
      return { exitCode: 1, output: { ok: false, message: "No synthetic claim available." } };
    }

    await repository.saveEvidenceItem(evidence);
    const selectedClaim = { ...claim, id: args[2] ?? claim.id };
    await repository.saveExtractedClaim(selectedClaim);

    const result =
      args[1] === "accept"
        ? await acceptClaimAsIntent({
            repository,
            claim: selectedClaim,
            actorId: fixture.actor.id,
            occurredAt: fixture.now,
          })
        : await rejectClaim({
            repository,
            claim: selectedClaim,
            actorId: fixture.actor.id,
            reason: "Rejected from synthetic CLI flow.",
            occurredAt: fixture.now,
          });

    return {
      exitCode: 0,
      output: { ok: true, mode: "synthetic", claim: result.claim, intent: result.intent },
    };
  }

  if (args[0] === "projection" && args[1] === "verify") {
    const projection = createIntendedProjection({
      intent: fixture.intent,
      targetSystem: "jira",
      targetType: "issue",
      targetId: "SYN-1",
      publishedHash: "sha256-current",
      relatedEvidence: [fixture.evidence],
    });
    const result = await verifyProjectionAgainstSimulation(
      repository,
      projection,
      { authorized: true, exists: true, contentHash: "sha256-stale", managedBySarathi: true },
      fixture.now,
    );

    return {
      exitCode: 0,
      output: {
        ok: true,
        mode: "synthetic",
        projection: result.projection,
        driftFinding: result.driftFinding,
      },
    };
  }

  if (args[0] === "accountability" && args[1] === "list") {
    const action = await createAccountabilityAction({
      repository,
      intent: fixture.intent,
      policy: syntheticPolicy,
      occurredAt: fixture.now,
    });

    return {
      exitCode: 0,
      output: {
        mode: "synthetic",
        workspaceId,
        actions: [action.action],
      },
    };
  }

  if (args[0] === "report" && args[1] === "drift-review") {
    const projection = createIntendedProjection({
      intent: fixture.intent,
      targetSystem: "jira",
      targetType: "issue",
      targetId: "SYN-1",
      publishedHash: "sha256-current",
    });
    const drift: DriftFinding = {
      id: "drift-synthetic",
      workspaceId,
      findingType: "projection_drift",
      title: "Synthetic projection drift",
      body: "Synthetic projection differs from intended state.",
      state: "open",
      relatedEntityType: "projection",
      relatedEntityId: projection.id,
      sensitivity: "internal",
      createdAt: fixture.now,
    };

    return {
      exitCode: 0,
      output: generateWeeklyDriftReview({
        workspaceId,
        generatedAt: fixture.now,
        intents: [fixture.intent],
        evidence: [fixture.evidence],
        projections: [{ ...projection, driftStatus: "stale" }],
        actions: [],
        driftFindings: [drift],
      }),
    };
  }

  return undefined;
};

export const runReleaseCli = async (options: CliOptions): Promise<CliResult> => {
  const args = options.args.filter((arg) => arg !== "--ci" && arg !== "--json");
  const env = options.env ?? Bun.env;
  const fetcher = options.fetcher ?? fetch;
  const runtimeResult = await runtimeCommand(args);

  if (runtimeResult !== undefined) {
    return runtimeResult;
  }

  if (args[0] === "runtime" && args[1] === "health") {
    const baseUrl = baseUrlFromEnv(env);
    const health = await checkRuntimeHealth(baseUrl, fetcher);

    return {
      exitCode: health.ok ? 0 : 1,
      output: {
        baseUrl,
        check: health,
      },
    };
  }

  if (args[0] === "runtime" && args[1] === "smoke") {
    const smoke = await checkRuntimeSmoke(baseUrlFromEnv(env), fetcher);

    return {
      exitCode: smoke.ok ? 0 : 1,
      output: smoke,
    };
  }

  if (args[0] === "runtime" && args[1] === "verify-railpack") {
    return verifyRailwayRuntime();
  }

  if (args[0] === "railway" || args.length === 0) {
    return railwayDeployStatus(env);
  }

  return {
    exitCode: 2,
    output: {
      ok: false,
      message: `Unknown command: ${args.join(" ")}`,
    },
  };
};

const printResult = (result: CliResult, jsonMode: boolean): void => {
  if (jsonMode) {
    console.log(JSON.stringify(result.output, null, 2));
    return;
  }

  console.log(JSON.stringify(result.output, null, 2));
};

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const result = await runReleaseCli({ args });
  printResult(result, isJsonMode(args));
  process.exit(result.exitCode);
}

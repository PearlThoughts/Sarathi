import { Activity, ActivityTypes } from "@microsoft/agents-activity";
import {
  AgentApplication,
  type AuthConfiguration,
  authorizeJWT,
  CloudAdapter,
  MemoryStorage,
  type TurnContext,
  type TurnState,
} from "@microsoft/agents-hosting";
import { Effect } from "effect";
import express from "express";
import { RepositoryError } from "../domain/errors.ts";
import { stableSha256 } from "../domain/hash.ts";
import type { TrustTier } from "../domain/policy.ts";
import { createGitHubEvidenceReader } from "../infrastructure/github/index.ts";
import {
  createEntraClientCredentialsTokenProvider,
  createTeamsGraphThreadReader,
  createTeamsProactiveReminderDelivery,
} from "../infrastructure/graph/index.ts";
import {
  createJiraComplianceReminderSource,
  createJiraEvidenceReader,
} from "../infrastructure/jira/index.ts";
import {
  createOpenAiGroundedAnswerGenerator,
  openAiGroundedAnswerConfigurationFromEnvironment,
} from "../infrastructure/model/index.ts";
import {
  createPostgresComplianceReminderAudit,
  createPostgresTeamsMentionAudit,
  openStrategyKernelPostgresDatabase,
} from "../infrastructure/postgres/index.ts";
import {
  createWorkspaceProjectionResolver,
  workspaceProjectionFromEnvironment,
} from "../infrastructure/teams/workspace-projection-resolver.ts";
import {
  createGitHubVaultAllowlistReader,
  vaultAllowlistFromEnvironment,
} from "../infrastructure/vault/index.ts";
import {
  type ComplianceReminderRequest,
  manualComplianceReminderRequest,
  runComplianceReminder,
  runComplianceReminderShadowAcceptance,
  startComplianceReminderScheduler,
} from "../modules/compliance-reminders/index.ts";
import {
  createAuthorizedContextAssembler,
  handleTeamsMention,
  stripSarathiMention,
  type TeamsMentionDependencies,
} from "../modules/teams-mention/index.ts";
import {
  classifyHostSurface,
  strictHostRoutingConfigurationFromEnvironment,
} from "./host-routing.ts";

export type TeamsIngressConfiguration = {
  readonly appId: string;
  readonly appPassword: string;
  readonly tenantId: string;
};

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "") {
    throw new Error(`[TEAMS INGRESS CONFIGURATION FAILED]: ${name} is required.`);
  }
  return value;
};

export const teamsIngressConfigurationFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): TeamsIngressConfiguration => ({
  appId: required("MICROSOFT_APP_ID", environment.MICROSOFT_APP_ID),
  appPassword: required("MICROSOFT_APP_PASSWORD", environment.MICROSOFT_APP_PASSWORD),
  tenantId: required("MICROSOFT_APP_TENANT_ID", environment.MICROSOFT_APP_TENANT_ID),
});

const authConfiguration = (configuration: TeamsIngressConfiguration): AuthConfiguration => ({
  clientId: configuration.appId,
  clientSecret: configuration.appPassword,
  tenantId: configuration.tenantId,
});

const trustOrder: readonly TrustTier[] = ["guest", "member", "trusted", "maintainer", "admin"];

const hasRequiredTrust = (actual: TrustTier, minimum: TrustTier): boolean =>
  trustOrder.indexOf(actual) >= trustOrder.indexOf(minimum);

const unavailable = <Value>(message: string): Effect.Effect<Value, RepositoryError> =>
  Effect.fail(new RepositoryError({ message }));

const unavailableDependencies = (message: string): TeamsMentionDependencies => ({
  resolver: { resolve: () => unavailable(message) },
  authorizer: { authorizeContext: () => Effect.succeed({ allowed: false }) },
  contextAssembler: { assemble: () => unavailable(message) },
  answerGenerator: { generate: () => unavailable(message) },
  delivery: { reply: () => Effect.void },
  audit: {
    acquireLease: () => Effect.succeed({ kind: "acquired", attempt: 1 }),
    markDelivered: () => Effect.void,
    markFailed: () => Effect.void,
  },
  helloDiagnosticEnabled: false,
});

const enabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";

export type HostedTeamsIngressComposition = {
  readonly dependencies: TeamsMentionDependencies;
  readonly ready: boolean;
  readonly checkReadiness: () => Promise<boolean>;
};

export type HostedFinanceReminderComposition = {
  readonly mode: "disabled" | "shadow" | "live";
  readonly enabled: boolean;
  readonly run: (request: ComplianceReminderRequest) => Promise<unknown>;
  readonly runDryRun: (kind: "planning" | "exceptions") => Promise<unknown>;
  readonly runShadowAcceptance: (kind: "planning" | "exceptions") => Promise<unknown>;
  readonly start: () => { readonly stop: () => void };
  readonly readiness: () => Promise<FinanceReadiness>;
};

export type FinanceReadiness = {
  readonly mode: "disabled" | "shadow" | "live";
  readonly configuration: "disabled" | "ready" | "invalid" | "unavailable";
  readonly scheduler: "not_running" | "shadow_manual" | "live_running";
  readonly postgres: "not_required" | "configured" | "available" | "unavailable";
  readonly sourceCredentials: "not_configured" | "configured";
  readonly deliveryCredentials: "not_configured" | "configured" | "unavailable";
};

const financeMode = (value: string | undefined): "disabled" | "shadow" | "live" | undefined => {
  if (value === undefined || value.trim() === "") return "disabled";
  const normalized = value.trim().toLowerCase();
  return normalized === "disabled" || normalized === "shadow" || normalized === "live"
    ? normalized
    : undefined;
};

export const financeReminderKindFromBody = (
  value: unknown,
): "planning" | "exceptions" | undefined => {
  if (typeof value !== "object" || value === null || !("kind" in value)) return undefined;
  return value.kind === "planning" || value.kind === "exceptions" ? value.kind : undefined;
};

export const stringListFromEnvironment = (name: string, value: string | undefined): string[] => {
  const configured = required(name, value).trim();
  if (configured.startsWith("[")) {
    const parsed = JSON.parse(configured) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
      throw new Error(`[TEAMS INGRESS CONFIGURATION FAILED]: ${name} must be a string array.`);
    }
    return parsed.map((entry) => entry.trim()).filter((entry) => entry !== "");
  }
  return configured
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
};

const disabledFinanceComposition = (
  configuration: FinanceReadiness["configuration"] = "disabled",
): HostedFinanceReminderComposition => ({
  mode: "disabled",
  enabled: false,
  run: async () => {
    throw new Error("Finance reminder configuration is unavailable.");
  },
  runDryRun: async () => {
    throw new Error("Finance dry-run is unavailable while Finance is disabled.");
  },
  runShadowAcceptance: async () => {
    throw new Error("Finance shadow acceptance is unavailable while Finance is disabled.");
  },
  start: () => ({ stop: () => undefined }),
  readiness: async () => ({
    mode: "disabled",
    configuration,
    scheduler: "not_running",
    postgres: "not_required",
    sourceCredentials: "not_configured",
    deliveryCredentials: "not_configured",
  }),
});

export const hostedFinanceReminderCompositionFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): HostedFinanceReminderComposition => {
  const mode = financeMode(environment.SARATHI_FINANCE_RUNTIME_MODE);
  if (mode === undefined) return disabledFinanceComposition("invalid");
  if (mode === "disabled") return disabledFinanceComposition();
  try {
    if (mode === "live") {
      required(
        "SARATHI_FINANCE_PROMOTION_APPROVAL_REF",
        environment.SARATHI_FINANCE_PROMOTION_APPROVAL_REF,
      );
    }
    const workspaceId = required(
      "SARATHI_REMINDER_WORKSPACE_ID",
      environment.SARATHI_REMINDER_WORKSPACE_ID,
    );
    const schedule = {
      enabled: mode === "live",
      workspaceId,
      timezone: required("SARATHI_REMINDER_TIMEZONE", environment.SARATHI_REMINDER_TIMEZONE),
      weeklyDigestTime: required(
        "SARATHI_WEEKLY_DIGEST_TIME",
        environment.SARATHI_WEEKLY_DIGEST_TIME,
      ),
      exceptionDigestTime: required(
        "SARATHI_EXCEPTION_DIGEST_TIME",
        environment.SARATHI_EXCEPTION_DIGEST_TIME,
      ),
    };
    const tokenProvider = createEntraClientCredentialsTokenProvider({
      tenantId: required("MICROSOFT_APP_TENANT_ID", environment.MICROSOFT_APP_TENANT_ID),
      clientId: required("MICROSOFT_APP_ID", environment.MICROSOFT_APP_ID),
      clientSecret: required("MICROSOFT_APP_PASSWORD", environment.MICROSOFT_APP_PASSWORD),
    });
    const database = openStrategyKernelPostgresDatabase(
      required("SARATHI_STRATEGY_DATABASE_URL", environment.SARATHI_STRATEGY_DATABASE_URL),
    );
    const dependencies = {
      source: createJiraComplianceReminderSource({
        baseUrl: required("JIRA_BASE_URL", environment.JIRA_BASE_URL),
        email: required("JIRA_EMAIL", environment.JIRA_EMAIL),
        apiToken: required("JIRA_API_TOKEN", environment.JIRA_API_TOKEN),
        projectKey: required(
          "SARATHI_COMPLIANCE_JIRA_PROJECT",
          environment.SARATHI_COMPLIANCE_JIRA_PROJECT,
        ),
        labels: stringListFromEnvironment(
          "SARATHI_COMPLIANCE_JIRA_LABELS",
          environment.SARATHI_COMPLIANCE_JIRA_LABELS,
        ),
      }),
      delivery: createTeamsProactiveReminderDelivery({
        chatId: required("SARATHI_DEFAULT_CHAT_ID", environment.SARATHI_DEFAULT_CHAT_ID),
        tokenProvider,
      }),
      audit: createPostgresComplianceReminderAudit(database),
    };
    const run = (request: ComplianceReminderRequest): Promise<unknown> =>
      Effect.runPromise(runComplianceReminder(request, dependencies));
    const runDryRun = async (kind: "planning" | "exceptions"): Promise<unknown> => {
      const request = manualComplianceReminderRequest(schedule, kind, new Date());
      if (request === undefined) throw new Error("Finance dry-run configuration is unavailable.");
      const result = await run(request);
      if (
        typeof result === "object" &&
        result !== null &&
        "state" in result &&
        result.state === "planned" &&
        "digest" in result &&
        typeof result.digest === "object" &&
        result.digest !== null &&
        "text" in result.digest &&
        typeof result.digest.text === "string" &&
        "itemCount" in result.digest &&
        typeof result.digest.itemCount === "number"
      ) {
        await Effect.runPromise(
          dependencies.audit.recordDryRunEvidence({
            workspaceId,
            idempotencyKey: request.idempotencyKey,
            kind,
            itemCount: result.digest.itemCount,
            digestHash: stableSha256(result.digest.text),
            occurredAt: request.occurredAt,
          }),
        );
      }
      return result;
    };
    const runShadowAcceptance = async (kind: "planning" | "exceptions"): Promise<unknown> => {
      if (mode !== "shadow") throw new Error("Finance shadow acceptance requires shadow mode.");
      const occurredAt = new Date().toISOString();
      const planned = manualComplianceReminderRequest(schedule, kind, new Date(occurredAt));
      if (planned === undefined)
        throw new Error("Finance shadow acceptance configuration is unavailable.");
      const request: ComplianceReminderRequest = {
        ...planned,
        dryRun: false,
        idempotencyKey: `${workspaceId}:shadow-acceptance:${kind}:${occurredAt}`,
        retryAt: "9999-12-31T23:59:59.999Z",
      };
      return runComplianceReminderShadowAcceptance(request, dependencies);
    };
    return {
      mode,
      enabled: mode === "live",
      run,
      runDryRun,
      runShadowAcceptance,
      start: () =>
        mode === "live"
          ? startComplianceReminderScheduler(schedule, run, (now) =>
              Effect.runPromise(
                dependencies.audit.dueRetries({ workspaceId, now: now.toISOString() }),
              ),
            )
          : { stop: () => undefined },
      readiness: async () => {
        try {
          await database.query("select 1");
          await tokenProvider.getAccessToken();
          return {
            mode,
            configuration: "ready",
            scheduler: mode === "live" ? "live_running" : "shadow_manual",
            postgres: "available",
            sourceCredentials: "configured",
            deliveryCredentials: "configured",
          };
        } catch {
          return {
            mode,
            configuration: "ready",
            scheduler: mode === "live" ? "live_running" : "shadow_manual",
            postgres: "unavailable",
            sourceCredentials: "configured",
            deliveryCredentials: "unavailable",
          };
        }
      },
    };
  } catch {
    return {
      ...disabledFinanceComposition("unavailable"),
      mode,
      readiness: async () => ({
        mode,
        configuration: "unavailable",
        scheduler: mode === "shadow" ? "shadow_manual" : "not_running",
        postgres: "unavailable",
        sourceCredentials: "not_configured",
        deliveryCredentials: "not_configured",
      }),
    };
  }
};

export const hostedTeamsIngressCompositionFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): HostedTeamsIngressComposition => {
  if (enabled(environment.SARATHI_TEAMS_HELLO_DIAGNOSTIC_ENABLED)) {
    try {
      const projection = workspaceProjectionFromEnvironment(environment);
      const resolver = createWorkspaceProjectionResolver(projection);
      const database = openStrategyKernelPostgresDatabase(
        required("SARATHI_STRATEGY_DATABASE_URL", environment.SARATHI_STRATEGY_DATABASE_URL),
      );
      return {
        dependencies: {
          resolver,
          authorizer: {
            authorizeContext: (_command, resolved) =>
              Effect.succeed({
                allowed:
                  hasRequiredTrust(resolved.callerTrustTier, resolved.boundary.minimumTrustTier) &&
                  resolved.boundary.allowedDelegationStages.includes("answer") &&
                  !resolved.boundary.requiresHumanApproval,
              }),
          },
          contextAssembler: { assemble: () => unavailable("Diagnostic-only composition") },
          answerGenerator: { generate: () => unavailable("Diagnostic-only composition") },
          delivery: { reply: () => Effect.void },
          audit: createPostgresTeamsMentionAudit(database),
          helloDiagnosticEnabled: true,
        },
        ready: true,
        checkReadiness: async () => {
          try {
            await database.query("select 1");
            return true;
          } catch {
            return false;
          }
        },
      };
    } catch {
      return {
        dependencies: unavailableDependencies(
          "Approved Teams diagnostic configuration is unavailable; Sarathi will not process this mention.",
        ),
        ready: false,
        checkReadiness: async () => false,
      };
    }
  }
  try {
    const sourceKeys = JSON.parse(
      required(
        "SARATHI_TEAMS_EVIDENCE_SOURCE_KEYS_JSON",
        environment.SARATHI_TEAMS_EVIDENCE_SOURCE_KEYS_JSON,
      ),
    ) as { teams: string; jira: string; github: string; vault: string };
    const graphTokenProvider = createEntraClientCredentialsTokenProvider({
      tenantId: required("MICROSOFT_APP_TENANT_ID", environment.MICROSOFT_APP_TENANT_ID),
      clientId: required("MICROSOFT_APP_ID", environment.MICROSOFT_APP_ID),
      clientSecret: required("MICROSOFT_APP_PASSWORD", environment.MICROSOFT_APP_PASSWORD),
    });
    const githubToken = required("GITHUB_TOKEN", environment.GITHUB_TOKEN);
    const databaseUrl = required(
      "SARATHI_STRATEGY_DATABASE_URL",
      environment.SARATHI_STRATEGY_DATABASE_URL,
    );
    const projection = workspaceProjectionFromEnvironment(environment);
    const resolver = createWorkspaceProjectionResolver(projection);
    const contextAssembler = createAuthorizedContextAssembler([
      {
        reader: createTeamsGraphThreadReader({
          tokenProvider: graphTokenProvider,
          approvedStandardChannels: new Set(
            projection.channels.map((channel) => `${channel.teamId}:${channel.channelId}`),
          ),
        }),
        sourceKey: () => sourceKeys.teams,
      },
      {
        reader: createJiraEvidenceReader({
          baseUrl: required("JIRA_BASE_URL", environment.JIRA_BASE_URL),
          email: required("JIRA_EMAIL", environment.JIRA_EMAIL),
          apiToken: required("JIRA_API_TOKEN", environment.JIRA_API_TOKEN),
        }),
        sourceKey: () => sourceKeys.jira,
      },
      {
        reader: createGitHubEvidenceReader({
          token: githubToken,
          allowedRepositories: new Set(
            JSON.parse(
              required(
                "SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON",
                environment.SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON,
              ),
            ) as string[],
          ),
        }),
        sourceKey: () => sourceKeys.github,
      },
      {
        reader: createGitHubVaultAllowlistReader({
          token: githubToken,
          allowlist: vaultAllowlistFromEnvironment(environment),
        }),
        sourceKey: () => sourceKeys.vault,
      },
    ]);
    return {
      dependencies: {
        resolver,
        authorizer: {
          authorizeContext: (_command, resolved) =>
            Effect.succeed({
              allowed:
                hasRequiredTrust(resolved.callerTrustTier, resolved.boundary.minimumTrustTier) &&
                resolved.boundary.allowedDelegationStages.includes("answer") &&
                resolved.boundary.modelEgress === "allow" &&
                !resolved.boundary.requiresHumanApproval,
            }),
        },
        contextAssembler,
        answerGenerator: createOpenAiGroundedAnswerGenerator(
          openAiGroundedAnswerConfigurationFromEnvironment(environment),
        ),
        delivery: { reply: () => Effect.void },
        audit: createPostgresTeamsMentionAudit(openStrategyKernelPostgresDatabase(databaseUrl)),
        helloDiagnosticEnabled: enabled(environment.SARATHI_TEAMS_HELLO_DIAGNOSTIC_ENABLED),
      },
      ready: true,
      checkReadiness: async () => {
        try {
          await graphTokenProvider.getAccessToken();
          return true;
        } catch {
          return false;
        }
      },
    };
  } catch {
    return {
      dependencies: unavailableDependencies(
        "Approved Teams workspace configuration is unavailable; Sarathi will not process this mention.",
      ),
      ready: false,
      checkReadiness: async () => false,
    };
  }
};

const failClosedDependencies = unavailableDependencies(
  "Hosted Teams dependencies are unavailable; Sarathi will not process this mention.",
);

const hasCompleteCommand = (command: {
  readonly activityId: string;
  readonly tenantId: string;
  readonly teamId: string;
  readonly channelId: string;
  readonly conversationId: string;
  readonly rootActivityId: string;
  readonly serviceUrl: string;
  readonly caller: {
    readonly entraObjectId: string;
    readonly displayName: string;
  };
  readonly question: string;
}): boolean =>
  [
    command.activityId,
    command.tenantId,
    command.teamId,
    command.channelId,
    command.conversationId,
    command.rootActivityId,
    command.serviceUrl,
    command.caller.entraObjectId,
    command.caller.displayName,
    command.question,
  ].every((value) => value.trim() !== "");

export const createTeamsIngressApplication = (
  dependencies: TeamsMentionDependencies = failClosedDependencies,
  adapter?: CloudAdapter,
): AgentApplication<TurnState> => {
  const application = new AgentApplication({
    storage: new MemoryStorage(),
    ...(adapter === undefined ? {} : { adapter }),
  });
  application.onActivity("message", async (context: TurnContext) => {
    const activity = context.activity;
    const text = activity.text ?? "";
    const recipientId = activity.recipient?.id;
    const question = recipientId === undefined ? "" : stripSarathiMention(text, recipientId);
    if (question === text || question === "") return;

    const channelData = activity.channelData as
      | {
          readonly team?: { readonly id?: string };
          readonly channel?: { readonly id?: string };
          readonly tenant?: { readonly id?: string };
        }
      | undefined;
    const command = {
      activityId: activity.id ?? "",
      tenantId: channelData?.tenant?.id ?? "",
      teamId: channelData?.team?.id ?? "",
      channelId: channelData?.channel?.id ?? "",
      conversationId: activity.conversation?.id ?? "",
      rootActivityId: activity.replyToId ?? activity.id ?? "",
      serviceUrl: activity.serviceUrl ?? "",
      caller: {
        entraObjectId: activity.from?.aadObjectId ?? "",
        displayName: activity.from?.name ?? "",
      },
      question,
      receivedAt:
        typeof activity.timestamp === "string"
          ? activity.timestamp
          : (activity.timestamp?.toISOString() ?? new Date().toISOString()),
    };
    if (!hasCompleteCommand(command)) return;
    const turnDependencies: TeamsMentionDependencies = {
      ...dependencies,
      delivery: {
        reply: (_replyCommand, answer) =>
          Effect.tryPromise({
            try: async () => {
              await context.sendActivity(
                sameThreadReplyActivity(command.rootActivityId, answer.text),
              );
            },
            catch: () => new RepositoryError({ message: "Teams delivery failed" }),
          }),
      },
    };
    const outcome = await Effect.runPromise(handleTeamsMention(command, turnDependencies));
    if (outcome.kind === "denied") {
      await context.sendActivity(sameThreadReplyActivity(command.rootActivityId, outcome.reason));
    }
  });
  return application;
};

export const sameThreadReplyActivity = (replyToId: string, text: string): Activity =>
  Activity.fromObject({ type: ActivityTypes.Message, replyToId, text });

export const startTeamsIngress = (): void => {
  const configuration = teamsIngressConfigurationFromEnvironment();
  const composition = hostedTeamsIngressCompositionFromEnvironment();
  const finance = hostedFinanceReminderCompositionFromEnvironment();
  const adapter = new CloudAdapter(authConfiguration(configuration));
  const application = createTeamsIngressApplication(composition.dependencies, adapter);
  const server = express();
  const strictHosts = strictHostRoutingConfigurationFromEnvironment();
  if (strictHosts !== undefined) {
    server.use((request, response, next) => {
      if (classifyHostSurface(request.hostname, request.path, strictHosts) === "denied") {
        response.status(421).json({ ok: false, error: "misdirected_request" });
        return;
      }
      next();
    });
  }
  server.use(express.json());
  server.post(
    "/api/messages",
    authorizeJWT(authConfiguration(configuration)),
    async (request, response) => {
      await adapter.process(request, response, async (context) => application.run(context));
    },
  );
  server.get("/health", (_request, response) =>
    response.json({ status: "ok", service: "sarathi", ingress: "teams" }),
  );
  server.get("/ready", async (_request, response) => {
    const teamsReady = composition.ready && (await composition.checkReadiness());
    const financeReadiness = await finance.readiness();
    const financeBroken =
      financeReadiness.configuration === "invalid" ||
      financeReadiness.configuration === "unavailable" ||
      (financeReadiness.mode !== "disabled" &&
        (financeReadiness.postgres !== "available" ||
          financeReadiness.deliveryCredentials !== "configured"));
    const ready = teamsReady && !financeBroken;
    response.status(ready ? 200 : 503).json({
      ready,
      components: {
        teamsMention: teamsReady ? "ready" : "unavailable",
        finance: financeReadiness,
      },
    });
  });
  server.post("/internal/finance/reminders/dry-run", async (request, response) => {
    const expectedToken = process.env.SARATHI_ADMIN_TOKEN;
    const authorization = request.header("authorization");
    if (
      expectedToken === undefined ||
      expectedToken.trim() === "" ||
      authorization !== `Bearer ${expectedToken}`
    ) {
      response.status(401).json({ ok: false });
      return;
    }
    if (finance.mode === "disabled") {
      response.status(409).json({ ok: false, mode: finance.mode });
      return;
    }
    const kind = financeReminderKindFromBody(request.body);
    if (kind === undefined) {
      response.status(400).json({ ok: false, error: "invalid_kind" });
      return;
    }
    try {
      response.json({ ok: true, result: await finance.runDryRun(kind) });
    } catch {
      response.status(503).json({ ok: false, mode: finance.mode });
    }
  });
  server.post("/internal/finance/reminders/shadow-acceptance", async (request, response) => {
    const expectedToken = process.env.SARATHI_ADMIN_TOKEN;
    const authorization = request.header("authorization");
    if (
      expectedToken === undefined ||
      expectedToken.trim() === "" ||
      authorization !== `Bearer ${expectedToken}`
    ) {
      response.status(401).json({ ok: false });
      return;
    }
    if (finance.mode !== "shadow") {
      response.status(409).json({ ok: false, mode: finance.mode });
      return;
    }
    const kind = financeReminderKindFromBody(request.body);
    if (kind === undefined) {
      response.status(400).json({ ok: false, error: "invalid_kind" });
      return;
    }
    try {
      response.json({ ok: true, result: await finance.runShadowAcceptance(kind) });
    } catch {
      response.status(503).json({ ok: false, mode: finance.mode });
    }
  });
  server.listen(Number.parseInt(process.env.PORT ?? "3978", 10));
  if (finance.enabled) finance.start();
};

if (import.meta.main) {
  startTeamsIngress();
}

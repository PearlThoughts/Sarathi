import { Activity, ActivityTypes } from "@microsoft/agents-activity";
import {
  AgentApplication,
  type AuthConfiguration,
  authorizeJWT,
  CloudAdapter,
  getAuthConfigWithDefaults,
  MemoryStorage,
  type TurnContext,
  type TurnState,
} from "@microsoft/agents-hosting";
import { Effect } from "effect";
import express from "express";
import { createApp } from "../app.ts";
import { runDeliverySyncCommand } from "../cli/commands/delivery-sync-runtime.ts";
import { startDeliverySyncScheduler } from "../cli/commands/delivery-sync-scheduler.ts";
import { RepositoryError } from "../domain/errors.ts";
import { stableSha256 } from "../domain/hash.ts";
import type { TrustTier } from "../domain/policy.ts";
import {
  createGitHubDeliveryQuerySource,
  createGitHubEvidenceReader,
  createGitHubKnowledgeSearch,
} from "../infrastructure/github/index.ts";
import {
  createEmailDeliveryQuerySource,
  createEntraClientCredentialsTokenProvider,
  createTeamsDeliveryQuerySource,
  createTeamsGraphMembershipResolver,
  createTeamsGraphThreadReader,
  createTeamsProactiveReminderDelivery,
  teamsThreadSourceKey,
} from "../infrastructure/graph/index.ts";
import {
  createJiraComplianceReminderSource,
  createJiraDeliveryQuerySource,
  createJiraEvidenceReader,
} from "../infrastructure/jira/index.ts";
import { createDeliveryKnowledgeQuerySource } from "../infrastructure/knowledge/index.ts";
import {
  createAiSdkDeliveryAnswerComposer,
  createAiSdkKnowledgeEmbedding,
  createGroundedAnswerGeneratorFromEnvironment,
  knowledgeEmbeddingConfigurationFromEnvironment,
} from "../infrastructure/model/index.ts";
import {
  applyStrategyKernelPostgresMigrations,
  closeStrategyKernelPostgresDatabase,
  createPostgresAnswerFeedbackRepository,
  createPostgresComplianceReminderAudit,
  createPostgresDeliveryQuerySource,
  createPostgresKnowledgeRepository,
  createPostgresStrategyKernelRepository,
  createPostgresTeamsMentionAudit,
  createStrategyKernelDeliveryQuerySource,
  ensureStrategyKernelWorkspace,
  openKnowledgePostgresDatabase,
  openStrategyKernelPostgresDatabase,
} from "../infrastructure/postgres/index.ts";
import {
  type AdaptiveCardPayload,
  answerFeedbackActionVerb,
  renderAnswerFeedbackAttachment,
  renderAnswerFeedbackCard,
  renderAnswerFeedbackFailureCard,
} from "../infrastructure/teams/answer-feedback-card.ts";
import {
  createKnowledgeTeamsContextSearch,
  createWorkspaceProjectionResolver,
  deliveryChannelProjectionFromEnvironment,
  workspaceProjectionAuthorizedActorIds,
  workspaceProjectionDeliveryChannels,
  workspaceProjectionFromEnvironment,
} from "../infrastructure/teams/index.ts";
import {
  createGitHubVaultAllowlistReader,
  vaultAllowlistFromEnvironment,
} from "../infrastructure/vault/index.ts";
import {
  createAnswerFeedbackService,
  decodeAnswerFeedbackAction,
} from "../modules/answer-feedback/index.ts";
import {
  type ComplianceReminderRequest,
  manualComplianceReminderRequest,
  runComplianceReminder,
  runComplianceReminderShadowAcceptance,
  startComplianceReminderScheduler,
} from "../modules/compliance-reminders/index.ts";
import {
  type CapabilityLedger,
  createBoundedDeliveryAssistant,
  createDeliveryAssistant,
  defaultDeliveryMaxConcurrency,
  defaultDeliveryMaxQueueDepth,
  deliveryRelevanceProfileFromEnvironment,
  deliveryResponseBudget,
  parseDeliveryEntityCatalog,
  validateCapabilityLedger,
} from "../modules/delivery-intelligence/index.ts";
import {
  importDeclaredInitiativeSnapshot,
  parseDeclaredInitiativeSnapshot,
} from "../modules/strategy-kernel/index.ts";
import {
  createAuthorizedContextAssembler,
  handleTeamsMention,
  stripSarathiMention,
  type TeamsMentionCommand,
  type TeamsMentionDependencies,
  teamsConversationBoundaryHash,
} from "../modules/teams-mention/index.ts";
import { makeSarathiRuntime } from "../platform/runtime.ts";
import {
  classifyHostSurface,
  strictHostRoutingConfigurationFromEnvironment,
} from "./host-routing.ts";
import { createHostedPlatformApiMiddleware } from "./hosted-platform-api.ts";
import { parseTeamsChangeNotificationBatch } from "./teams-change-notification-ingress.ts";

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

const configuredInteger = (
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
): number => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`[TEAMS INGRESS CONFIGURATION FAILED]: ${name} must be at least ${minimum}.`);
  }
  return parsed;
};

export const teamsIngressConfigurationFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): TeamsIngressConfiguration => ({
  appId: required("MICROSOFT_APP_ID", environment.MICROSOFT_APP_ID),
  appPassword: required("MICROSOFT_APP_PASSWORD", environment.MICROSOFT_APP_PASSWORD),
  tenantId: required("MICROSOFT_APP_TENANT_ID", environment.MICROSOFT_APP_TENANT_ID),
});

export const teamsIngressAuthConfiguration = (
  configuration: TeamsIngressConfiguration,
): AuthConfiguration =>
  getAuthConfigWithDefaults({
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
    renewLease: () => Effect.succeed(true),
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
                dependencies.audit.dueRetries({
                  workspaceId,
                  now: now.toISOString(),
                }),
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
          contextAssembler: {
            assemble: () => unavailable("Diagnostic-only composition"),
          },
          answerGenerator: {
            generate: () => unavailable("Diagnostic-only composition"),
          },
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
          "Connected Teams diagnostic configuration is unavailable; Sarathi will not process this mention.",
        ),
        ready: false,
        checkReadiness: async () => false,
      };
    }
  }
  try {
    const knowledgeEnabled = enabled(environment.SARATHI_KNOWLEDGE_ENABLED);
    const graphTokenProvider = createEntraClientCredentialsTokenProvider({
      tenantId: required("MICROSOFT_APP_TENANT_ID", environment.MICROSOFT_APP_TENANT_ID),
      clientId: required("MICROSOFT_APP_ID", environment.MICROSOFT_APP_ID),
      clientSecret: required("MICROSOFT_APP_PASSWORD", environment.MICROSOFT_APP_PASSWORD),
    });
    const githubToken = required("GITHUB_TOKEN", environment.GITHUB_TOKEN);
    const allowedRepositories =
      environment.SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON === undefined
        ? []
        : (JSON.parse(environment.SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON) as string[]);
    const repositoryScopes =
      environment.SARATHI_GITHUB_REPOSITORY_SCOPES_JSON === undefined
        ? []
        : (JSON.parse(environment.SARATHI_GITHUB_REPOSITORY_SCOPES_JSON) as readonly {
            readonly owner: string;
            readonly ownerType: "org" | "user";
            readonly repositoryNamePrefix?: string | undefined;
          }[]);
    const databaseUrl = required(
      "SARATHI_STRATEGY_DATABASE_URL",
      environment.SARATHI_STRATEGY_DATABASE_URL,
    );
    const projection = workspaceProjectionFromEnvironment(environment);
    const resolver = createWorkspaceProjectionResolver(
      projection,
      createTeamsGraphMembershipResolver({ tokenProvider: graphTokenProvider }),
    );
    const teamsThreadContextSource = {
      sourceScope: "teams" as const,
      contextRole: "conversation" as const,
      reader: createTeamsGraphThreadReader({
        tokenProvider: graphTokenProvider,
        allowedStandardChannels: new Set(
          workspaceProjectionDeliveryChannels(projection).map(
            (channel) => `${channel.graphTeamId}:${channel.channelId}`,
          ),
        ),
      }),
      sourceKey: (command: TeamsMentionCommand) =>
        command.conversation.kind === "team_channel" &&
        command.replyTarget.kind === "channel_thread" &&
        command.replyTarget.rootActivityId !== command.activityId
          ? teamsThreadSourceKey({
              teamId: command.conversation.graphTeamId,
              channelId: command.conversation.channelId,
              rootId: command.replyTarget.rootActivityId,
            })
          : undefined,
    } as const;
    const contextSources = knowledgeEnabled
      ? [teamsThreadContextSource]
      : (() => {
          const sourceKeys = JSON.parse(
            required("SARATHI_TEAMS_SOURCE_KEYS_JSON", environment.SARATHI_TEAMS_SOURCE_KEYS_JSON),
          ) as { jira: string; github: string; vault: string };
          return [
            teamsThreadContextSource,
            {
              sourceScope: "jira" as const,
              reader: createJiraEvidenceReader({
                baseUrl: required("JIRA_BASE_URL", environment.JIRA_BASE_URL),
                email: required("JIRA_EMAIL", environment.JIRA_EMAIL),
                apiToken: required("JIRA_API_TOKEN", environment.JIRA_API_TOKEN),
              }),
              sourceKey: () => sourceKeys.jira,
            },
            {
              sourceScope: "github" as const,
              reader: createGitHubEvidenceReader({
                token: githubToken,
                allowedRepositories: new Set(allowedRepositories),
              }),
              sourceKey: () => sourceKeys.github,
            },
            {
              sourceScope: "vault" as const,
              reader: createGitHubVaultAllowlistReader({
                token: githubToken,
                allowlist: vaultAllowlistFromEnvironment(environment),
              }),
              sourceKey: () => sourceKeys.vault,
            },
          ] as const;
        })();
    const knowledgeWorkspaceId = knowledgeEnabled
      ? required("SARATHI_KNOWLEDGE_WORKSPACE_ID", environment.SARATHI_KNOWLEDGE_WORKSPACE_ID)
      : undefined;
    const knowledgeDatabase = knowledgeEnabled
      ? openKnowledgePostgresDatabase(databaseUrl)
      : undefined;
    const feedbackDatabase = knowledgeDatabase ?? openKnowledgePostgresDatabase(databaseUrl);
    const answerFeedback = createAnswerFeedbackService(
      createPostgresAnswerFeedbackRepository(feedbackDatabase.database),
    );
    const knowledgeAudienceIds = knowledgeEnabled
      ? (JSON.parse(
          required(
            "SARATHI_KNOWLEDGE_AUDIENCE_IDS_JSON",
            environment.SARATHI_KNOWLEDGE_AUDIENCE_IDS_JSON,
          ),
        ) as string[])
      : [];
    const deliveryEntityCatalog = parseDeliveryEntityCatalog(
      environment.SARATHI_DELIVERY_ENTITY_CATALOG_JSON,
    );
    const knowledgeRepository =
      knowledgeDatabase === undefined
        ? undefined
        : createPostgresKnowledgeRepository(knowledgeDatabase.database, {
            entityCatalog: deliveryEntityCatalog,
          });
    const knowledgeEmbeddings =
      knowledgeDatabase === undefined
        ? undefined
        : createAiSdkKnowledgeEmbedding(
            knowledgeEmbeddingConfigurationFromEnvironment(environment),
          );
    const supplementalContext =
      knowledgeRepository === undefined || knowledgeEmbeddings === undefined
        ? undefined
        : createKnowledgeTeamsContextSearch({
            repository: knowledgeRepository,
            embeddings: knowledgeEmbeddings,
            liveSearches: [
              createGitHubKnowledgeSearch({
                token: githubToken,
                workspaceId: knowledgeWorkspaceId ?? "",
                allowedAudienceIds: new Set(knowledgeAudienceIds),
                allowedRepositories,
                repositoryScopes,
              }),
            ],
            audienceIds: knowledgeAudienceIds,
            topK: 10,
          });
    const deliveryIntelligenceEnabled = knowledgeEnabled;
    const relevanceProfile = deliveryRelevanceProfileFromEnvironment(environment);
    const deliveryTimeZone = deliveryIntelligenceEnabled
      ? required(
          "SARATHI_WORKSPACE_TIMEZONE",
          environment.SARATHI_WORKSPACE_TIMEZONE ?? environment.SARATHI_REMINDER_TIMEZONE,
        )
      : undefined;
    const deliveryAssistant = deliveryIntelligenceEnabled
      ? (() => {
          const workspaceId = required(
            "SARATHI_KNOWLEDGE_WORKSPACE_ID",
            knowledgeWorkspaceId ?? environment.SARATHI_KNOWLEDGE_WORKSPACE_ID,
          );
          const capabilityLedger =
            environment.SARATHI_DELIVERY_CAPABILITY_LEDGER_JSON === undefined
              ? undefined
              : validateCapabilityLedger(
                  JSON.parse(
                    environment.SARATHI_DELIVERY_CAPABILITY_LEDGER_JSON,
                  ) as CapabilityLedger,
                );
          const jiraProjection = JSON.parse(
            required(
              "SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON",
              environment.SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON,
            ),
          ) as { readonly projectKey?: string };
          const projectKey = required(
            "SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON.projectKey",
            jiraProjection.projectKey,
          );
          const workspaceChannels = workspaceProjectionDeliveryChannels(projection, workspaceId);
          const deliveryChannels = deliveryChannelProjectionFromEnvironment(
            environment,
            workspaceChannels.map((channel) => ({
              graphTeamId: channel.graphTeamId,
              channelId: channel.channelId,
              workspaceId: channel.workspaceId,
              scope: channel.scope,
              sensitivity: channel.sensitivity,
            })),
          ).filter((channel) => channel.workspaceId === workspaceId);
          const allowedActorIds = new Set(
            workspaceProjectionAuthorizedActorIds(projection, workspaceId),
          );
          const mailScopes =
            environment.SARATHI_PROJECT_MAIL_SCOPES_JSON === undefined
              ? []
              : (JSON.parse(environment.SARATHI_PROJECT_MAIL_SCOPES_JSON) as readonly {
                  readonly mailboxId: string;
                  readonly mode: "dedicated-mailbox" | "matched";
                  readonly routingTerms?: readonly string[] | undefined;
                  readonly participantAddresses?: readonly string[] | undefined;
                }[]);
          const assistant = createDeliveryAssistant({
            sources: [
              ...(knowledgeDatabase === undefined
                ? []
                : [
                    createPostgresDeliveryQuerySource(knowledgeDatabase.database, {
                      entityCatalog: deliveryEntityCatalog,
                    }),
                  ]),
              ...(knowledgeDatabase === undefined
                ? []
                : [
                    createStrategyKernelDeliveryQuerySource({
                      repository: createPostgresStrategyKernelRepository(knowledgeDatabase.pool),
                      workspaceId,
                      allowedActorIds,
                    }),
                  ]),
              ...(knowledgeRepository === undefined
                ? []
                : [
                    createDeliveryKnowledgeQuerySource({
                      repository: knowledgeRepository,
                      embeddings: knowledgeEmbeddings,
                      workspaceId,
                      allowedActorIds,
                      audienceIds: knowledgeAudienceIds,
                      relevanceProfile,
                      allowedGitHubRepositories: allowedRepositories,
                    }),
                  ]),
              createGitHubDeliveryQuerySource({
                token: githubToken,
                workspaceId,
                allowedActorIds,
                allowedRepositories,
                repositoryScopes,
                entityCatalog: deliveryEntityCatalog,
                timeoutMs: 4_000,
              }),
              createJiraDeliveryQuerySource({
                baseUrl: required("JIRA_BASE_URL", environment.JIRA_BASE_URL),
                email: required("JIRA_EMAIL", environment.JIRA_EMAIL),
                apiToken: required("JIRA_API_TOKEN", environment.JIRA_API_TOKEN),
                workspaceId,
                allowedActorIds,
                projectKeys: [projectKey],
                timeoutMs: 4_000,
              }),
              createTeamsDeliveryQuerySource({
                tokenProvider: graphTokenProvider,
                botApplicationId: required("MICROSOFT_APP_ID", environment.MICROSOFT_APP_ID),
                channels: deliveryChannels.map((channel) => ({
                  teamId: channel.graphTeamId,
                  channelId: channel.channelId,
                  workspaceId: channel.workspaceId,
                  sensitivity: channel.sensitivity,
                  allowedActorIds,
                  label: channel.label,
                  topics: channel.topics,
                })),
                timeoutMs: 4_000,
              }),
              ...(mailScopes.length === 0
                ? []
                : [
                    createEmailDeliveryQuerySource({
                      tokenProvider: graphTokenProvider,
                      mailScopes: mailScopes.map((scope) => ({
                        ...scope,
                        workspaceId,
                        allowedActorIds,
                        sensitivity: "internal" as const,
                      })),
                      timeoutMs: 4_000,
                    }),
                  ]),
            ],
            answerComposer: createAiSdkDeliveryAnswerComposer(
              createGroundedAnswerGeneratorFromEnvironment(environment, (event) =>
                console.info(JSON.stringify(event)),
              ),
              { relevanceProfile },
            ),
            capabilityLedger,
            ...deliveryResponseBudget,
          });
          return createBoundedDeliveryAssistant(assistant, {
            maxConcurrency: configuredInteger(
              "SARATHI_DELIVERY_MAX_CONCURRENCY",
              environment.SARATHI_DELIVERY_MAX_CONCURRENCY,
              defaultDeliveryMaxConcurrency,
              1,
            ),
            maxQueueDepth: configuredInteger(
              "SARATHI_DELIVERY_MAX_QUEUE_DEPTH",
              environment.SARATHI_DELIVERY_MAX_QUEUE_DEPTH,
              defaultDeliveryMaxQueueDepth,
              0,
            ),
          });
        })()
      : undefined;
    const contextAssembler = createAuthorizedContextAssembler(contextSources, supplementalContext);
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
        answerGenerator: createGroundedAnswerGeneratorFromEnvironment(environment, (event) =>
          console.info(JSON.stringify(event)),
        ),
        delivery: { reply: () => Effect.void },
        audit: createPostgresTeamsMentionAudit(openStrategyKernelPostgresDatabase(databaseUrl)),
        helloDiagnosticEnabled: enabled(environment.SARATHI_TEAMS_HELLO_DIAGNOSTIC_ENABLED),
        answerFeedback,
        feedbackGenerationContext: {
          modelName: required("SARATHI_MODEL_NAME", environment.SARATHI_MODEL_NAME),
          reasoningConfiguration:
            environment.SARATHI_MODEL_REASONING_EFFORT?.trim() ||
            environment.SARATHI_MODEL_REASONING_CONFIGURATION?.trim() ||
            "provider_default",
          applicationRevision:
            environment.RAILWAY_GIT_COMMIT_SHA?.trim() ||
            environment.SARATHI_APPLICATION_REVISION?.trim() ||
            "local_unversioned",
          ...(environment.SARATHI_MODEL_PROMPT_REVISION?.trim()
            ? { promptConfigurationRevision: environment.SARATHI_MODEL_PROMPT_REVISION.trim() }
            : {}),
          ...(environment.SARATHI_PRODUCT_REGISTRY_REVISION?.trim()
            ? { productRegistryRevision: environment.SARATHI_PRODUCT_REGISTRY_REVISION.trim() }
            : {}),
        },
        feedbackDiagnostic: (stage, reason) =>
          console.info(
            JSON.stringify({ event: "answer_feedback", stage, outcome: "failed", reason }),
          ),
        ...(deliveryAssistant === undefined || deliveryTimeZone === undefined
          ? {}
          : {
              deliveryAssistant,
              deliveryTimeZone,
            }),
      },
      ready: true,
      checkReadiness: async () => {
        try {
          await graphTokenProvider.getAccessToken();
          if (knowledgeDatabase !== undefined) {
            await knowledgeDatabase.pool.query(
              "select extversion from pg_extension where extname = 'vector'",
            );
            await knowledgeDatabase.pool.query("select 1 from knowledge_passage limit 1");
          }
          return true;
        } catch {
          return false;
        }
      },
    };
  } catch {
    return {
      dependencies: unavailableDependencies(
        "Connected Teams workspace configuration is unavailable; Sarathi will not process this mention.",
      ),
      ready: false,
      checkReadiness: async () => false,
    };
  }
};

const failClosedDependencies = unavailableDependencies(
  "Hosted Teams dependencies are unavailable; Sarathi will not process this mention.",
);

const hasCompleteCommand = (command: TeamsMentionCommand): boolean => {
  const conversationFields: readonly string[] = (() => {
    switch (command.conversation.kind) {
      case "team_channel":
        return [
          command.conversation.tenantId,
          command.conversation.teamId,
          command.conversation.graphTeamId,
          command.conversation.channelId,
        ];
      case "group_chat":
      case "meeting_chat":
      case "personal_chat":
        return [command.conversation.tenantId, command.conversation.chatId];
    }
  })();
  const replyFields =
    command.replyTarget.kind === "channel_thread"
      ? [command.replyTarget.conversationId, command.replyTarget.rootActivityId]
      : [command.replyTarget.conversationId];
  return [
    command.activityId,
    ...conversationFields,
    ...replyFields,
    command.serviceUrl,
    command.caller.entraObjectId,
    command.caller.displayName,
    command.question,
  ].every((value) => value.trim() !== "");
};

type MentionActivity = {
  readonly id?: string | undefined;
  readonly text?: string | undefined;
  readonly recipient?: { readonly id?: string | undefined } | undefined;
  readonly entities?: readonly unknown[] | undefined;
};

type DirectTeamsMentionGate =
  | { readonly kind: "accepted"; readonly question: string }
  | {
      readonly kind: "ignored";
      readonly reason: "missing_recipient" | "missing_matching_mention" | "empty_question";
    };

export type TeamsIngressDiagnosticEvent = {
  readonly event: "teams_ingress";
  readonly stage: "http" | "activity" | "handler" | "feedback";
  readonly outcome: string;
  readonly activityHash?: string;
  readonly reason?: string;
  readonly statusCode?: number;
  readonly missingFields?: readonly string[];
  readonly responseMode?: "fast" | "structured" | "deep_dive";
  readonly responseProduct?:
    | "operational_answer"
    | "period_delivery_brief"
    | "leadership_report"
    | "implementation_investigation";
  readonly elapsedMs?: number;
  readonly acceptancePassed?: boolean;
};

export type TeamsIngressDiagnosticSink = (event: TeamsIngressDiagnosticEvent) => void;

const noTeamsIngressDiagnostics: TeamsIngressDiagnosticSink = () => undefined;

export const createPrivacySafeTeamsIngressDiagnosticSink =
  (write: (line: string) => void = console.info): TeamsIngressDiagnosticSink =>
  (event) => {
    write(JSON.stringify(event));
  };

const activityHash = (activityId: unknown): string | undefined =>
  typeof activityId === "string" && activityId.trim() !== "" ? stableSha256(activityId) : undefined;

const recipientMentionText = (
  entities: readonly unknown[] | undefined,
  recipientId: string,
): string | undefined => {
  for (const entity of entities ?? []) {
    if (typeof entity !== "object" || entity === null) continue;
    const candidate = entity as {
      readonly type?: unknown;
      readonly text?: unknown;
      readonly mentioned?: unknown;
    };
    if (typeof candidate.type !== "string" || candidate.type.toLowerCase() !== "mention") continue;
    if (typeof candidate.mentioned !== "object" || candidate.mentioned === null) continue;
    const mentioned = candidate.mentioned as { readonly id?: unknown };
    if (
      typeof mentioned.id === "string" &&
      mentioned.id.toLowerCase() === recipientId.toLowerCase() &&
      typeof candidate.text === "string" &&
      candidate.text.trim() !== ""
    ) {
      return candidate.text;
    }
  }
  return undefined;
};

export const directTeamsMentionQuestion = (activity: MentionActivity): string | undefined => {
  const gate = directTeamsMentionGate(activity);
  return gate.kind === "accepted" ? gate.question : undefined;
};

const directTeamsMentionGate = (activity: MentionActivity): DirectTeamsMentionGate => {
  const recipientId = activity.recipient?.id;
  if (recipientId === undefined || recipientId.trim() === "") {
    return { kind: "ignored", reason: "missing_recipient" };
  }
  const mentionText = recipientMentionText(activity.entities, recipientId);
  if (mentionText === undefined) {
    return { kind: "ignored", reason: "missing_matching_mention" };
  }
  const question = stripSarathiMention(activity.text ?? "", mentionText);
  return question === ""
    ? { kind: "ignored", reason: "empty_question" }
    : { kind: "accepted", question };
};

export const teamsMentionCommandFromActivity = (
  activity: Activity,
  question: string,
): TeamsMentionCommand => {
  const channelData = activity.channelData as
    | {
        readonly team?: { readonly id?: string; readonly aadGroupId?: string };
        readonly channel?: { readonly id?: string };
        readonly tenant?: { readonly id?: string };
        readonly meeting?: { readonly id?: string };
      }
    | undefined;
  const activityConversation = activity.conversation as
    | {
        readonly id?: string;
        readonly conversationType?: string;
        readonly isGroup?: boolean;
      }
    | undefined;
  const tenantId = channelData?.tenant?.id ?? "";
  const conversationId = activityConversation?.id ?? "";
  const hasTeamChannel =
    channelData?.team?.id !== undefined || channelData?.channel?.id !== undefined;
  const conversationType = activityConversation?.conversationType?.toLowerCase();
  const chatKind =
    channelData?.meeting?.id !== undefined || conversationType === "meeting"
      ? ("meeting_chat" as const)
      : conversationType === "personal" || activityConversation?.isGroup === false
        ? ("personal_chat" as const)
        : ("group_chat" as const);
  const conversation = hasTeamChannel
    ? {
        kind: "team_channel" as const,
        tenantId,
        teamId: channelData?.team?.id ?? "",
        graphTeamId: channelData?.team?.aadGroupId ?? "",
        channelId: channelData?.channel?.id ?? "",
      }
    : {
        kind: chatKind,
        tenantId,
        chatId: conversationId,
      };
  const replyTarget = hasTeamChannel
    ? {
        kind: "channel_thread" as const,
        conversationId,
        rootActivityId: activity.replyToId ?? activity.id ?? "",
      }
    : { kind: "chat" as const, conversationId };
  return {
    activityId: activity.id ?? "",
    conversation,
    replyTarget,
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
};

const feedbackFailureMessage = (reason: string): string => {
  switch (reason) {
    case "unknown_answer":
    case "answer_not_delivered":
      return "That answer is no longer available for feedback.";
    case "actor_not_permitted":
    case "workspace_mismatch":
    case "conversation_mismatch":
      return "You cannot submit feedback for this answer.";
    case "persistence_unavailable":
      return "Sarathi could not save feedback right now. Please try again.";
    default:
      return "Sarathi could not read that feedback. Please try again.";
  }
};

const feedbackActionData = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const data = (value as { readonly data?: unknown }).data;
  return data ?? value;
};

export const handleTeamsAnswerFeedbackAction = async (
  activity: Activity,
  value: unknown,
  dependencies: Pick<TeamsMentionDependencies, "resolver" | "authorizer" | "answerFeedback">,
  diagnostics: TeamsIngressDiagnosticSink = noTeamsIngressDiagnostics,
): Promise<AdaptiveCardPayload> => {
  const hash = activityHash(activity.id);
  const reportFailure = (reason: string): AdaptiveCardPayload => {
    diagnostics({
      event: "teams_ingress",
      stage: "feedback",
      outcome: "denied",
      ...(hash === undefined ? {} : { activityHash: hash }),
      reason,
    });
    return renderAnswerFeedbackFailureCard(feedbackFailureMessage(reason));
  };
  const decoded = decodeAnswerFeedbackAction(feedbackActionData(value));
  if (decoded._tag === "Left") return reportFailure(decoded.left.code);
  if (dependencies.answerFeedback === undefined) return reportFailure("persistence_unavailable");
  const command = teamsMentionCommandFromActivity(activity, "answer feedback");
  try {
    const resolved = await Effect.runPromise(dependencies.resolver.resolve(command));
    if (resolved === undefined) return reportFailure("actor_not_permitted");
    const authorization = await Effect.runPromise(
      dependencies.authorizer.authorizeContext(command, resolved),
    );
    const submitted = await Effect.runPromise(
      dependencies.answerFeedback.submit(decoded.right, {
        workspaceId: resolved.workspaceId,
        actorId: resolved.callerId,
        conversationBoundaryHash: teamsConversationBoundaryHash(command),
        permitted: authorization.allowed,
      }),
    );
    diagnostics({
      event: "teams_ingress",
      stage: "feedback",
      outcome: submitted.idempotent ? "idempotent" : "recorded",
      ...(hash === undefined ? {} : { activityHash: hash }),
    });
    return renderAnswerFeedbackCard(
      { answerId: submitted.answer.id },
      () => crypto.randomUUID(),
      submitted.revision,
    );
  } catch (error) {
    const reason =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "persistence_unavailable";
    return reportFailure(reason);
  }
};

export const createTeamsIngressApplication = (
  dependencies: TeamsMentionDependencies = failClosedDependencies,
  adapter?: CloudAdapter,
  diagnostics: TeamsIngressDiagnosticSink = noTeamsIngressDiagnostics,
): AgentApplication<TurnState> => {
  const application = new AgentApplication({
    storage: new MemoryStorage(),
    ...(adapter === undefined ? {} : { adapter }),
  });
  application.adaptiveCards.actionExecute<unknown>(
    answerFeedbackActionVerb,
    async (context, _state, data) =>
      handleTeamsAnswerFeedbackAction(context.activity, data, dependencies, diagnostics),
  );
  application.onActivity("message", async (context: TurnContext) => {
    const activity = context.activity;
    const hash = activityHash(activity.id);
    const gate = directTeamsMentionGate(activity);
    if (gate.kind === "ignored") {
      diagnostics({
        event: "teams_ingress",
        stage: "activity",
        outcome: "ignored",
        ...(hash === undefined ? {} : { activityHash: hash }),
        reason: gate.reason,
      });
      return;
    }
    const question = gate.question;

    const command = teamsMentionCommandFromActivity(activity, question);
    if (!hasCompleteCommand(command)) {
      const missingFields: string[] = [];
      const recordMissing = (name: string, value: string): void => {
        if (value.trim() === "") missingFields.push(name);
      };
      recordMissing("activityId", command.activityId);
      recordMissing("tenantId", command.conversation.tenantId);
      if ("channelId" in command.conversation) {
        recordMissing("teamId", command.conversation.teamId);
        recordMissing("graphTeamId", command.conversation.graphTeamId);
        recordMissing("channelId", command.conversation.channelId);
      } else {
        recordMissing("chatId", command.conversation.chatId);
      }
      recordMissing("conversationId", command.replyTarget.conversationId);
      if (command.replyTarget.kind === "channel_thread") {
        recordMissing("rootActivityId", command.replyTarget.rootActivityId);
      }
      recordMissing("serviceUrl", command.serviceUrl);
      recordMissing("callerEntraObjectId", command.caller.entraObjectId);
      recordMissing("callerDisplayName", command.caller.displayName);
      recordMissing("question", command.question);
      diagnostics({
        event: "teams_ingress",
        stage: "activity",
        outcome: "ignored",
        ...(hash === undefined ? {} : { activityHash: hash }),
        reason: "incomplete_command",
        missingFields,
      });
      return;
    }
    diagnostics({
      event: "teams_ingress",
      stage: "activity",
      outcome: "accepted",
      ...(hash === undefined ? {} : { activityHash: hash }),
    });
    const turnDependencies: TeamsMentionDependencies = {
      ...dependencies,
      delivery: {
        reply: (_replyCommand, answer, feedback) =>
          Effect.tryPromise({
            try: async () => {
              await context.sendActivity(
                command.replyTarget.kind === "channel_thread"
                  ? sameThreadReplyActivity(
                      command.replyTarget.rootActivityId,
                      answer.text,
                      answer.mentions,
                      feedback,
                    )
                  : sameChatReplyActivity(answer.text, answer.mentions, feedback),
              );
            },
            catch: () => new RepositoryError({ message: "Teams delivery failed" }),
          }),
      },
    };
    try {
      const outcome = await Effect.runPromise(handleTeamsMention(command, turnDependencies));
      const acceptance =
        outcome.kind === "answered" && "acceptance" in outcome.answer
          ? (outcome.answer.acceptance as {
              readonly mode?: unknown;
              readonly product?: unknown;
              readonly elapsedMs?: unknown;
              readonly passed?: unknown;
            })
          : undefined;
      const responseMode =
        acceptance?.mode === "fast" ||
        acceptance?.mode === "structured" ||
        acceptance?.mode === "deep_dive"
          ? acceptance.mode
          : undefined;
      const responseProduct =
        acceptance?.product === "operational_answer" ||
        acceptance?.product === "period_delivery_brief" ||
        acceptance?.product === "leadership_report" ||
        acceptance?.product === "implementation_investigation"
          ? acceptance.product
          : undefined;
      diagnostics({
        event: "teams_ingress",
        stage: "handler",
        outcome: outcome.kind,
        ...(hash === undefined ? {} : { activityHash: hash }),
        ...(responseMode === undefined ? {} : { responseMode }),
        ...(responseProduct === undefined ? {} : { responseProduct }),
        ...(typeof acceptance?.elapsedMs === "number" ? { elapsedMs: acceptance.elapsedMs } : {}),
        ...(typeof acceptance?.passed === "boolean" ? { acceptancePassed: acceptance.passed } : {}),
      });
      if (outcome.kind === "denied") {
        await context.sendActivity(
          command.replyTarget.kind === "channel_thread"
            ? sameThreadReplyActivity(command.replyTarget.rootActivityId, outcome.reason)
            : sameChatReplyActivity(outcome.reason),
        );
      }
    } catch (error) {
      diagnostics({
        event: "teams_ingress",
        stage: "handler",
        outcome: "failed",
        ...(hash === undefined ? {} : { activityHash: hash }),
        reason: error instanceof Error ? error.name : "unknown_error",
      });
      throw error;
    }
  });
  return application;
};

export const sameThreadReplyActivity = (
  replyToId: string,
  text: string,
  mentions: readonly {
    readonly source: "teams";
    readonly externalId: string;
    readonly displayName: string;
  }[] = [],
  feedback?: { readonly answerId: string } | undefined,
): Activity =>
  Activity.fromObject({
    type: ActivityTypes.Message,
    replyToId,
    text,
    ...(feedback === undefined ? {} : { attachments: [renderAnswerFeedbackAttachment(feedback)] }),
    entities: mentions
      .filter(({ displayName }) => text.includes(`<at>${displayName}</at>`))
      .map(({ externalId, displayName }) => ({
        type: "mention",
        mentioned: { id: externalId, name: displayName },
        text: `<at>${displayName}</at>`,
      })),
  });

export const sameChatReplyActivity = (
  text: string,
  mentions: readonly {
    readonly source: "teams";
    readonly externalId: string;
    readonly displayName: string;
  }[] = [],
  feedback?: { readonly answerId: string } | undefined,
): Activity =>
  Activity.fromObject({
    type: ActivityTypes.Message,
    text,
    ...(feedback === undefined ? {} : { attachments: [renderAnswerFeedbackAttachment(feedback)] }),
    entities: mentions
      .filter(({ displayName }) => text.includes(`<at>${displayName}</at>`))
      .map(({ externalId, displayName }) => ({
        type: "mention",
        mentioned: { id: externalId, name: displayName },
        text: `<at>${displayName}</at>`,
      })),
  });

export const startTeamsIngress = (): void => {
  const configuration = teamsIngressConfigurationFromEnvironment();
  const composition = hostedTeamsIngressCompositionFromEnvironment();
  const finance = hostedFinanceReminderCompositionFromEnvironment();
  const continuousSync = startDeliverySyncScheduler();
  const auth = teamsIngressAuthConfiguration(configuration);
  const adapter = new CloudAdapter(auth);
  const diagnostics = createPrivacySafeTeamsIngressDiagnosticSink();
  const application = createTeamsIngressApplication(composition.dependencies, adapter, diagnostics);
  const server = express();
  const platformRuntime = makeSarathiRuntime();
  const platformApp = createApp(platformRuntime);
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
  server.use(createHostedPlatformApiMiddleware(platformApp.fetch));
  server.use(express.json());
  server.post("/api/teams/notifications", (request, response) => {
    const validationToken =
      typeof request.query.validationToken === "string" ? request.query.validationToken : undefined;
    if (validationToken !== undefined && validationToken !== "") {
      response.status(200).type("text/plain").send(validationToken);
      return;
    }
    const clientState = process.env.SARATHI_TEAMS_NOTIFICATION_CLIENT_STATE;
    if (clientState === undefined || clientState.trim() === "") {
      response.status(503).json({ ok: false, error: "notification_ingress_unavailable" });
      return;
    }
    try {
      const batch = parseTeamsChangeNotificationBatch(request.body, clientState);
      response.status(202).json({ ok: true, accepted: batch.notificationCount });
      void (async () => {
        const renewal = batch.includesLifecycleEvent
          ? await runDeliverySyncCommand(["subscriptions", "teams"])
          : undefined;
        const synchronization = await runDeliverySyncCommand([
          "events",
          "teams",
          "--event-id",
          batch.providerEventId,
          "--payload-hash",
          batch.payloadHash,
        ]);
        console.info(
          JSON.stringify({
            event: "teams_change_notification",
            outcome: synchronization.exitCode === 0 ? "accepted" : "failed",
            notificationCount: batch.notificationCount,
            ...(renewal === undefined
              ? {}
              : { renewal: renewal.exitCode === 0 ? "succeeded" : "failed" }),
          }),
        );
      })().catch(() => {
        console.error(
          JSON.stringify({
            event: "teams_change_notification",
            outcome: "failed",
            notificationCount: batch.notificationCount,
          }),
        );
      });
    } catch {
      response.status(400).json({ ok: false, error: "invalid_notification" });
    }
  });
  server.post(
    "/api/messages",
    (request, response, next) => {
      const hash = activityHash(
        typeof request.body === "object" && request.body !== null && "id" in request.body
          ? request.body.id
          : undefined,
      );
      diagnostics({
        event: "teams_ingress",
        stage: "http",
        outcome: "received",
        ...(hash === undefined ? {} : { activityHash: hash }),
      });
      response.once("finish", () => {
        diagnostics({
          event: "teams_ingress",
          stage: "http",
          outcome: "completed",
          ...(hash === undefined ? {} : { activityHash: hash }),
          statusCode: response.statusCode,
        });
      });
      next();
    },
    authorizeJWT(auth),
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
        continuousSync: continuousSync.status(),
      },
    });
  });
  server.post("/internal/delivery/intent/import", async (request, response) => {
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
    let snapshot: ReturnType<typeof parseDeclaredInitiativeSnapshot>;
    try {
      snapshot = parseDeclaredInitiativeSnapshot(request.body);
    } catch {
      response.status(400).json({ ok: false, error: "invalid_declared_initiative_snapshot" });
      return;
    }
    let database: ReturnType<typeof openStrategyKernelPostgresDatabase> | undefined;
    try {
      const workspaceId = required(
        "SARATHI_KNOWLEDGE_WORKSPACE_ID",
        process.env.SARATHI_KNOWLEDGE_WORKSPACE_ID,
      );
      database = openStrategyKernelPostgresDatabase(
        required("SARATHI_STRATEGY_DATABASE_URL", process.env.SARATHI_STRATEGY_DATABASE_URL),
      );
      await applyStrategyKernelPostgresMigrations(database);
      await ensureStrategyKernelWorkspace(database, {
        workspaceId,
        workspaceKey: snapshot.workspaceKey,
        createdAt: new Date().toISOString(),
      });
      const result = await importDeclaredInitiativeSnapshot({
        repository: createPostgresStrategyKernelRepository(database),
        workspaceId,
        expectedWorkspaceKey: snapshot.workspaceKey,
        snapshot,
        importedAt: new Date().toISOString(),
      });
      response.json({ ok: true, result });
    } catch {
      response.status(503).json({ ok: false, error: "declared_initiative_import_unavailable" });
    } finally {
      if (database !== undefined) await closeStrategyKernelPostgresDatabase(database);
    }
  });
  server.get("/internal/delivery/intent/status", async (request, response) => {
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
    let database: ReturnType<typeof openStrategyKernelPostgresDatabase> | undefined;
    try {
      const workspaceId = required(
        "SARATHI_KNOWLEDGE_WORKSPACE_ID",
        process.env.SARATHI_KNOWLEDGE_WORKSPACE_ID,
      );
      database = openStrategyKernelPostgresDatabase(
        required("SARATHI_STRATEGY_DATABASE_URL", process.env.SARATHI_STRATEGY_DATABASE_URL),
      );
      const prefix = `intent:declared:${workspaceId}:`;
      const nodes = (
        await createPostgresStrategyKernelRepository(database).listWorkspaceIntent(workspaceId)
      ).filter((node) => node.id.startsWith(prefix));
      response.json({
        ok: true,
        status: {
          goals: nodes.filter((node) => node.kind === "goal" && node.state !== "archived").length,
          initiatives: nodes.filter(
            (node) => node.kind === "commitment" && node.state !== "archived",
          ).length,
          archived: nodes.filter((node) => node.state === "archived").length,
          updatedAt: nodes
            .map((node) => node.updatedAt)
            .sort()
            .at(-1),
        },
      });
    } catch {
      response.status(503).json({ ok: false, error: "declared_initiative_status_unavailable" });
    } finally {
      if (database !== undefined) await closeStrategyKernelPostgresDatabase(database);
    }
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
      response.json({
        ok: true,
        result: await finance.runShadowAcceptance(kind),
      });
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

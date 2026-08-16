import { Effect } from "effect";
import {
  type CollaborationSourceScope,
  collaborationSourceScopes,
  isCollaborationSourceScope,
} from "../../domain/collaboration-source-scope.ts";
import { RepositoryError } from "../../domain/errors.ts";
import { isSensitivityAtOrBelow, type SensitivityTier } from "../../domain/policy.ts";
import { createProductModelApiSecurity } from "../../infrastructure/auth/product-model-api-security.ts";
import { createGitHubDeliveryQuerySource } from "../../infrastructure/github/index.ts";
import {
  createEmailDeliveryQuerySource,
  createEntraClientCredentialsTokenProvider,
  createTeamsDeliveryQuerySource,
} from "../../infrastructure/graph/index.ts";
import { createJiraDeliveryQuerySource } from "../../infrastructure/jira/index.ts";
import { createDeliveryKnowledgeQuerySource } from "../../infrastructure/knowledge/index.ts";
import {
  createAiSdkDeliveryAnswerComposer,
  createAiSdkKnowledgeEmbedding,
  createGroundedAnswerGeneratorFromEnvironment,
  knowledgeEmbeddingConfigurationFromEnvironment,
} from "../../infrastructure/model/index.ts";
import { deliveryExecutionObserverFromEnvironment } from "../../infrastructure/observability/index.ts";
import {
  createPostgresAnswerFeedbackRepository,
  createPostgresDeliveryQuerySource,
  createPostgresKnowledgeRepository,
  createPostgresProductModelDetailRepository,
  createPostgresProductModelGraphRepository,
  createPostgresStrategyKernelRepository,
  createStrategyKernelDeliveryQuerySource,
  openKnowledgePostgresDatabase,
  readKnowledgePostgresStatus,
} from "../../infrastructure/postgres/index.ts";
import {
  deliveryChannelProjectionFromEnvironment,
  workspaceProjectionDeliveryChannels,
  workspaceProjectionFromEnvironment,
} from "../../infrastructure/teams/index.ts";
import {
  type AnswerFeedbackAggregate,
  createAnswerFeedbackService,
} from "../../modules/answer-feedback/index.ts";
import {
  type CapabilityLedger,
  createDeliveryAssistant,
  createProductCapabilityLedgerProjection,
  createRegistryBackedDeliveryAssistant,
  type DeliveryAssistantAnswer,
  type DeliveryAssistantRequest,
  type DeliveryQuerySource,
  type DeliveryResponseMode,
  type DeliveryResponseProduct,
  deliveryRelevanceProfileFromEnvironment,
  deliveryResponseBudget,
  deliveryResponseModePolicies,
  deliveryResponseProductPolicies,
  evaluateDeliveryCase,
  parseDeliveryEntityCatalog,
  parseDeliveryEvaluationSet,
  selectDeliveryResponseMode,
  selectDeliveryResponseProduct,
  summarizeDeliveryEvaluation,
  validateCapabilityLedger,
} from "../../modules/delivery-intelligence/index.ts";
import {
  createProductModelDetailQueryService,
  createProductModelQueryService,
  parseProductCompletionContracts,
} from "../../modules/product-model/index.ts";
import { loadPlatformConfig } from "../../platform/config.ts";
import { runDeclaredInitiativeCommand } from "./declared-initiative-runtime.ts";
import { runDeliverySyncCommand } from "./delivery-sync-runtime.ts";
import { runRepositoryEffect } from "./effect-repository-promise.ts";
import { runKnowledgeCommand } from "./knowledge-runtime.ts";

type DeliveryCliResult = {
  readonly exitCode: number;
  readonly output: unknown;
};
type DeliveryRuntimeEnvironment = Record<string, string | undefined>;
type DeliveryCliDependencies = {
  readonly answer?:
    | ((request: DeliveryAssistantRequest) => Promise<DeliveryAssistantAnswer>)
    | undefined;
  readonly readStatus?: (() => Promise<unknown>) | undefined;
  readonly runKnowledge?: typeof runKnowledgeCommand | undefined;
  readonly runSync?: typeof runDeliverySyncCommand | undefined;
  readonly runIntent?: typeof runDeclaredInitiativeCommand | undefined;
  readonly feedbackMetrics?:
    | ((workspaceId: string) => Promise<AnswerFeedbackAggregate>)
    | undefined;
};

type JiraProjection = { readonly projectKey: string };
type MailScopeProjection = {
  readonly mailboxId: string;
  readonly mode: "dedicated-mailbox" | "matched";
  readonly routingTerms?: readonly string[] | undefined;
  readonly participantAddresses?: readonly string[] | undefined;
};
type ProductModelActorMapping = {
  readonly requestActorId: string;
  readonly productModelActorId: string;
  readonly productModelAudienceIds: readonly string[];
};

const sensitivities = new Set<SensitivityTier>([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
const responseModes = new Set<DeliveryResponseMode>(["fast", "structured", "deep_dive"]);
const responseProducts = new Set<DeliveryResponseProduct>([
  "operational_answer",
  "period_delivery_brief",
  "leadership_report",
  "implementation_investigation",
]);

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required.`);
  return value;
};

const parseJson = <Value>(name: string, value: string | undefined): Value => {
  try {
    return JSON.parse(required(name, value)) as Value;
  } catch {
    throw new Error(`${name} must contain valid delivery configuration JSON.`);
  }
};

const permittedSourceScopesFrom = (
  args: readonly string[],
  environment: DeliveryRuntimeEnvironment,
): readonly CollaborationSourceScope[] | undefined => {
  const serialized =
    option(args, "--source-scopes-json") ??
    environment.SARATHI_DELIVERY_PERMITTED_SOURCE_SCOPES_JSON;
  if (serialized === undefined) return undefined;
  const decoded = parseJson<unknown>("--source-scopes-json", serialized);
  if (
    !Array.isArray(decoded) ||
    decoded.length === 0 ||
    decoded.length > collaborationSourceScopes.length ||
    !decoded.every(isCollaborationSourceScope) ||
    new Set(decoded).size !== decoded.length
  )
    throw new Error(
      "--source-scopes-json must contain a unique non-empty array of supported source scopes.",
    );
  return decoded;
};

const option = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

const withoutOption = (args: readonly string[], name: string): readonly string[] => {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      index += 1;
      continue;
    }
    const value = args[index];
    if (value !== undefined) result.push(value);
  }
  return result;
};

const queryRequest = (
  args: readonly string[],
  environment: DeliveryRuntimeEnvironment,
): DeliveryAssistantRequest => {
  const maximumSensitivity =
    option(args, "--maximum-sensitivity") ??
    environment.SARATHI_DELIVERY_MAXIMUM_SENSITIVITY ??
    "internal";
  if (!sensitivities.has(maximumSensitivity as SensitivityTier))
    throw new Error("--maximum-sensitivity is invalid.");
  const responseMode =
    option(args, "--response-mode") ?? environment.SARATHI_DELIVERY_RESPONSE_MODE;
  if (responseMode !== undefined && !responseModes.has(responseMode as DeliveryResponseMode))
    throw new Error("--response-mode must be fast, structured, or deep_dive.");
  const responseProduct =
    option(args, "--response-product") ?? environment.SARATHI_DELIVERY_RESPONSE_PRODUCT;
  if (
    responseProduct !== undefined &&
    !responseProducts.has(responseProduct as DeliveryResponseProduct)
  )
    throw new Error(
      "--response-product must be operational_answer, period_delivery_brief, leadership_report, or implementation_investigation.",
    );
  const actorId = required(
    "--actor-id",
    option(args, "--actor-id") ?? environment.SARATHI_DELIVERY_ACTOR_ID,
  );
  const financeActorIds = new Set(
    environment.SARATHI_DELIVERY_FINANCE_ACTOR_IDS_JSON === undefined
      ? []
      : parseJson<readonly string[]>(
          "SARATHI_DELIVERY_FINANCE_ACTOR_IDS_JSON",
          environment.SARATHI_DELIVERY_FINANCE_ACTOR_IDS_JSON,
        ),
  );
  const audienceIds =
    environment.SARATHI_KNOWLEDGE_AUDIENCE_IDS_JSON === undefined
      ? []
      : parseJson<readonly string[]>(
          "SARATHI_KNOWLEDGE_AUDIENCE_IDS_JSON",
          environment.SARATHI_KNOWLEDGE_AUDIENCE_IDS_JSON,
        );
  const permittedSourceScopes = permittedSourceScopesFrom(args, environment);
  return {
    workspaceId: required(
      "SARATHI_KNOWLEDGE_WORKSPACE_ID",
      environment.SARATHI_KNOWLEDGE_WORKSPACE_ID,
    ),
    actorId,
    audienceIds,
    ...(permittedSourceScopes === undefined ? {} : { permittedSourceScopes }),
    maximumSensitivity: maximumSensitivity as SensitivityTier,
    financeAccess: financeActorIds.has(actorId),
    requestedAt: option(args, "--requested-at") ?? new Date().toISOString(),
    timeZone: required(
      "--time-zone",
      option(args, "--time-zone") ?? environment.SARATHI_WORKSPACE_TIMEZONE,
    ),
    question: required("--question", option(args, "--question")),
    ...(responseMode === undefined ? {} : { responseMode: responseMode as DeliveryResponseMode }),
    ...(responseProduct === undefined
      ? {}
      : { responseProduct: responseProduct as DeliveryResponseProduct }),
  };
};

const liveSources = (
  environment: DeliveryRuntimeEnvironment,
  actorId: string,
): readonly DeliveryQuerySource[] => {
  const workspaceId = required(
    "SARATHI_KNOWLEDGE_WORKSPACE_ID",
    environment.SARATHI_KNOWLEDGE_WORKSPACE_ID,
  );
  const repositories =
    environment.SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON === undefined
      ? []
      : parseJson<readonly string[]>(
          "SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON",
          environment.SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON,
        );
  const repositoryScopes =
    environment.SARATHI_GITHUB_REPOSITORY_SCOPES_JSON === undefined
      ? []
      : parseJson<
          readonly {
            readonly owner: string;
            readonly ownerType: "org" | "user";
            readonly repositoryNamePrefix?: string | undefined;
          }[]
        >(
          "SARATHI_GITHUB_REPOSITORY_SCOPES_JSON",
          environment.SARATHI_GITHUB_REPOSITORY_SCOPES_JSON,
        );
  const token = required("GITHUB_TOKEN", environment.GITHUB_TOKEN);
  const entityCatalog = parseDeliveryEntityCatalog(
    environment.SARATHI_DELIVERY_ENTITY_CATALOG_JSON,
  );
  const jira = parseJson<JiraProjection>(
    "SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON",
    environment.SARATHI_KNOWLEDGE_JIRA_CONFIG_JSON,
  );
  const allowedActorIds = new Set([actorId]);
  const sources: DeliveryQuerySource[] = [
    createGitHubDeliveryQuerySource({
      token,
      workspaceId,
      allowedActorIds,
      allowedRepositories: repositories,
      repositoryScopes,
      entityCatalog,
      timeoutMs: 4_000,
    }),
    createJiraDeliveryQuerySource({
      baseUrl: required("JIRA_BASE_URL", environment.JIRA_BASE_URL),
      email: required("JIRA_EMAIL", environment.JIRA_EMAIL),
      apiToken: required("JIRA_API_TOKEN", environment.JIRA_API_TOKEN),
      workspaceId,
      allowedActorIds,
      projectKeys: [jira.projectKey],
      timeoutMs: 4_000,
    }),
  ];
  if (
    environment.SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON === undefined ||
    environment.MICROSOFT_APP_TENANT_ID === undefined ||
    environment.MICROSOFT_APP_ID === undefined ||
    environment.MICROSOFT_APP_PASSWORD === undefined
  )
    return sources;
  const projection = workspaceProjectionFromEnvironment(environment);
  const ingressChannels = workspaceProjectionDeliveryChannels(projection, workspaceId, actorId);
  const channels = deliveryChannelProjectionFromEnvironment(
    environment,
    ingressChannels.map((channel) => ({
      graphTeamId: channel.graphTeamId,
      channelId: channel.channelId,
      workspaceId: channel.workspaceId,
      scope: channel.scope,
      sensitivity: channel.sensitivity,
    })),
  ).filter((channel) => channel.workspaceId === workspaceId);
  const tokenProvider = createEntraClientCredentialsTokenProvider({
    tenantId: required("MICROSOFT_APP_TENANT_ID", environment.MICROSOFT_APP_TENANT_ID),
    clientId: required("MICROSOFT_APP_ID", environment.MICROSOFT_APP_ID),
    clientSecret: required("MICROSOFT_APP_PASSWORD", environment.MICROSOFT_APP_PASSWORD),
  });
  sources.push(
    createTeamsDeliveryQuerySource({
      tokenProvider,
      botApplicationId: environment.MICROSOFT_APP_ID,
      channels: channels.map((channel) => ({
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
  );
  if (environment.SARATHI_PROJECT_MAIL_SCOPES_JSON !== undefined) {
    const scopes = parseJson<readonly MailScopeProjection[]>(
      "SARATHI_PROJECT_MAIL_SCOPES_JSON",
      environment.SARATHI_PROJECT_MAIL_SCOPES_JSON,
    );
    sources.push(
      createEmailDeliveryQuerySource({
        tokenProvider,
        mailScopes: scopes.map((scope) => ({
          ...scope,
          workspaceId,
          allowedActorIds,
          sensitivity: "internal",
        })),
        timeoutMs: 4_000,
      }),
    );
  }
  return sources;
};

const answerFromRuntime = async (
  request: DeliveryAssistantRequest,
  environment: DeliveryRuntimeEnvironment,
): Promise<DeliveryAssistantAnswer> => {
  const responseProduct = selectDeliveryResponseProduct(request.question, request.responseProduct);
  const responseMode = selectDeliveryResponseMode(
    request.question,
    request.responseMode,
    responseProduct,
  );
  const productMode = deliveryResponseProductPolicies[responseProduct].responseMode;
  if (request.responseMode === undefined && responseMode !== productMode)
    throw new Error("Delivery response product and mode selection diverged.");
  const queryBudgetMs = deliveryResponseModePolicies[responseMode].sourceTimeoutMs;
  const opened = openKnowledgePostgresDatabase(
    required("SARATHI_STRATEGY_DATABASE_URL", environment.SARATHI_STRATEGY_DATABASE_URL),
    queryBudgetMs,
  );
  const entityCatalog = parseDeliveryEntityCatalog(
    environment.SARATHI_DELIVERY_ENTITY_CATALOG_JSON,
  );
  const capabilityLedger =
    environment.SARATHI_DELIVERY_CAPABILITY_LEDGER_JSON === undefined
      ? undefined
      : validateCapabilityLedger(
          parseJson<CapabilityLedger>(
            "SARATHI_DELIVERY_CAPABILITY_LEDGER_JSON",
            environment.SARATHI_DELIVERY_CAPABILITY_LEDGER_JSON,
          ),
        );
  const completionContracts =
    environment.SARATHI_NAMED_PRODUCT_COMPLETION_CONTRACTS_JSON === undefined
      ? undefined
      : parseProductCompletionContracts(
          parseJson<unknown>(
            "SARATHI_NAMED_PRODUCT_COMPLETION_CONTRACTS_JSON",
            environment.SARATHI_NAMED_PRODUCT_COMPLETION_CONTRACTS_JSON,
          ),
        );
  const productModelActorMappings =
    environment.SARATHI_DELIVERY_PRODUCT_MODEL_ACTOR_MAPPINGS_JSON === undefined
      ? []
      : parseJson<readonly ProductModelActorMapping[]>(
          "SARATHI_DELIVERY_PRODUCT_MODEL_ACTOR_MAPPINGS_JSON",
          environment.SARATHI_DELIVERY_PRODUCT_MODEL_ACTOR_MAPPINGS_JSON,
        );
  const platformConfig = await runRepositoryEffect(loadPlatformConfig(environment));
  const relevanceProfile = deliveryRelevanceProfileFromEnvironment(environment);
  const productModelConfiguration = platformConfig.productModel;
  const productOpened =
    productModelConfiguration === undefined ||
    productModelConfiguration.databaseUrl ===
      required("SARATHI_STRATEGY_DATABASE_URL", environment.SARATHI_STRATEGY_DATABASE_URL)
      ? undefined
      : openKnowledgePostgresDatabase(productModelConfiguration.databaseUrl, queryBudgetMs);
  const productDatabase = productOpened?.database ?? opened.database;
  const executionObserver = deliveryExecutionObserverFromEnvironment(environment);
  try {
    const sources = [
      createPostgresDeliveryQuerySource(opened.database, { entityCatalog }),
      createStrategyKernelDeliveryQuerySource({
        repository: createPostgresStrategyKernelRepository(opened.pool),
        workspaceId: request.workspaceId,
        allowedActorIds: new Set([request.actorId]),
      }),
      createDeliveryKnowledgeQuerySource({
        repository: createPostgresKnowledgeRepository(opened.database),
        embeddings: createAiSdkKnowledgeEmbedding(
          knowledgeEmbeddingConfigurationFromEnvironment(environment),
        ),
        workspaceId: request.workspaceId,
        allowedActorIds: new Set([request.actorId]),
        audienceIds: request.audienceIds ?? [],
        relevanceProfile,
        allowedGitHubRepositories:
          environment.SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON === undefined
            ? []
            : parseJson<readonly string[]>(
                "SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON",
                environment.SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON,
              ),
      }),
      ...liveSources(environment, request.actorId),
    ];
    const configuration = {
      sources,
      answerComposer: createAiSdkDeliveryAnswerComposer(
        createGroundedAnswerGeneratorFromEnvironment(environment),
        { relevanceProfile },
      ),
      capabilityLedger,
      executionObserver,
      ...deliveryResponseBudget,
    };
    const assistant = (() => {
      if (productModelConfiguration === undefined) return createDeliveryAssistant(configuration);
      const mappedActorId =
        productModelActorMappings.find(({ requestActorId }) => requestActorId === request.actorId)
          ?.productModelActorId ?? request.actorId;
      const actorMapping = productModelActorMappings.find(
        ({ requestActorId }) => requestActorId === request.actorId,
      );
      const principal = productModelConfiguration.principals.find(
        (candidate) =>
          candidate.workspaceId === request.workspaceId && candidate.actorId === mappedActorId,
      );
      if (principal === undefined) return createDeliveryAssistant(configuration);
      const security = createProductModelApiSecurity(productModelConfiguration.principals);
      const graphRepository = createPostgresProductModelGraphRepository(productDatabase);
      const detailsRepository = createPostgresProductModelDetailRepository(productDatabase);
      const projection = createProductCapabilityLedgerProjection({
        queries: createProductModelQueryService(security.queries, graphRepository),
        details: createProductModelDetailQueryService(
          security.queries,
          graphRepository,
          detailsRepository,
        ),
        contextFor: (assistantRequest) => ({
          organizationId: principal.organizationId,
          workspaceId: assistantRequest.workspaceId,
          actorId: principal.actorId,
          trustTier: principal.trustTier,
          effectiveAudience: principal.effectiveAudience,
          maximumSensitivity: isSensitivityAtOrBelow(
            assistantRequest.maximumSensitivity,
            principal.maximumSensitivity,
          )
            ? assistantRequest.maximumSensitivity
            : principal.maximumSensitivity,
          modelEgress: principal.modelEgress,
          permittedCorpusScopes: principal.permittedCorpusScopes,
          requestId: crypto.randomUUID(),
          surface: "internal",
        }),
        legacyLedger: capabilityLedger,
        ...(completionContracts === undefined ? {} : { completionContracts }),
        authorizeContextDelegation: (assistantRequest, context) =>
          actorMapping?.requestActorId === assistantRequest.actorId &&
          actorMapping.productModelActorId === context.actorId &&
          actorMapping.productModelAudienceIds.length === context.effectiveAudience.length &&
          actorMapping.productModelAudienceIds.every((audienceId) =>
            context.effectiveAudience.includes(audienceId),
          ),
      });
      return createRegistryBackedDeliveryAssistant(configuration, projection);
    })();
    return await runRepositoryEffect(assistant.answer(request));
  } finally {
    await productOpened?.pool.end();
    await opened.pool.end();
  }
};

const deliveryStatus = async (environment: DeliveryRuntimeEnvironment): Promise<unknown> =>
  runRepositoryEffect(
    readKnowledgePostgresStatus(
      required("SARATHI_STRATEGY_DATABASE_URL", environment.SARATHI_STRATEGY_DATABASE_URL),
    ),
  );

const deliveryFeedbackMetrics = async (
  workspaceId: string,
  environment: DeliveryRuntimeEnvironment,
): Promise<AnswerFeedbackAggregate> => {
  const opened = openKnowledgePostgresDatabase(
    required("SARATHI_STRATEGY_DATABASE_URL", environment.SARATHI_STRATEGY_DATABASE_URL),
  );
  try {
    const service = createAnswerFeedbackService(
      createPostgresAnswerFeedbackRepository(opened.database),
    );
    return await Effect.runPromise(service.metrics(workspaceId));
  } finally {
    await opened.pool.end();
  }
};

export const runDeliveryCommand = async (
  args: readonly string[],
  environment: DeliveryRuntimeEnvironment = process.env,
  dependencies: DeliveryCliDependencies = {},
): Promise<DeliveryCliResult> => {
  try {
    if (args[0] === "intent")
      return (dependencies.runIntent ?? runDeclaredInitiativeCommand)(args.slice(1), environment);
    if (args[0] === "sync")
      return (dependencies.runSync ?? runDeliverySyncCommand)(args.slice(1), environment);
    if (args[0] === "status")
      return {
        exitCode: 0,
        output: {
          ok: true,
          operation: "delivery-status",
          status: await (dependencies.readStatus ?? (() => deliveryStatus(environment)))(),
        },
      };
    if (args[0] === "feedback" && args[1] === "metrics") {
      const workspaceId = required(
        "--workspace-id",
        option(args, "--workspace-id") ?? environment.SARATHI_KNOWLEDGE_WORKSPACE_ID,
      );
      return {
        exitCode: 0,
        output: {
          ok: true,
          operation: "delivery-feedback-metrics",
          workspaceId,
          report: await (
            dependencies.feedbackMetrics ??
            ((requestedWorkspaceId) => deliveryFeedbackMetrics(requestedWorkspaceId, environment))
          )(workspaceId),
        },
      };
    }
    if (["ingest", "reconcile", "rebuild"].includes(args[0] ?? "")) {
      const operation = args[0] ?? "";
      const source = operation === "rebuild" ? "all" : args[1];
      if (source !== "jira" && source !== "vault" && source !== "all")
        throw new Error("delivery ingest/reconcile requires jira, vault, or all.");
      const knowledge = await (dependencies.runKnowledge ?? runKnowledgeCommand)(
        [operation === "ingest" ? "ingest" : "reconcile", source],
        environment,
      );
      return {
        exitCode: knowledge.exitCode,
        output:
          knowledge.exitCode === 0
            ? {
                ok: true,
                operation: `delivery-${operation}`,
                mode: operation === "rebuild" ? "non-destructive-reconcile" : operation,
                result: knowledge.output,
              }
            : knowledge.output,
      };
    }
    if (args[0] === "evaluate") {
      const evaluationSet = parseDeliveryEvaluationSet(
        parseJson<unknown>(
          "--set-json",
          option(args, "--set-json") ?? environment.SARATHI_DELIVERY_EVALUATION_SET_JSON,
        ),
      );
      const answer = dependencies.answer ?? ((input) => answerFromRuntime(input, environment));
      const commonArgs = withoutOption(
        withoutOption(withoutOption(args.slice(1), "--set-json"), "--question"),
        "--response-mode",
      );
      const results = [];
      for (const evaluationCase of evaluationSet.cases) {
        const request = queryRequest(
          [
            ...commonArgs,
            "--question",
            evaluationCase.question,
            ...(evaluationCase.responseMode === undefined
              ? []
              : ["--response-mode", evaluationCase.responseMode]),
          ],
          environment,
        );
        try {
          results.push(
            evaluateDeliveryCase(evaluationCase, {
              kind: "answer",
              answer: await answer(request),
            }),
          );
        } catch (error) {
          results.push(
            evaluateDeliveryCase(evaluationCase, {
              kind: "failure",
              ...(error instanceof RepositoryError && error.operation !== undefined
                ? { operation: error.operation }
                : {}),
            }),
          );
        }
      }
      const report = summarizeDeliveryEvaluation(evaluationSet, results);
      return {
        exitCode: report.passed ? 0 : 1,
        output: {
          ok: report.passed,
          operation: "delivery-evaluate",
          report,
        },
      };
    }
    if (args[0] === "query") {
      const request = queryRequest(args, environment);
      const answer = await (
        dependencies.answer ?? ((input) => answerFromRuntime(input, environment))
      )(request);
      if (answer.status === "failed")
        return {
          exitCode: 1,
          output: {
            ok: false,
            operation: "delivery-query",
            errorCode: answer.failure?.code ?? "SARATHI-REPORT-COMPOSITION-FAILED",
            failureClassification: answer.failure?.classification,
            failureDiagnosticCode: answer.failure?.diagnosticCode,
            correlationCode: answer.failure?.correlationCode,
            answer: {
              text: answer.text,
              citations: [],
              status: answer.status,
              responseMode: answer.responseMode,
              responseProduct: answer.responseProduct,
              acceptance: answer.acceptance,
            },
          },
        };
      return {
        exitCode: 0,
        output: {
          ok: true,
          operation: "delivery-query",
          answer: {
            text: answer.text,
            citations: answer.citations,
            status: answer.status,
            unavailableSources: answer.unavailableSources,
            conflicts: answer.completionAssessment?.conflicts.length ?? answer.conflicts.length,
            responseMode: answer.responseMode,
            responseProduct: answer.responseProduct,
            acceptance: answer.acceptance,
            ...(answer.completionAssessment === undefined
              ? {}
              : { completionAssessment: answer.completionAssessment }),
          },
          intents: answer.plan.intents,
        },
      };
    }
    return {
      exitCode: 2,
      output: {
        ok: false,
        message:
          "Use delivery status, feedback metrics --workspace-id <id>, intent import|status, sync backfill|events|reconcile|status, ingest|reconcile jira|vault|all, rebuild, evaluate --set-json <json> --actor-id <id> --time-zone <iana-zone> [--source-scopes-json <json>], or query --question <text> --actor-id <id> --time-zone <iana-zone> [--response-mode fast|structured|deep_dive] [--source-scopes-json <json>].",
      },
    };
  } catch (error) {
    return {
      exitCode: 1,
      output: {
        ok: false,
        message: "Delivery operation failed; inspect privacy-safe service diagnostics.",
        ...(error instanceof RepositoryError && error.operation !== undefined
          ? { failureOperation: error.operation }
          : {}),
      },
    };
  }
};

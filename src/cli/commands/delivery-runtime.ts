import { Effect } from "effect";
import type { SensitivityTier } from "../../domain/policy.ts";
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
import {
  createPostgresDeliveryQuerySource,
  createPostgresKnowledgeRepository,
  openKnowledgePostgresDatabase,
  readKnowledgePostgresStatus,
} from "../../infrastructure/postgres/index.ts";
import { workspaceProjectionFromEnvironment } from "../../infrastructure/teams/index.ts";
import {
  createDeliveryAssistant,
  type DeliveryAssistantAnswer,
  type DeliveryAssistantRequest,
  type DeliveryQuerySource,
} from "../../modules/delivery-intelligence/index.ts";
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
};

type JiraProjection = { readonly projectKey: string };
type MailScopeProjection = {
  readonly mailboxId: string;
  readonly mode: "dedicated-mailbox" | "matched";
  readonly routingTerms?: readonly string[] | undefined;
  readonly participantAddresses?: readonly string[] | undefined;
};

const sensitivities = new Set<SensitivityTier>([
  "public",
  "internal",
  "confidential",
  "restricted",
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

const option = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
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
  return {
    workspaceId: required(
      "SARATHI_KNOWLEDGE_WORKSPACE_ID",
      environment.SARATHI_KNOWLEDGE_WORKSPACE_ID,
    ),
    actorId,
    maximumSensitivity: maximumSensitivity as SensitivityTier,
    financeAccess: financeActorIds.has(actorId),
    requestedAt: option(args, "--requested-at") ?? new Date().toISOString(),
    timeZone: required(
      "--time-zone",
      option(args, "--time-zone") ?? environment.SARATHI_WORKSPACE_TIMEZONE,
    ),
    question: required("--question", option(args, "--question")),
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
  const repositories = parseJson<readonly string[]>(
    "SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON",
    environment.SARATHI_GITHUB_ALLOWED_REPOSITORIES_JSON,
  );
  const token = required("GITHUB_TOKEN", environment.GITHUB_TOKEN);
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
  const channels = projection.channels.filter(
    (channel) =>
      channel.workspaceId === workspaceId &&
      channel.actors.some((actor) => actor.actorId === actorId),
  );
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
  const opened = openKnowledgePostgresDatabase(
    required("SARATHI_STRATEGY_DATABASE_URL", environment.SARATHI_STRATEGY_DATABASE_URL),
  );
  try {
    const audienceIds = parseJson<readonly string[]>(
      "SARATHI_KNOWLEDGE_AUDIENCE_IDS_JSON",
      environment.SARATHI_KNOWLEDGE_AUDIENCE_IDS_JSON,
    );
    return await Effect.runPromise(
      createDeliveryAssistant({
        sources: [
          createPostgresDeliveryQuerySource(opened.database),
          createDeliveryKnowledgeQuerySource({
            repository: createPostgresKnowledgeRepository(opened.database),
            embeddings: createAiSdkKnowledgeEmbedding(
              knowledgeEmbeddingConfigurationFromEnvironment(environment),
            ),
            workspaceId: request.workspaceId,
            allowedActorIds: new Set([request.actorId]),
            audienceIds,
          }),
          ...liveSources(environment, request.actorId),
        ],
        answerComposer: createAiSdkDeliveryAnswerComposer(
          createGroundedAnswerGeneratorFromEnvironment(environment),
        ),
        sourceTimeoutMs: 3_000,
        compositionTimeoutMs: 2_500,
        totalBudgetMs: 6_500,
      }).answer(request),
    );
  } finally {
    await opened.pool.end();
  }
};

const deliveryStatus = async (environment: DeliveryRuntimeEnvironment): Promise<unknown> =>
  Effect.runPromise(
    readKnowledgePostgresStatus(
      required("SARATHI_STRATEGY_DATABASE_URL", environment.SARATHI_STRATEGY_DATABASE_URL),
    ),
  );

export const runDeliveryCommand = async (
  args: readonly string[],
  environment: DeliveryRuntimeEnvironment = process.env,
  dependencies: DeliveryCliDependencies = {},
): Promise<DeliveryCliResult> => {
  try {
    if (args[0] === "status")
      return {
        exitCode: 0,
        output: {
          ok: true,
          operation: "delivery-status",
          status: await (dependencies.readStatus ?? (() => deliveryStatus(environment)))(),
        },
      };
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
    if (args[0] === "query") {
      const request = queryRequest(args, environment);
      const answer = await (
        dependencies.answer ?? ((input) => answerFromRuntime(input, environment))
      )(request);
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
            conflicts: answer.conflicts.length,
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
          "Use delivery status, ingest|reconcile jira|vault|all, rebuild, or query --question <text> --actor-id <id> --time-zone <iana-zone>.",
      },
    };
  } catch {
    return {
      exitCode: 1,
      output: {
        ok: false,
        message: "Delivery operation failed; inspect privacy-safe service diagnostics.",
      },
    };
  }
};

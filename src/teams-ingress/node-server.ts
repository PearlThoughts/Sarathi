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
  createVaultProjectionReader,
  vaultProjectionFromEnvironment,
} from "../infrastructure/vault/index.ts";
import {
  type ComplianceReminderRequest,
  runComplianceReminder,
  startComplianceReminderScheduler,
} from "../modules/compliance-reminders/index.ts";
import {
  createAuthorizedContextAssembler,
  handleTeamsMention,
  stripSarathiMention,
  type TeamsMentionDependencies,
} from "../modules/teams-mention/index.ts";

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
});

export type HostedTeamsIngressComposition = {
  readonly dependencies: TeamsMentionDependencies;
  readonly ready: boolean;
  readonly checkReadiness: () => Promise<boolean>;
};

export type HostedFinanceReminderComposition = {
  readonly enabled: boolean;
  readonly run: (request: ComplianceReminderRequest) => Promise<unknown>;
  readonly start: () => { readonly stop: () => void };
};

const booleanValue = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";

export const hostedFinanceReminderCompositionFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): HostedFinanceReminderComposition => {
  const unavailableRun = async (): Promise<never> => {
    throw new Error("Finance reminder configuration is unavailable.");
  };
  try {
    const enabled = booleanValue(environment.SARATHI_REMINDERS_ENABLED);
    const workspaceId = required(
      "SARATHI_REMINDER_WORKSPACE_ID",
      environment.SARATHI_REMINDER_WORKSPACE_ID,
    );
    const schedule = {
      enabled,
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
        labels: required(
          "SARATHI_COMPLIANCE_JIRA_LABELS",
          environment.SARATHI_COMPLIANCE_JIRA_LABELS,
        )
          .split(",")
          .map((label) => label.trim())
          .filter((label) => label !== ""),
      }),
      delivery: createTeamsProactiveReminderDelivery({
        chatId: required("SARATHI_DEFAULT_CHAT_ID", environment.SARATHI_DEFAULT_CHAT_ID),
        tokenProvider,
      }),
      audit: createPostgresComplianceReminderAudit(database),
    };
    const run = (request: ComplianceReminderRequest): Promise<unknown> =>
      Effect.runPromise(runComplianceReminder(request, dependencies));
    return {
      enabled,
      run,
      start: () => startComplianceReminderScheduler(schedule, run),
    };
  } catch {
    return { enabled: false, run: unavailableRun, start: () => ({ stop: () => undefined }) };
  }
};

export const hostedTeamsIngressCompositionFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): HostedTeamsIngressComposition => {
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
        reader: createVaultProjectionReader(vaultProjectionFromEnvironment(environment)),
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
    const outcome = await Effect.runPromise(handleTeamsMention(command, dependencies));
    if (outcome.kind === "answered") await context.sendActivity(outcome.answer.text);
    if (outcome.kind === "denied") await context.sendActivity(outcome.reason);
  });
  return application;
};

export const startTeamsIngress = (): void => {
  const configuration = teamsIngressConfigurationFromEnvironment();
  const composition = hostedTeamsIngressCompositionFromEnvironment();
  const finance = hostedFinanceReminderCompositionFromEnvironment();
  const adapter = new CloudAdapter(authConfiguration(configuration));
  const application = createTeamsIngressApplication(composition.dependencies, adapter);
  const server = express();
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
    const ready = composition.ready && (await composition.checkReadiness());
    response.status(ready ? 200 : 503).json({ ready });
  });
  server.listen(Number.parseInt(process.env.PORT ?? "3978", 10));
  if (finance.enabled) finance.start();
};

if (import.meta.main) {
  startTeamsIngress();
}

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
import {
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

const failClosedDependencies: TeamsMentionDependencies = {
  resolver: { resolve: () => Effect.succeed(undefined) },
  authorizer: { authorizeContext: () => Effect.succeed({ allowed: false }) },
  contextAssembler: { assemble: () => Effect.die("unreachable") },
  answerGenerator: { generate: () => Effect.die("unreachable") },
  delivery: { reply: () => Effect.void },
  audit: {
    acquireLease: () => Effect.succeed({ kind: "acquired", attempt: 1 }),
    markDelivered: () => Effect.void,
    markFailed: () => Effect.void,
  },
};

export const createTeamsIngressApplication = (
  dependencies: TeamsMentionDependencies = failClosedDependencies,
): AgentApplication<TurnState> => {
  const application = new AgentApplication({ storage: new MemoryStorage() });
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
    if (Object.values(command).some((value) => value === "")) return;
    const outcome = await Effect.runPromise(handleTeamsMention(command, dependencies));
    if (outcome.kind === "answered") await context.sendActivity(outcome.answer.text);
    if (outcome.kind === "denied") await context.sendActivity(outcome.reason);
  });
  return application;
};

export const startTeamsIngress = (): void => {
  const configuration = teamsIngressConfigurationFromEnvironment();
  const adapter = new CloudAdapter(authConfiguration(configuration));
  const application = createTeamsIngressApplication();
  const server = express();
  server.use(express.json());
  server.use(authorizeJWT(authConfiguration(configuration)));
  server.post("/api/messages", async (request, response) => {
    await adapter.process(request, response, async (context) => application.run(context));
  });
  server.get("/health", (_request, response) =>
    response.json({ status: "ok", service: "sarathi" }),
  );
  server.listen(Number.parseInt(process.env.PORT ?? "3978", 10));
};

if (import.meta.main) {
  startTeamsIngress();
}

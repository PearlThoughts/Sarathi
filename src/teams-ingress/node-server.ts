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
import {
  createWorkspaceProjectionResolver,
  workspaceProjectionFromEnvironment,
} from "../infrastructure/teams/workspace-projection-resolver.ts";
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
};

export const hostedTeamsIngressCompositionFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): HostedTeamsIngressComposition => {
  try {
    const resolver = createWorkspaceProjectionResolver(
      workspaceProjectionFromEnvironment(environment),
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
                resolved.boundary.modelEgress === "allow" &&
                !resolved.boundary.requiresHumanApproval,
            }),
        },
        contextAssembler: {
          assemble: () =>
            unavailable(
              "Approved context assembly is not configured; Sarathi will not retrieve context.",
            ),
        },
        answerGenerator: {
          generate: () =>
            unavailable(
              "Approved answer generation is not configured; Sarathi will not generate a response.",
            ),
        },
        delivery: { reply: () => Effect.void },
        audit: {
          acquireLease: () => Effect.succeed({ kind: "acquired", attempt: 1 }),
          markDelivered: () => Effect.void,
          markFailed: () => Effect.void,
        },
      },
      ready: false,
    };
  } catch {
    return {
      dependencies: unavailableDependencies(
        "Approved Teams workspace configuration is unavailable; Sarathi will not process this mention.",
      ),
      ready: false,
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
  const adapter = new CloudAdapter(authConfiguration(configuration));
  const application = createTeamsIngressApplication(composition.dependencies);
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
  server.get("/ready", (_request, response) =>
    response.status(composition.ready ? 200 : 503).json({ ready: composition.ready }),
  );
  server.listen(Number.parseInt(process.env.PORT ?? "3978", 10));
};

if (import.meta.main) {
  startTeamsIngress();
}

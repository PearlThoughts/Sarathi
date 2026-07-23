import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type {
  SynchronizationControlRepository,
  SynchronizationSubscription,
} from "../../modules/knowledge-layer/index.ts";
import type { GraphAccessTokenProvider } from "./entra-token-provider.ts";
import type { TeamsKnowledgeChannel } from "./teams-knowledge-source.ts";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type TeamsNotificationSubscriptionConfiguration = {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly tokenProvider: GraphAccessTokenProvider;
  readonly controlRepository: SynchronizationControlRepository;
  readonly notificationUrl: string;
  readonly lifecycleNotificationUrl: string;
  readonly clientState: string;
  readonly lifetimeMinutes?: number | undefined;
  readonly renewalLeadMinutes?: number | undefined;
  readonly now?: (() => Date) | undefined;
  readonly fetcher?: Fetcher | undefined;
};

export type TeamsProviderSubscription = {
  readonly id: string;
  readonly expiresAt: string;
};

type GraphSubscription = {
  readonly id?: string;
  readonly expirationDateTime?: string;
};

const validatedHttpsUrl = (name: string, value: string): string => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "")
    throw new Error(`${name} must be an HTTPS URL without embedded credentials.`);
  return url.toString();
};

const subscriptionResource = (channel: TeamsKnowledgeChannel): string => {
  if (
    channel.teamId.trim() === "" ||
    channel.channelId.trim() === "" ||
    channel.teamId.includes("/") ||
    channel.channelId.includes("/")
  )
    throw new Error("Teams subscription channel identity is invalid.");
  return `teams/${channel.teamId}/channels/${channel.channelId}/messages`;
};

export const teamsSubscriptionResourceHash = (channel: TeamsKnowledgeChannel): string =>
  stableSha256(subscriptionResource(channel));

const expiration = (now: Date, lifetimeMinutes: number): string =>
  new Date(now.getTime() + lifetimeMinutes * 60_000).toISOString();

const asDomainSubscription = (
  configuration: TeamsNotificationSubscriptionConfiguration,
  provider: GraphSubscription,
  resource: string,
  now: Date,
  renewalLeadMinutes: number,
  renewed: boolean,
): SynchronizationSubscription => {
  if (
    provider.id === undefined ||
    provider.expirationDateTime === undefined ||
    !Number.isFinite(Date.parse(provider.expirationDateTime))
  )
    throw new Error("Microsoft Graph returned an invalid subscription identity.");
  return {
    id: provider.id,
    workspaceId: configuration.workspaceId,
    sourceId: configuration.sourceId,
    source: "teams",
    provider: "microsoft-graph",
    resourceHash: stableSha256(resource),
    status: "active",
    expiresAt: new Date(provider.expirationDateTime).toISOString(),
    ...(renewed ? { renewedAt: now.toISOString() } : {}),
    nextRenewalAt: new Date(
      Date.parse(provider.expirationDateTime) - renewalLeadMinutes * 60_000,
    ).toISOString(),
    retryCount: 0,
    updatedAt: now.toISOString(),
  };
};

export const ensureTeamsChangeNotificationSubscription = (
  configuration: TeamsNotificationSubscriptionConfiguration,
  channel: TeamsKnowledgeChannel,
  existing?: TeamsProviderSubscription | undefined,
): Effect.Effect<SynchronizationSubscription, RepositoryError> =>
  Effect.tryPromise({
    try: async () => {
      if (configuration.workspaceId.trim() === "" || configuration.sourceId.trim() === "")
        throw new Error("Teams subscription workspace and source identities are required.");
      if (configuration.clientState.trim().length < 16)
        throw new Error("Teams subscription client state must be an unguessable protected value.");
      const notificationUrl = validatedHttpsUrl("notificationUrl", configuration.notificationUrl);
      const lifecycleNotificationUrl = validatedHttpsUrl(
        "lifecycleNotificationUrl",
        configuration.lifecycleNotificationUrl,
      );
      const lifetimeMinutes = configuration.lifetimeMinutes ?? 60;
      const renewalLeadMinutes = configuration.renewalLeadMinutes ?? 15;
      if (
        !Number.isInteger(lifetimeMinutes) ||
        lifetimeMinutes < 15 ||
        lifetimeMinutes > 4_230 ||
        !Number.isInteger(renewalLeadMinutes) ||
        renewalLeadMinutes < 5 ||
        renewalLeadMinutes >= lifetimeMinutes
      )
        throw new Error("Teams subscription lifetime and renewal lead are invalid.");
      const resource = subscriptionResource(channel);
      const now = configuration.now?.() ?? new Date();
      const dueAt = now.getTime() + renewalLeadMinutes * 60_000;
      if (existing !== undefined && Date.parse(existing.expiresAt) > dueAt) {
        const current = asDomainSubscription(
          configuration,
          { id: existing.id, expirationDateTime: existing.expiresAt },
          resource,
          now,
          renewalLeadMinutes,
          false,
        );
        await Effect.runPromise(configuration.controlRepository.saveSubscription(current));
        return current;
      }
      const accessToken = await configuration.tokenProvider.getAccessToken();
      const expiresAt = expiration(now, lifetimeMinutes);
      const fetcher = configuration.fetcher ?? fetch;
      const request = async (method: "POST" | "PATCH", url: string): Promise<Response> =>
        fetcher(url, {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            method === "PATCH"
              ? { expirationDateTime: expiresAt }
              : {
                  changeType: "created,updated,deleted",
                  notificationUrl,
                  lifecycleNotificationUrl,
                  resource,
                  expirationDateTime: expiresAt,
                  clientState: configuration.clientState,
                  includeResourceData: false,
                },
          ),
        });
      let response =
        existing === undefined
          ? await request("POST", "https://graph.microsoft.com/v1.0/subscriptions")
          : await request(
              "PATCH",
              `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(existing.id)}`,
            );
      if (existing !== undefined && (response.status === 404 || response.status === 410))
        response = await request("POST", "https://graph.microsoft.com/v1.0/subscriptions");
      if (!response.ok)
        throw new Error(`Teams subscription renewal failed with HTTP ${response.status}.`);
      const provider = (await response.json()) as GraphSubscription;
      const subscription = asDomainSubscription(
        configuration,
        provider,
        resource,
        now,
        renewalLeadMinutes,
        true,
      );
      await Effect.runPromise(configuration.controlRepository.saveSubscription(subscription));
      return subscription;
    },
    catch: () =>
      new RepositoryError({
        message: "Microsoft Teams change-notification subscription is unavailable.",
        operation: "teams-subscription-renewal",
      }),
  });

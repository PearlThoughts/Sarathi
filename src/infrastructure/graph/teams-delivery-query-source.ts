import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { isSensitivityAtOrBelow, type SensitivityTier } from "../../domain/policy.ts";
import {
  type DeliveryQueryContext,
  type DeliveryQueryOperation,
  type DeliveryQueryResult,
  type DeliveryQuerySource,
  type DeliveryResultItem,
  resolveDeliveryTimeConstraint,
} from "../../modules/delivery-intelligence/index.ts";
import type { GraphAccessTokenProvider } from "./entra-token-provider.ts";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type TeamsMessage = {
  readonly id?: string;
  readonly createdDateTime?: string;
  readonly lastModifiedDateTime?: string;
  readonly messageType?: string;
  readonly subject?: string | null;
  readonly body?: { readonly content?: string };
  readonly from?: {
    readonly user?: { readonly displayName?: string };
    readonly application?: { readonly id?: string; readonly displayName?: string };
  };
  readonly webUrl?: string;
  readonly replies?: readonly TeamsMessage[];
};

export type TeamsDeliveryChannel = {
  readonly teamId: string;
  readonly channelId: string;
  readonly workspaceId: string;
  readonly sensitivity: SensitivityTier;
  readonly allowedActorIds: ReadonlySet<string>;
};

export type TeamsDeliveryQueryConfiguration = {
  readonly tokenProvider: GraphAccessTokenProvider;
  readonly channels: readonly TeamsDeliveryChannel[];
  readonly assistantName?: string | undefined;
  readonly botApplicationId?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetcher?: Fetcher | undefined;
};

const emptyResult = (): DeliveryQueryResult => ({
  items: [],
  conflicts: [],
  unavailableSources: [],
  complete: true,
});

const textContent = (value: string | undefined): string =>
  (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

const containsAssistantMention = (body: string | undefined, assistantName: string): boolean =>
  new RegExp(
    `<at\\b[^>]*>\\s*${assistantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</at>`,
    "i",
  ).test(body ?? "");

const matchesOperation = (content: string, operation: DeliveryQueryOperation): boolean => {
  switch (operation.purpose) {
    case "dependencies":
      return /\b(?:waiting|depends?|dependency|blocked by)\b/i.test(content);
    case "blockers":
      return /\b(?:blocked|stuck|impediment|cannot progress)\b/i.test(content);
    case "risks":
      return /\b(?:risk|concern|delay|slip|uncertain)\b/i.test(content);
    case "recurring":
      return /\b(?:again|recurring|repeated|keeps happening)\b/i.test(content);
    case "decisions":
      return /\b(?:decided|decision|agreed|approved|rejected)\b/i.test(content);
    default:
      return true;
  }
};

const inOperationWindow = (
  value: string | undefined,
  operation: DeliveryQueryOperation,
  context: DeliveryQueryContext,
): value is string => {
  if (value === undefined) return false;
  if (operation.time === undefined || operation.time.kind === "jira_sprint") return true;
  const window = resolveDeliveryTimeConstraint(
    operation.time,
    context.requestedAt,
    context.timeZone,
  );
  const timestamp = Date.parse(value);
  return (
    timestamp >= Date.parse(window.fromInclusive) && timestamp < Date.parse(window.toExclusive)
  );
};

const channelUrl = (channel: TeamsDeliveryChannel, limit: number): URL => {
  const url = new URL(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(channel.teamId)}/channels/${encodeURIComponent(channel.channelId)}/messages`,
  );
  url.searchParams.set("$top", String(Math.min(Math.max(limit * 5, 10), 50)));
  url.searchParams.set("$expand", "replies");
  return url;
};

const readChannel = async (
  configuration: TeamsDeliveryQueryConfiguration,
  channel: TeamsDeliveryChannel,
  accessToken: string,
  limit: number,
): Promise<readonly TeamsMessage[]> => {
  const response = await (configuration.fetcher ?? fetch)(channelUrl(channel, limit), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(configuration.timeoutMs ?? 4_000),
  });
  if (!response.ok) throw new Error(`Teams delivery query failed with HTTP ${response.status}.`);
  const payload = (await response.json()) as { readonly value?: readonly TeamsMessage[] };
  return (payload.value ?? []).flatMap((message) => [message, ...(message.replies ?? [])]);
};

export const createTeamsDeliveryQuerySource = (
  configuration: TeamsDeliveryQueryConfiguration,
): DeliveryQuerySource => ({
  source: "teams",
  selectors: ["objects", "relations", "observations", "claims"],
  execute: (context, plan) =>
    Effect.tryPromise({
      try: async () => {
        const channels = configuration.channels.filter(
          (channel) =>
            channel.workspaceId === context.workspaceId &&
            channel.allowedActorIds.has(context.actorId) &&
            isSensitivityAtOrBelow(channel.sensitivity, context.maximumSensitivity),
        );
        const operations = plan.operations.filter((operation) =>
          ["objects", "relations", "observations", "claims"].includes(operation.select),
        );
        if (channels.length === 0 || channels.length > 10 || operations.length === 0)
          return emptyResult();
        const accessToken = await configuration.tokenProvider.getAccessToken();
        const maximumLimit = Math.max(...operations.map(({ limit }) => limit));
        const messages = await Promise.all(
          channels.map(async (channel) => ({
            channel,
            messages: await readChannel(configuration, channel, accessToken, maximumLimit),
          })),
        );
        const items = messages.flatMap(({ channel, messages: channelMessages }) =>
          operations.flatMap((operation) =>
            channelMessages
              .flatMap((message): readonly DeliveryResultItem[] => {
                const observedAt = message.lastModifiedDateTime ?? message.createdDateTime;
                const body = message.body?.content;
                if (
                  message.id === undefined ||
                  message.messageType !== "message" ||
                  message.webUrl === undefined ||
                  !message.webUrl.startsWith("https://teams.microsoft.com/") ||
                  !inOperationWindow(observedAt, operation, context) ||
                  containsAssistantMention(body, configuration.assistantName ?? "Sarathi") ||
                  (configuration.botApplicationId !== undefined &&
                    message.from?.application?.id === configuration.botApplicationId)
                )
                  return [];
                const content = textContent(body);
                if (content === "" || !matchesOperation(content, operation)) return [];
                const actor =
                  message.from?.user?.displayName ??
                  message.from?.application?.displayName ??
                  "Team member";
                return [
                  {
                    id: `teams:${channel.teamId}:${channel.channelId}:${message.id}:${operation.purpose}`,
                    workspaceId: context.workspaceId,
                    source: "teams",
                    selector: operation.select,
                    intent: operation.purpose,
                    title: message.subject?.trim() || "Teams update",
                    summary: `${actor}: ${content}`,
                    citationUrl: message.webUrl,
                    sensitivity: channel.sensitivity,
                    authority: 0.8,
                    observedAt,
                    dedupeKey: `teams:${channel.teamId}:${channel.channelId}:${message.id}`,
                  },
                ];
              })
              .slice(0, operation.limit),
          ),
        );
        return { items, conflicts: [], unavailableSources: [], complete: true };
      },
      catch: () =>
        new RepositoryError({
          message: "Connected Teams delivery information is unavailable.",
          operation: "delivery-query-teams",
        }),
    }),
});

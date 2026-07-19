import type { EvidenceSourceReader } from "../../modules/evidence-import/index.ts";
import type { GraphAccessTokenProvider } from "./entra-token-provider.ts";

export type TeamsGraphThreadReaderConfiguration = {
  readonly tokenProvider: GraphAccessTokenProvider;
  readonly approvedStandardChannels: ReadonlySet<string>;
  readonly fetcher?: typeof fetch | undefined;
  readonly pageSize?: number | undefined;
};

type TeamsMessage = {
  readonly id?: string;
  readonly createdDateTime?: string;
  readonly lastModifiedDateTime?: string;
  readonly subject?: string;
  readonly body?: { readonly content?: string };
  readonly from?: { readonly user?: { readonly id?: string } };
  readonly webUrl?: string;
};

const parseSourceKey = (
  sourceKey: string,
): { readonly teamId: string; readonly channelId: string; readonly rootId: string } | undefined => {
  const parts = sourceKey.split(":");
  if (parts.length !== 4 || parts[0] !== "teams" || parts.some((part) => part.trim() === ""))
    return undefined;
  try {
    const [, encodedTeamId, encodedChannelId, encodedRootId] = parts;
    if (
      encodedTeamId === undefined ||
      encodedChannelId === undefined ||
      encodedRootId === undefined
    )
      return undefined;
    return {
      teamId: decodeURIComponent(encodedTeamId),
      channelId: decodeURIComponent(encodedChannelId),
      rootId: decodeURIComponent(encodedRootId),
    };
  } catch {
    return undefined;
  }
};

export const teamsThreadSourceKey = ({
  teamId,
  channelId,
  rootId,
}: {
  readonly teamId: string;
  readonly channelId: string;
  readonly rootId: string;
}): string =>
  `teams:${encodeURIComponent(teamId)}:${encodeURIComponent(channelId)}:${encodeURIComponent(rootId)}`;

const excerpt = (value: string | undefined): string =>
  (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);

export const createTeamsGraphThreadReader = (
  configuration: TeamsGraphThreadReaderConfiguration,
): EvidenceSourceReader => ({
  readEvidence: async ({ sourceKey, afterCursor }) => {
    const scope = parseSourceKey(sourceKey);
    if (
      scope === undefined ||
      !configuration.approvedStandardChannels.has(`${scope.teamId}:${scope.channelId}`)
    ) {
      return { records: [] };
    }
    const fetcher = configuration.fetcher ?? fetch;
    const accessToken = await configuration.tokenProvider.getAccessToken();
    const limit = configuration.pageSize ?? 20;
    const repliesUrl = new URL(
      `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(scope.teamId)}/channels/${encodeURIComponent(scope.channelId)}/messages/${encodeURIComponent(scope.rootId)}/replies`,
    );
    repliesUrl.searchParams.set("$top", String(limit));
    if (afterCursor !== undefined)
      repliesUrl.searchParams.set("$filter", `createdDateTime gt ${afterCursor}`);
    const rootUrl = new URL(repliesUrl);
    rootUrl.pathname = rootUrl.pathname.replace(/\/replies$/, "");
    rootUrl.search = "";
    const [rootResponse, repliesResponse] = await Promise.all([
      fetcher(rootUrl, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetcher(repliesUrl, { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);
    if (!rootResponse.ok)
      throw new Error(`Graph thread root read failed with HTTP ${rootResponse.status}.`);
    if (!repliesResponse.ok)
      throw new Error(`Graph thread replies read failed with HTTP ${repliesResponse.status}.`);
    const [root, payload] = (await Promise.all([
      rootResponse.json() as Promise<TeamsMessage>,
      repliesResponse.json() as Promise<{ readonly value?: readonly TeamsMessage[] }>,
    ])) as [TeamsMessage, { readonly value?: readonly TeamsMessage[] }];
    const records = [root, ...(payload.value ?? [])].flatMap((message) => {
      if (message.id === undefined || message.createdDateTime === undefined) return [];
      return [
        {
          sourceSystem: "teams" as const,
          sourceType: "message" as const,
          externalId: message.id,
          externalUrl: message.webUrl,
          actorId: message.from?.user?.id,
          occurredAt: message.createdDateTime,
          title: message.subject ?? "Teams thread reply",
          bodyExcerpt: excerpt(message.body?.content),
          sensitivity: "internal" as const,
          consent: {
            status: "granted" as const,
            scope: `teams:${scope.teamId}:${scope.channelId}`,
            recordedAt: message.lastModifiedDateTime ?? message.createdDateTime,
          },
        },
      ];
    });
    return { records, nextCursor: records.at(-1)?.occurredAt };
  },
});

import type { EvidenceSourceReader } from "../../modules/evidence-import/index.ts";

export type TeamsGraphThreadReaderConfiguration = {
  readonly accessToken: string;
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
  const [, teamId, channelId, rootId] = parts;
  if (teamId === undefined || channelId === undefined || rootId === undefined) return undefined;
  return { teamId, channelId, rootId };
};

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
    const limit = configuration.pageSize ?? 20;
    const url = new URL(
      `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(scope.teamId)}/channels/${encodeURIComponent(scope.channelId)}/messages/${encodeURIComponent(scope.rootId)}/replies`,
    );
    url.searchParams.set("$top", String(limit));
    if (afterCursor !== undefined)
      url.searchParams.set("$filter", `createdDateTime gt ${afterCursor}`);
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${configuration.accessToken}` },
    });
    if (!response.ok) throw new Error(`Graph thread read failed with HTTP ${response.status}.`);
    const payload = (await response.json()) as { readonly value?: readonly TeamsMessage[] };
    const records = (payload.value ?? []).flatMap((message) => {
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

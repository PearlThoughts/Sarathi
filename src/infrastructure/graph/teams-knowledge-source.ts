import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type { SensitivityTier } from "../../domain/policy.ts";
import type {
  DeliveryObjectDraft,
  DeliveryObjectRef,
  DeliveryObservationKind,
  DeliveryProjection,
} from "../../modules/delivery-intelligence/index.ts";
import {
  createTypedPassage,
  type KnowledgeAclRule,
  type KnowledgePassageDraft,
  type KnowledgeSourceDocument,
  type KnowledgeSourceReader,
} from "../../modules/knowledge-layer/index.ts";
import type { GraphAccessTokenProvider } from "./entra-token-provider.ts";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type TeamsKnowledgeChannel = {
  readonly teamId: string;
  readonly channelId: string;
  readonly label: string;
  readonly sensitivity: SensitivityTier;
  readonly acl: readonly KnowledgeAclRule[];
  readonly authority?: number | undefined;
};

export type TeamsKnowledgeSourceConfiguration = {
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly tokenProvider: GraphAccessTokenProvider;
  readonly channels: readonly TeamsKnowledgeChannel[];
  readonly historySince?: string | undefined;
  readonly assistantName?: string | undefined;
  readonly botApplicationId?: string | undefined;
  readonly now?: (() => Date) | undefined;
  readonly fetcher?: Fetcher | undefined;
};

type TeamsIdentity = {
  readonly id?: string;
  readonly displayName?: string;
};

type TeamsMessage = {
  readonly id?: string;
  readonly replyToId?: string | null;
  readonly createdDateTime?: string;
  readonly lastModifiedDateTime?: string;
  readonly deletedDateTime?: string | null;
  readonly messageType?: string;
  readonly subject?: string | null;
  readonly body?: { readonly contentType?: string; readonly content?: string };
  readonly from?: {
    readonly user?: TeamsIdentity | null;
    readonly application?: TeamsIdentity | null;
  } | null;
  readonly mentions?: readonly {
    readonly id?: number;
    readonly mentionText?: string;
    readonly mentioned?: { readonly user?: TeamsIdentity | null };
  }[];
  readonly attachments?: readonly {
    readonly id?: string;
    readonly contentType?: string;
    readonly name?: string | null;
    readonly contentUrl?: string | null;
    readonly teamsAppId?: string | null;
  }[];
  readonly webUrl?: string | null;
};

type TeamsPage = {
  readonly value?: readonly TeamsMessage[];
  readonly "@odata.nextLink"?: string;
};

type ChannelCursor = {
  readonly messages: Readonly<Record<string, string>>;
  readonly newestModifiedAt: string;
};

type TeamsCursor = {
  readonly version: 1;
  readonly scopeHash: string;
  readonly channels: Readonly<Record<string, ChannelCursor>>;
};

type NormalizedMessage = {
  readonly id: string;
  readonly rootId: string;
  readonly parentId?: string | undefined;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly deletedAt?: string | undefined;
  readonly title: string;
  readonly content: string;
  readonly authorId?: string | undefined;
  readonly authorName?: string | undefined;
  readonly mentions: readonly TeamsIdentity[];
  readonly attachments: readonly {
    readonly id: string;
    readonly contentType: string;
    readonly name: string;
    readonly contentUrl?: string | undefined;
    readonly teamsAppId?: string | undefined;
  }[];
  readonly webUrl: string;
  readonly version: string;
};

const encodeCursor = (cursor: TeamsCursor): string =>
  `teams-v1:${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;

const parseCursor = (value: string): TeamsCursor | undefined => {
  if (!value.startsWith("teams-v1:")) return undefined;
  const parsed = JSON.parse(
    Buffer.from(value.slice("teams-v1:".length), "base64url").toString("utf8"),
  ) as TeamsCursor | undefined;
  return parsed?.version === 1 && typeof parsed.scopeHash === "string" ? parsed : undefined;
};

const channelIdentity = (channel: TeamsKnowledgeChannel): string =>
  `${channel.teamId}:${channel.channelId}`;

const externalId = (channel: TeamsKnowledgeChannel, messageId: string): string =>
  `${channel.teamId}:${channel.channelId}:${messageId}`;

const graphPath = (channel: TeamsKnowledgeChannel): string =>
  `/v1.0/teams/${encodeURIComponent(channel.teamId)}/channels/${encodeURIComponent(channel.channelId)}/messages`;

const textContent = (value: string | undefined): string =>
  (value ?? "")
    .replace(/<at\b[^>]*>(.*?)<\/at>/gi, "@$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();

const assistantPrompt = (content: string, assistantName: string): boolean => {
  const escaped = assistantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)@${escaped}(?:\\s|$)`, "i").test(content);
};

const financeContent = (content: string): boolean =>
  /\b(?:budget|costs?|billing|invoice|revenue|profit|margin|burn rate|hourly rate|day rate|commercial rate|payment|payroll|salary|compensation|pricing)\b/i.test(
    content,
  );

const testContent = (content: string): boolean =>
  content === "@" ||
  /^test(?:ing)?\b/i.test(content) ||
  /\b(?:dummy|synthetic) message\b/i.test(content);

const acknowledgement = (content: string): boolean =>
  content.length <= 48 &&
  /^(?:ok(?:ay)?|yes|no|sure|thanks?|thank you|noted|acknowledged|got it|done|great|perfect|👍|✅)[.!\s👍✅]*$/iu.test(
    content,
  );

const validGraphNextLink = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com")
    throw new Error("Teams pagination returned an untrusted next link.");
  return url.toString();
};

const readPages = async (
  configuration: TeamsKnowledgeSourceConfiguration,
  accessToken: string,
  initialUrl: string,
  maximumPages = 100,
  stopAfterPage?: ((messages: readonly TeamsMessage[]) => boolean) | undefined,
): Promise<readonly TeamsMessage[]> => {
  const values: TeamsMessage[] = [];
  let next: string | undefined = initialUrl;
  let pages = 0;
  while (next !== undefined) {
    if (pages >= maximumPages)
      throw new Error("Teams message pagination exceeded its safety bound.");
    const response = await (configuration.fetcher ?? fetch)(next, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Teams knowledge read failed with HTTP ${response.status}.`);
    const page = (await response.json()) as TeamsPage;
    const pageValues = page.value ?? [];
    values.push(...pageValues);
    if (stopAfterPage?.(pageValues) === true) break;
    next =
      page["@odata.nextLink"] === undefined
        ? undefined
        : validGraphNextLink(page["@odata.nextLink"]);
    pages += 1;
  }
  return values;
};

const normalizeMessage = (
  configuration: TeamsKnowledgeSourceConfiguration,
  channel: TeamsKnowledgeChannel,
  message: TeamsMessage,
  rootId: string,
): NormalizedMessage | undefined => {
  if (
    message.id === undefined ||
    message.createdDateTime === undefined ||
    message.messageType !== "message" ||
    message.webUrl == null ||
    !message.webUrl.startsWith("https://teams.microsoft.com/")
  )
    return undefined;
  const content = textContent(message.body?.content);
  const deletedAt = message.deletedDateTime ?? undefined;
  const authorApplicationId = message.from?.application?.id;
  const excluded =
    deletedAt === undefined &&
    (content === "" ||
      financeContent(content) ||
      testContent(content) ||
      assistantPrompt(content, configuration.assistantName ?? "Sarathi") ||
      authorApplicationId !== undefined ||
      (configuration.botApplicationId !== undefined &&
        authorApplicationId === configuration.botApplicationId));
  if (excluded) return undefined;
  const modifiedAt = message.lastModifiedDateTime ?? message.createdDateTime;
  const mentions = (message.mentions ?? []).flatMap(({ mentioned }) => {
    const identity = mentioned?.user;
    return identity?.id === undefined && identity?.displayName === undefined ? [] : [identity];
  });
  const attachments = (message.attachments ?? []).map((attachment, index) => ({
    id: attachment.id ?? String(index),
    contentType: attachment.contentType ?? "unknown",
    name: attachment.name ?? "attachment",
    ...(attachment.contentUrl == null ? {} : { contentUrl: attachment.contentUrl }),
    ...(attachment.teamsAppId == null ? {} : { teamsAppId: attachment.teamsAppId }),
  }));
  const version = stableSha256(
    JSON.stringify({
      modifiedAt,
      deletedAt,
      content,
      authorId: message.from?.user?.id,
      mentions,
      attachments,
    }),
  );
  return {
    id: message.id,
    rootId,
    ...(message.replyToId == null ? {} : { parentId: message.replyToId }),
    createdAt: message.createdDateTime,
    modifiedAt,
    ...(deletedAt === undefined ? {} : { deletedAt }),
    title: message.subject?.trim() || channel.label,
    content,
    authorId: message.from?.user?.id,
    authorName: message.from?.user?.displayName,
    mentions,
    attachments,
    webUrl: message.webUrl,
    version,
  };
};

const readChannelMessages = async (
  configuration: TeamsKnowledgeSourceConfiguration,
  channel: TeamsKnowledgeChannel,
  accessToken: string,
  historySince: string,
): Promise<readonly NormalizedMessage[]> => {
  if (
    channel.teamId.trim() === "" ||
    channel.channelId.trim() === "" ||
    channel.label.trim() === "" ||
    channel.acl.length === 0
  )
    throw new Error(
      "Teams knowledge channels require stable identities, a label, and explicit ACL.",
    );
  const baseUrl = `https://graph.microsoft.com${graphPath(channel)}`;
  const roots = await readPages(
    configuration,
    accessToken,
    `${baseUrl}?%24top=50`,
    100,
    (page) =>
      page.length > 0 &&
      page.every(
        ({ lastModifiedDateTime, createdDateTime }) =>
          Date.parse(lastModifiedDateTime ?? createdDateTime ?? historySince) <
          Date.parse(historySince),
      ),
  );
  const threads: NormalizedMessage[] = [];
  for (let offset = 0; offset < roots.length; offset += 4) {
    const batch = roots.slice(offset, offset + 4).filter((root) => root.id !== undefined);
    const results = await Promise.all(
      batch.map(async (root) => {
        const rootId = root.id as string;
        const replies = await readPages(
          configuration,
          accessToken,
          `${baseUrl}/${encodeURIComponent(rootId)}/replies?%24top=50`,
        );
        return [root, ...replies].flatMap((message) => {
          const normalized = normalizeMessage(configuration, channel, message, rootId);
          return normalized === undefined ? [] : [normalized];
        });
      }),
    );
    threads.push(...results.flat());
  }
  const activeThreads = new Set(
    threads
      .filter((message) =>
        [message.createdAt, message.modifiedAt, message.deletedAt]
          .filter((value) => value !== undefined)
          .some((value) => Date.parse(value) >= Date.parse(historySince)),
      )
      .map(({ rootId }) => rootId),
  );
  return threads
    .filter(({ rootId }) => activeThreads.has(rootId))
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
};

const messageRole = (
  content: string,
): "commitment" | "decision" | "risk" | "question" | "status" => {
  if (/\b(?:decided|decision|agreed|approved|rejected)\b/i.test(content)) return "decision";
  if (/\b(?:risk|concern|delay|slip|blocked|stuck|impediment)\b/i.test(content)) return "risk";
  if (
    /\b(?:I will|we will|will deliver|committed|commitment|next step|action item)\b/i.test(content)
  )
    return "commitment";
  if (
    content.endsWith("?") ||
    /^(?:who|what|when|where|why|how|can|could|should|is|are)\b/i.test(content)
  )
    return "question";
  return "status";
};

const workItemKeys = (content: string): readonly string[] => [
  ...new Set(content.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []),
];

const projection = (
  channel: TeamsKnowledgeChannel,
  message: NormalizedMessage,
): DeliveryProjection => {
  const channelRef: DeliveryObjectRef = {
    kind: "team",
    externalKey: `teams:${channel.teamId}:${channel.channelId}`,
  };
  const authorRef: DeliveryObjectRef | undefined =
    message.authorId === undefined
      ? undefined
      : { kind: "person", externalKey: `entra:${message.authorId}` };
  const role = messageRole(message.content);
  const objects: DeliveryObjectDraft[] = [
    {
      ...channelRef,
      title: channel.label,
      lifecycleState: "active",
      attributes: { teamId: channel.teamId, channelId: channel.channelId },
      sensitivity: channel.sensitivity,
    },
    ...(authorRef === undefined
      ? []
      : [
          {
            ...authorRef,
            title: message.authorName ?? message.authorId ?? "Teams member",
            lifecycleState: "active",
            attributes: { provider: "entra" },
            sensitivity: channel.sensitivity,
          } satisfies DeliveryObjectDraft,
        ]),
  ];
  const relations: DeliveryProjection["relations"][number][] = [];
  if (authorRef !== undefined)
    relations.push({
      kind: "participates_in",
      from: authorRef,
      to: channelRef,
      attributes: { messageId: message.id },
      sensitivity: channel.sensitivity,
    });
  for (const key of workItemKeys(message.content)) {
    const workItem: DeliveryObjectRef = { kind: "work_item", externalKey: key };
    objects.push({
      ...workItem,
      title: key,
      attributes: { referencedBy: message.webUrl },
      sensitivity: channel.sensitivity,
    });
    relations.push({
      kind: role === "commitment" ? "contributes_to" : "relates_to",
      from: channelRef,
      to: workItem,
      attributes: { messageId: message.id },
      sensitivity: channel.sensitivity,
    });
  }
  const observationKind: DeliveryObservationKind = role === "decision" ? "decision" : "message";
  return {
    objects,
    relations,
    observations: [
      {
        kind: observationKind,
        externalId: message.id,
        subject: channelRef,
        actorExternalKey: authorRef?.externalKey,
        summary: message.content.slice(0, 500),
        dedupeKey: `teams:${channel.teamId}:${channel.channelId}:${message.id}`,
        occurredAt: message.createdAt,
        citationUrl: message.webUrl,
        sensitivity: channel.sensitivity,
        authority: channel.authority ?? 0.82,
      },
    ],
    metrics: [],
    claims:
      role === "status" || role === "question"
        ? []
        : [
            {
              subject: channelRef,
              subjectKey: channelRef.externalKey,
              predicate: `teams.${role}`,
              value: message.content,
              assertedBy: authorRef?.externalKey,
              externalAssertionId: `teams:${channel.teamId}:${channel.channelId}:${message.id}`,
              assertedAt: message.createdAt,
              citationUrl: message.webUrl,
              sensitivity: channel.sensitivity,
              authority: channel.authority ?? 0.82,
            },
          ],
  };
};

const contextualPassages = (
  target: NormalizedMessage,
  thread: readonly NormalizedMessage[],
): readonly KnowledgePassageDraft[] => {
  const active = thread.filter(
    (message) => message.deletedAt === undefined && !acknowledgement(message.content),
  );
  if (target.deletedAt !== undefined || acknowledgement(target.content)) return [];
  const root = active.find((message) => message.id === target.rootId);
  if (target.id !== target.rootId) {
    const body = [
      ...(root === undefined
        ? []
        : [`Thread: ${root.authorName ?? "Team member"}: ${root.content}`]),
      `Reply: ${target.authorName ?? "Team member"}: ${target.content}`,
    ].join("\n");
    const passage = createTypedPassage(
      "thread-reply",
      `#message-${encodeURIComponent(target.id)}`,
      0,
      target.title,
      body,
    );
    return passage === undefined ? [] : [passage];
  }
  const passages: KnowledgePassageDraft[] = [];
  for (let offset = 0; offset < active.length; offset += 5) {
    const span = active.slice(offset, offset + 5);
    const passage = createTypedPassage(
      "thread",
      `#thread-${offset / 5 + 1}`,
      passages.length,
      target.title,
      span
        .map((message) => `${message.authorName ?? "Team member"}: ${message.content}`)
        .join("\n"),
    );
    if (passage !== undefined) passages.push(passage);
  }
  return passages;
};

const asDocument = (
  configuration: TeamsKnowledgeSourceConfiguration,
  channel: TeamsKnowledgeChannel,
  message: NormalizedMessage,
  thread: readonly NormalizedMessage[],
): KnowledgeSourceDocument | undefined => {
  const passages = contextualPassages(message, thread);
  if (passages.length === 0) return undefined;
  const contextVersion =
    message.id === message.rootId
      ? stableSha256(thread.map(({ id, version }) => `${id}:${version}`).join("\n"))
      : stableSha256(
          `${message.version}\n${thread.find(({ id }) => id === message.rootId)?.version ?? "missing-root"}`,
        );
  const sourceUpdatedAt =
    message.id === message.rootId
      ? thread.reduce(
          (latest, candidate) => (candidate.modifiedAt > latest ? candidate.modifiedAt : latest),
          message.modifiedAt,
        )
      : message.modifiedAt;
  return {
    source: "teams",
    sourceId: configuration.sourceId,
    workspaceId: configuration.workspaceId,
    externalId: externalId(channel, message.id),
    sourceType: message.id === message.rootId ? "thread" : "thread_reply",
    sourceVersion: contextVersion,
    canonicalUrl: message.webUrl,
    title: message.title,
    sourceCreatedAt: message.createdAt,
    sourceUpdatedAt,
    sensitivity: channel.sensitivity,
    authority: channel.authority ?? 0.82,
    provenance: {
      teamId: channel.teamId,
      channelId: channel.channelId,
      threadId: message.rootId,
      messageId: message.id,
      ...(message.parentId === undefined ? {} : { parentId: message.parentId }),
      ...(message.authorId === undefined ? {} : { authorId: message.authorId }),
      mentions: message.mentions
        .map(({ id }) => id)
        .filter(Boolean)
        .join(","),
      createdAt: message.createdAt,
      modifiedAt: message.modifiedAt,
      attachments: JSON.stringify(message.attachments),
    },
    acl: channel.acl,
    passages,
    deliveryProjection: projection(channel, message),
  };
};

const readChannel = async (
  configuration: TeamsKnowledgeSourceConfiguration,
  channel: TeamsKnowledgeChannel,
  accessToken: string,
  historySince: string,
  previous?: ChannelCursor,
): Promise<{
  readonly documents: readonly KnowledgeSourceDocument[];
  readonly retiredExternalIds: readonly string[];
  readonly cursor: ChannelCursor;
}> => {
  const messages = await readChannelMessages(configuration, channel, accessToken, historySince);
  const threads = new Map<string, NormalizedMessage[]>();
  for (const message of messages) {
    const thread = threads.get(message.rootId) ?? [];
    thread.push(message);
    threads.set(message.rootId, thread);
  }
  const versions: Record<string, string> = {};
  const retiredExternalIds = new Set<string>();
  const documents = messages.flatMap((message) => {
    const id = externalId(channel, message.id);
    if (message.deletedAt !== undefined) {
      versions[id] = `deleted:${message.version}`;
      if (previous?.messages[id]?.startsWith("deleted:") !== true) retiredExternalIds.add(id);
      return [];
    }
    const document = asDocument(configuration, channel, message, threads.get(message.rootId) ?? []);
    if (document === undefined) {
      if (previous?.messages[id] !== undefined) retiredExternalIds.add(id);
      return [];
    }
    versions[id] = document.sourceVersion;
    if (document.sourceVersion === previous?.messages[id]) return [];
    return [document];
  });
  for (const [id, version] of Object.entries(previous?.messages ?? {})) {
    if (versions[id] === undefined && !version.startsWith("deleted:")) retiredExternalIds.add(id);
  }
  const newestModifiedAt = messages.reduce(
    (latest, message) => (message.modifiedAt > latest ? message.modifiedAt : latest),
    previous?.newestModifiedAt ?? historySince,
  );
  return {
    documents,
    retiredExternalIds: [...retiredExternalIds].sort(),
    cursor: { messages: versions, newestModifiedAt },
  };
};

export const createTeamsKnowledgeSource = (
  configuration: TeamsKnowledgeSourceConfiguration,
): KnowledgeSourceReader => ({
  readSnapshot: (workspaceId, previousCursor) =>
    Effect.tryPromise({
      try: async () => {
        if (workspaceId !== configuration.workspaceId)
          throw new Error("Teams knowledge source was requested for another workspace.");
        if (configuration.channels.length === 0 || configuration.channels.length > 32)
          throw new Error("Teams knowledge synchronization requires 1 to 32 configured channels.");
        const scopeHash = stableSha256(
          JSON.stringify(
            configuration.channels.map(
              ({ teamId, channelId, label, sensitivity, acl, authority }) => ({
                teamId,
                channelId,
                label,
                sensitivity,
                acl,
                authority,
              }),
            ),
          ),
        );
        const decoded = previousCursor === undefined ? undefined : parseCursor(previousCursor);
        const previous = decoded?.scopeHash === scopeHash ? decoded : undefined;
        const now = configuration.now?.() ?? new Date();
        const historySince =
          configuration.historySince ??
          new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, now.getUTCDate()),
          ).toISOString();
        if (!Number.isFinite(Date.parse(historySince)) || Date.parse(historySince) > now.getTime())
          throw new Error("Teams collaboration history start is invalid.");
        const accessToken = await configuration.tokenProvider.getAccessToken();
        const reads: Awaited<ReturnType<typeof readChannel>>[] = [];
        for (let offset = 0; offset < configuration.channels.length; offset += 4) {
          const batch = configuration.channels.slice(offset, offset + 4);
          reads.push(
            ...(await Promise.all(
              batch.map((channel) =>
                readChannel(
                  configuration,
                  channel,
                  accessToken,
                  historySince,
                  previous?.channels[channelIdentity(channel)],
                ),
              ),
            )),
          );
        }
        const channels = Object.fromEntries(
          configuration.channels.map((channel, index) => [
            channelIdentity(channel),
            reads[index]?.cursor,
          ]),
        ) as Readonly<Record<string, ChannelCursor>>;
        return {
          sourceId: configuration.sourceId,
          source: "teams",
          workspaceId,
          cursor: encodeCursor({ version: 1, scopeHash, channels }),
          scopeHash,
          mode: previous === undefined ? "full" : "delta",
          retiredExternalIds: reads.flatMap((read) => read.retiredExternalIds),
          documents: reads
            .flatMap((read) => read.documents)
            .sort((left, right) => left.externalId.localeCompare(right.externalId)),
        };
      },
      catch: () =>
        new RepositoryError({
          message: "Configured Teams knowledge synchronization failed.",
          operation: "teams-knowledge-sync",
        }),
    }),
});

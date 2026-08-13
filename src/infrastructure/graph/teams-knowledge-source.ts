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
  readonly kind?: "standard_team_channel" | "private_team_channel" | undefined;
  readonly teamId: string;
  readonly channelId: string;
  readonly label: string;
  readonly sensitivity: SensitivityTier;
  readonly acl: readonly KnowledgeAclRule[];
  readonly authority?: number | undefined;
  readonly notificationSubscription?: "enabled" | "reconciliation_only" | undefined;
};

export type TeamsKnowledgeChat = {
  readonly chatId: string;
  readonly chatType: "oneOnOne" | "group" | "meeting";
  readonly label: string;
  readonly canonicalUrl: string;
  readonly sensitivity: SensitivityTier;
  readonly acl: readonly KnowledgeAclRule[];
  readonly authority?: number | undefined;
};

export type TeamsKnowledgeConversation = TeamsKnowledgeChannel | TeamsKnowledgeChat;

export type TeamsKnowledgeSourceConfiguration = {
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly tokenProvider: GraphAccessTokenProvider;
  readonly channels: readonly TeamsKnowledgeChannel[];
  readonly chats?: readonly TeamsKnowledgeChat[] | undefined;
  readonly excludedAuthorIds?: readonly string[] | undefined;
  readonly historySince?: string | undefined;
  readonly assistantName?: string | undefined;
  readonly botApplicationId?: string | undefined;
  readonly now?: (() => Date) | undefined;
  readonly fetcher?: Fetcher | undefined;
  readonly retryDelay?: ((milliseconds: number) => Promise<void>) | undefined;
  readonly minimumRequestIntervalMilliseconds?: number | undefined;
  readonly requestTimeoutMilliseconds?: number | undefined;
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
    readonly content?: string | null;
  }[];
  readonly webUrl?: string | null;
  readonly replies?: readonly TeamsMessage[] | undefined;
  readonly "replies@odata.nextLink"?: string | undefined;
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
  readonly chats?: Readonly<Record<string, ChannelCursor>> | undefined;
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
    readonly messageReference?:
      | {
          readonly messageId: string;
          readonly preview: string;
          readonly authorName?: string | undefined;
        }
      | undefined;
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

const isKnowledgeChat = (
  conversation: TeamsKnowledgeConversation,
): conversation is TeamsKnowledgeChat => "chatId" in conversation;

const conversationIdentity = (conversation: TeamsKnowledgeConversation): string =>
  isKnowledgeChat(conversation) ? `chat:${conversation.chatId}` : channelIdentity(conversation);

const externalId = (conversation: TeamsKnowledgeConversation, messageId: string): string =>
  isKnowledgeChat(conversation)
    ? `chat:${conversation.chatId}:${messageId}`
    : `${conversation.teamId}:${conversation.channelId}:${messageId}`;

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

const messageReference = (
  attachment: NonNullable<TeamsMessage["attachments"]>[number],
): NormalizedMessage["attachments"][number]["messageReference"] => {
  if (attachment.contentType !== "messageReference" || attachment.content == null) return undefined;
  try {
    const parsed = JSON.parse(attachment.content) as {
      readonly messageId?: unknown;
      readonly messagePreview?: unknown;
      readonly messageSender?: {
        readonly user?: { readonly displayName?: unknown } | null;
      };
    };
    const preview =
      typeof parsed.messagePreview === "string" ? textContent(parsed.messagePreview) : "";
    if (typeof parsed.messageId !== "string" || parsed.messageId.trim() === "" || preview === "")
      return undefined;
    const authorName = parsed.messageSender?.user?.displayName;
    return {
      messageId: parsed.messageId,
      preview,
      ...(typeof authorName === "string" && authorName.trim() !== "" ? { authorName } : {}),
    };
  } catch {
    return undefined;
  }
};

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

const retryAfterMilliseconds = (response: Response, now: Date): number => {
  const value = response.headers.get("Retry-After");
  if (value === null) return 1_000;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(value) - now.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 60_000)
    throw new Error("Teams retryable response returned an invalid retry interval.");
  return milliseconds;
};

const retryableGraphReadStatus = (status: number): boolean =>
  status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

const retryDelayMilliseconds = (
  response: Response | undefined,
  retryCount: number,
  now: Date,
): number => {
  const exponentialFloor = Math.min(60_000, 1_000 * 2 ** retryCount);
  return response === undefined
    ? exponentialFloor
    : Math.max(retryAfterMilliseconds(response, now), exponentialFloor);
};

const delay = (
  configuration: TeamsKnowledgeSourceConfiguration,
  milliseconds: number,
  interruptSignal: AbortSignal,
): Promise<void> => {
  const wait = (
    configuration.retryDelay ??
    ((duration) => new Promise((resolve) => setTimeout(resolve, duration)))
  )(milliseconds);
  if (interruptSignal.aborted) return Promise.reject(interruptSignal.reason);
  return new Promise<void>((resolve, reject) => {
    const aborted = () => reject(interruptSignal.reason);
    interruptSignal.addEventListener("abort", aborted, { once: true });
    void wait.then(
      () => {
        interruptSignal.removeEventListener("abort", aborted);
        resolve();
      },
      (error: unknown) => {
        interruptSignal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
};

const createConversationRequestGate = (
  configuration: TeamsKnowledgeSourceConfiguration,
  interruptSignal: AbortSignal,
): (() => Promise<void>) => {
  const minimumInterval = configuration.minimumRequestIntervalMilliseconds ?? 1_100;
  if (!Number.isFinite(minimumInterval) || minimumInterval < 0 || minimumInterval > 60_000)
    throw new Error("Teams request pacing interval is invalid.");
  const now = (): number => (configuration.now?.() ?? new Date()).getTime();
  let lastStartedAt: number | undefined;
  let queue = Promise.resolve();
  return async () => {
    const turn = queue.then(async () => {
      const wait =
        lastStartedAt === undefined ? 0 : Math.max(0, lastStartedAt + minimumInterval - now());
      if (wait > 0) await delay(configuration, wait, interruptSignal);
      lastStartedAt = now();
    });
    queue = turn.catch(() => undefined);
    await turn;
  };
};

const readPages = async (
  configuration: TeamsKnowledgeSourceConfiguration,
  accessToken: string,
  initialUrl: string,
  beforeRequest: () => Promise<void>,
  interruptSignal: AbortSignal,
  maximumPages = 100,
  stopAfterPage?: ((messages: readonly TeamsMessage[]) => boolean) | undefined,
): Promise<readonly TeamsMessage[]> => {
  const values: TeamsMessage[] = [];
  let next: string | undefined = initialUrl;
  let pages = 0;
  let transientRetries = 0;
  while (next !== undefined) {
    if (pages >= maximumPages)
      throw new Error("Teams message pagination exceeded its safety bound.");
    await beforeRequest();
    let response: Response;
    try {
      const requestTimeoutMilliseconds = configuration.requestTimeoutMilliseconds ?? 15_000;
      if (
        !Number.isInteger(requestTimeoutMilliseconds) ||
        requestTimeoutMilliseconds < 10 ||
        requestTimeoutMilliseconds > 60_000
      )
        throw new Error("Teams Graph request timeout is invalid.");
      response = await (configuration.fetcher ?? fetch)(next, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        signal: AbortSignal.any([interruptSignal, AbortSignal.timeout(requestTimeoutMilliseconds)]),
      });
    } catch {
      if (interruptSignal.aborted) throw interruptSignal.reason;
      if (transientRetries >= 8)
        throw new Error("Teams message pagination exceeded its transient retry bound.");
      await delay(
        configuration,
        retryDelayMilliseconds(undefined, transientRetries, configuration.now?.() ?? new Date()),
        interruptSignal,
      );
      transientRetries += 1;
      continue;
    }
    if (retryableGraphReadStatus(response.status)) {
      if (transientRetries >= 8)
        throw new Error("Teams message pagination exceeded its transient retry bound.");
      await delay(
        configuration,
        retryDelayMilliseconds(response, transientRetries, configuration.now?.() ?? new Date()),
        interruptSignal,
      );
      transientRetries += 1;
      continue;
    }
    if (!response.ok) throw new Error(`Teams knowledge read failed with HTTP ${response.status}.`);
    transientRetries = 0;
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
  conversation: TeamsKnowledgeConversation,
  message: TeamsMessage,
  rootId: string,
): NormalizedMessage | undefined => {
  const webUrl =
    message.webUrl ?? (isKnowledgeChat(conversation) ? conversation.canonicalUrl : null);
  if (
    message.id === undefined ||
    message.createdDateTime === undefined ||
    message.messageType !== "message" ||
    webUrl == null ||
    !webUrl.startsWith("https://teams.microsoft.com/")
  )
    return undefined;
  const content = textContent(message.body?.content);
  const deletedAt = message.deletedDateTime ?? undefined;
  const authorId = message.from?.user?.id;
  const authorApplicationId = message.from?.application?.id;
  const excluded =
    deletedAt === undefined &&
    (content === "" ||
      financeContent(content) ||
      testContent(content) ||
      assistantPrompt(content, configuration.assistantName ?? "Sarathi") ||
      (authorId !== undefined && configuration.excludedAuthorIds?.includes(authorId) === true) ||
      authorApplicationId !== undefined ||
      (configuration.botApplicationId !== undefined &&
        authorApplicationId === configuration.botApplicationId));
  if (excluded) return undefined;
  const modifiedAt = message.lastModifiedDateTime ?? message.createdDateTime;
  const mentions = (message.mentions ?? []).flatMap(({ mentioned }) => {
    const identity = mentioned?.user;
    return identity?.id === undefined && identity?.displayName === undefined ? [] : [identity];
  });
  const attachments = (message.attachments ?? []).map((attachment, index) => {
    const reference = messageReference(attachment);
    return {
      id: attachment.id ?? String(index),
      contentType: attachment.contentType ?? "unknown",
      name: attachment.name ?? "attachment",
      ...(attachment.contentUrl == null ? {} : { contentUrl: attachment.contentUrl }),
      ...(attachment.teamsAppId == null ? {} : { teamsAppId: attachment.teamsAppId }),
      ...(reference === undefined ? {} : { messageReference: reference }),
    };
  });
  const referencedMessageId = attachments.find(
    ({ messageReference: reference }) => reference !== undefined,
  )?.messageReference?.messageId;
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
    ...(message.replyToId == null && referencedMessageId === undefined
      ? {}
      : { parentId: message.replyToId ?? referencedMessageId }),
    createdAt: message.createdDateTime,
    modifiedAt,
    ...(deletedAt === undefined ? {} : { deletedAt }),
    title: message.subject?.trim() || conversation.label,
    content,
    authorId,
    authorName: message.from?.user?.displayName,
    mentions,
    attachments,
    webUrl,
    version,
  };
};

const readChannelMessages = async (
  configuration: TeamsKnowledgeSourceConfiguration,
  channel: TeamsKnowledgeChannel,
  accessToken: string,
  historySince: string,
  beforeRequest: () => Promise<void>,
  interruptSignal: AbortSignal,
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
    `${baseUrl}?%24top=20&%24expand=replies`,
    beforeRequest,
    interruptSignal,
    100,
    (page) =>
      page.length > 0 &&
      page.every(
        ({ lastModifiedDateTime, createdDateTime }) =>
          Date.parse(lastModifiedDateTime ?? createdDateTime ?? historySince) <
          Date.parse(historySince),
      ),
  );
  const expandedRepliesAvailable = roots.every(({ replies }) => replies !== undefined);
  const threads: NormalizedMessage[] = [];
  for (let offset = 0; offset < roots.length; offset += 4) {
    const batch = roots.slice(offset, offset + 4).filter((root) => root.id !== undefined);
    const results = await Promise.all(
      batch.map(async (root) => {
        const rootId = root.id as string;
        const overflowUrl = root["replies@odata.nextLink"];
        const expandedReplies = root.replies ?? [];
        const replies = !expandedRepliesAvailable
          ? await readPages(
              configuration,
              accessToken,
              `${baseUrl}/${encodeURIComponent(rootId)}/replies?%24top=50`,
              beforeRequest,
              interruptSignal,
            )
          : overflowUrl === undefined
            ? expandedReplies
            : [
                ...expandedReplies,
                ...(await readPages(
                  configuration,
                  accessToken,
                  validGraphNextLink(overflowUrl),
                  beforeRequest,
                  interruptSignal,
                )),
              ];
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

const readChatMessages = async (
  configuration: TeamsKnowledgeSourceConfiguration,
  chat: TeamsKnowledgeChat,
  accessToken: string,
  historySince: string,
  beforeRequest: () => Promise<void>,
  interruptSignal: AbortSignal,
): Promise<readonly NormalizedMessage[]> => {
  if (
    chat.chatId.trim() === "" ||
    chat.chatId.includes("/") ||
    chat.label.trim() === "" ||
    chat.acl.length === 0 ||
    !chat.canonicalUrl.startsWith("https://teams.microsoft.com/")
  )
    throw new Error(
      "Teams knowledge chats require a stable identity, label, Teams URL, and explicit ACL.",
    );
  const url = new URL(
    `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chat.chatId)}/messages`,
  );
  url.searchParams.set("$top", "50");
  url.searchParams.set("$orderby", "lastModifiedDateTime desc");
  url.searchParams.set("$filter", `lastModifiedDateTime gt ${historySince}`);
  const messages = await readPages(
    configuration,
    accessToken,
    url.toString(),
    beforeRequest,
    interruptSignal,
  );
  return messages
    .flatMap((message) => {
      const rootId = message.replyToId ?? message.id;
      if (rootId === undefined) return [];
      const normalized = normalizeMessage(configuration, chat, message, rootId);
      return normalized === undefined ? [] : [normalized];
    })
    .filter((message) =>
      [message.createdAt, message.modifiedAt, message.deletedAt]
        .filter((value) => value !== undefined)
        .some((value) => Date.parse(value) >= Date.parse(historySince)),
    )
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
  conversation: TeamsKnowledgeConversation,
  message: NormalizedMessage,
): DeliveryProjection => {
  const conversationKey = isKnowledgeChat(conversation)
    ? `teams:chat:${conversation.chatId}`
    : `teams:${conversation.teamId}:${conversation.channelId}`;
  const channelRef: DeliveryObjectRef = {
    kind: "team",
    externalKey: conversationKey,
  };
  const authorRef: DeliveryObjectRef | undefined =
    message.authorId === undefined
      ? undefined
      : { kind: "person", externalKey: `entra:${message.authorId}` };
  const role = messageRole(message.content);
  const objects: DeliveryObjectDraft[] = [
    {
      ...channelRef,
      title: conversation.label,
      lifecycleState: "active",
      attributes: isKnowledgeChat(conversation)
        ? { chatId: conversation.chatId, chatType: conversation.chatType }
        : { teamId: conversation.teamId, channelId: conversation.channelId },
      sensitivity: conversation.sensitivity,
    },
    ...(authorRef === undefined
      ? []
      : [
          {
            ...authorRef,
            title: message.authorName ?? message.authorId ?? "Teams member",
            lifecycleState: "active",
            attributes: { provider: "entra" },
            sensitivity: conversation.sensitivity,
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
      sensitivity: conversation.sensitivity,
    });
  for (const key of workItemKeys(message.content)) {
    const workItem: DeliveryObjectRef = { kind: "work_item", externalKey: key };
    objects.push({
      ...workItem,
      title: key,
      attributes: { referencedBy: message.webUrl },
      sensitivity: conversation.sensitivity,
    });
    relations.push({
      kind: role === "commitment" ? "contributes_to" : "relates_to",
      from: channelRef,
      to: workItem,
      attributes: { messageId: message.id },
      sensitivity: conversation.sensitivity,
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
        dedupeKey: `${conversationKey}:${message.id}`,
        occurredAt: message.createdAt,
        citationUrl: message.webUrl,
        sensitivity: conversation.sensitivity,
        authority: conversation.authority ?? 0.82,
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
              externalAssertionId: `${conversationKey}:${message.id}`,
              assertedAt: message.createdAt,
              citationUrl: message.webUrl,
              sensitivity: conversation.sensitivity,
              authority: conversation.authority ?? 0.82,
            },
          ],
  };
};

const contextualPassages = (
  target: NormalizedMessage,
  thread: readonly NormalizedMessage[],
  conversation: TeamsKnowledgeConversation,
): readonly KnowledgePassageDraft[] => {
  const active = thread.filter(
    (message) => message.deletedAt === undefined && !acknowledgement(message.content),
  );
  if (target.deletedAt !== undefined || acknowledgement(target.content)) return [];
  const targetIndex = active.findIndex((message) => message.id === target.id);
  if (targetIndex < 0) return [];
  const identifiers = (message: NormalizedMessage): readonly string[] => [
    ...new Set(
      message.content.match(
        /\b[A-Z][A-Z0-9]+-\d+\b|\b(?:PR|pull request)\s*#?\d+\b|\b[\w.-]+\/[\w.-]+\b/gi,
      ) ?? [],
    ),
  ];
  const hasSharedIdentifier = (left: NormalizedMessage, right: NormalizedMessage): boolean => {
    const leftIds = new Set(identifiers(left).map((value) => value.toLocaleLowerCase("en")));
    return identifiers(right).some((value) => leftIds.has(value.toLocaleLowerCase("en")));
  };
  const explicitlyRelated = (left: NormalizedMessage, right: NormalizedMessage): boolean =>
    right.parentId === left.id ||
    left.parentId === right.id ||
    right.attachments.some(({ messageReference: reference }) => reference?.messageId === left.id) ||
    left.attachments.some(({ messageReference: reference }) => reference?.messageId === right.id);
  const spans: NormalizedMessage[][] = [];
  for (const message of active) {
    const current = spans.at(-1);
    const previous = current?.at(-1);
    const gapMilliseconds =
      previous === undefined ? 0 : Date.parse(message.createdAt) - Date.parse(previous.createdAt);
    const beginsNewSpan =
      previous !== undefined &&
      !explicitlyRelated(previous, message) &&
      !hasSharedIdentifier(previous, message) &&
      (gapMilliseconds > 6 * 60 * 60 * 1_000 ||
        /\b(?:new topic|separately|unrelated|moving on)\b/i.test(message.content));
    if (current === undefined || beginsNewSpan) spans.push([message]);
    else current.push(message);
  }
  const span = spans.find((candidate) => candidate.some((message) => message.id === target.id)) ?? [
    target,
  ];
  const spanLocator = `#conversation-${encodeURIComponent(span[0]?.id ?? target.id)}-${encodeURIComponent(span.at(-1)?.id ?? target.id)}`;
  const chatLine = (message: NormalizedMessage): string => {
    const reference = message.attachments.find(
      ({ messageReference: candidate }) => candidate !== undefined,
    )?.messageReference;
    return [
      ...(reference === undefined
        ? []
        : [`Replying to ${reference.authorName ?? "team member"}: ${reference.preview}`]),
      `[${message.createdAt}] ${message.authorName ?? "Team member"} (${messageRole(message.content)}): ${message.content}`,
    ].join("\n");
  };
  const parentBody = span.map(chatLine).join("\n");
  const parentChunks = [] as KnowledgePassageDraft[];
  const maximumCharacters = 6_000;
  for (let offset = 0; offset < parentBody.length; offset += maximumCharacters) {
    const chunk = parentBody.slice(offset, offset + maximumCharacters);
    const part = Math.floor(offset / maximumCharacters) + 1;
    const passage = createTypedPassage(
      "conversation-span",
      parentBody.length <= maximumCharacters ? spanLocator : `${spanLocator}:part-${part}`,
      parentChunks.length,
      target.title,
      chunk,
      {
        hierarchy: [conversation.label, target.title],
        attributes: {
          participants: [
            ...new Set(
              span.flatMap(({ authorName }) => (authorName === undefined ? [] : [authorName])),
            ),
          ],
          identifiers: [...new Set(span.flatMap(identifiers))],
          messageIds: span.map(({ id }) => id),
          roles: [...new Set(span.map(({ content }) => messageRole(content)))],
        },
      },
    );
    if (passage !== undefined) parentChunks.push(passage);
  }
  const atomic = createTypedPassage(
    `message-${messageRole(target.content)}`,
    `#message-${encodeURIComponent(target.id)}`,
    parentChunks.length,
    target.title,
    chatLine(target),
    {
      parentLocator: spanLocator,
      hierarchy: [conversation.label, target.title],
      attributes: {
        messageIds: [target.id],
        identifiers: identifiers(target),
        roles: [messageRole(target.content)],
        ...(target.parentId === undefined ? {} : { repliesTo: target.parentId }),
      },
    },
  );
  return atomic === undefined ? parentChunks : [...parentChunks, atomic];
};

const asDocument = (
  configuration: TeamsKnowledgeSourceConfiguration,
  conversation: TeamsKnowledgeConversation,
  message: NormalizedMessage,
  thread: readonly NormalizedMessage[],
): KnowledgeSourceDocument | undefined => {
  const passages = contextualPassages(message, thread, conversation);
  if (passages.length === 0) return undefined;
  const contextVersion = isKnowledgeChat(conversation)
    ? stableSha256(`${message.version}\n${passages.map(({ body }) => body).join("\n")}`)
    : message.id === message.rootId
      ? stableSha256(thread.map(({ id, version }) => `${id}:${version}`).join("\n"))
      : stableSha256(
          `${message.version}\n${thread.find(({ id }) => id === message.rootId)?.version ?? "missing-root"}`,
        );
  const sourceUpdatedAt = isKnowledgeChat(conversation)
    ? message.modifiedAt
    : message.id === message.rootId
      ? thread.reduce(
          (latest, candidate) => (candidate.modifiedAt > latest ? candidate.modifiedAt : latest),
          message.modifiedAt,
        )
      : message.modifiedAt;
  return {
    source: "teams",
    sourceId: configuration.sourceId,
    workspaceId: configuration.workspaceId,
    externalId: externalId(conversation, message.id),
    sourceType: isKnowledgeChat(conversation)
      ? "chat_message"
      : message.id === message.rootId
        ? "thread"
        : "thread_reply",
    sourceVersion: contextVersion,
    canonicalUrl: message.webUrl,
    title: message.title,
    sourceCreatedAt: message.createdAt,
    sourceUpdatedAt,
    sensitivity: conversation.sensitivity,
    authority: conversation.authority ?? 0.82,
    provenance: {
      ...(isKnowledgeChat(conversation)
        ? { chatId: conversation.chatId, chatType: conversation.chatType }
        : { teamId: conversation.teamId, channelId: conversation.channelId }),
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
    acl: conversation.acl,
    passages,
    deliveryProjection: projection(conversation, message),
  };
};

const readConversation = async (
  configuration: TeamsKnowledgeSourceConfiguration,
  conversation: TeamsKnowledgeConversation,
  accessToken: string,
  historySince: string,
  interruptSignal: AbortSignal,
  previous?: ChannelCursor,
): Promise<{
  readonly documents: readonly KnowledgeSourceDocument[];
  readonly retiredExternalIds: readonly string[];
  readonly cursor: ChannelCursor;
}> => {
  const beforeRequest = createConversationRequestGate(configuration, interruptSignal);
  const messages = isKnowledgeChat(conversation)
    ? await readChatMessages(
        configuration,
        conversation,
        accessToken,
        historySince,
        beforeRequest,
        interruptSignal,
      )
    : await readChannelMessages(
        configuration,
        conversation,
        accessToken,
        historySince,
        beforeRequest,
        interruptSignal,
      );
  const threads = new Map<string, NormalizedMessage[]>();
  for (const message of messages) {
    const thread = threads.get(message.rootId) ?? [];
    thread.push(message);
    threads.set(message.rootId, thread);
  }
  const versions: Record<string, string> = {};
  const retiredExternalIds = new Set<string>();
  const documents = messages.flatMap((message) => {
    const id = externalId(conversation, message.id);
    if (message.deletedAt !== undefined) {
      versions[id] = `deleted:${message.version}`;
      if (previous?.messages[id]?.startsWith("deleted:") !== true) retiredExternalIds.add(id);
      return [];
    }
    const document = asDocument(
      configuration,
      conversation,
      message,
      isKnowledgeChat(conversation) ? messages : (threads.get(message.rootId) ?? []),
    );
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
      try: async (interruptSignal) => {
        if (workspaceId !== configuration.workspaceId)
          throw new Error("Teams knowledge source was requested for another workspace.");
        const configuredChats = configuration.chats ?? [];
        const excludedAuthorIds = configuration.excludedAuthorIds ?? [];
        if (excludedAuthorIds.some((id) => id.trim() === ""))
          throw new Error("Teams excluded author identities must be non-empty.");
        if (
          configuration.channels.some(
            (channel) =>
              channel.kind === "private_team_channel" &&
              channel.notificationSubscription !== "reconciliation_only",
          )
        )
          throw new Error("Private Teams channels must use reconciliation-only synchronization.");
        const conversationCount = configuration.channels.length + configuredChats.length;
        if (conversationCount === 0 || conversationCount > 64)
          throw new Error(
            "Teams knowledge synchronization requires 1 to 64 configured channels or chats.",
          );
        const scopeHash = stableSha256(
          JSON.stringify({
            channels: configuration.channels.map(
              ({
                kind,
                teamId,
                channelId,
                label,
                sensitivity,
                acl,
                authority,
                notificationSubscription,
              }) => ({
                kind,
                teamId,
                channelId,
                label,
                sensitivity,
                acl,
                authority,
                notificationSubscription,
              }),
            ),
            chats: configuredChats.map(
              ({ chatId, chatType, label, canonicalUrl, sensitivity, acl, authority }) => ({
                chatId,
                chatType,
                label,
                canonicalUrl,
                sensitivity,
                acl,
                authority,
              }),
            ),
            excludedAuthorIds: [...new Set(excludedAuthorIds)].sort(),
          }),
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
        const conversations: readonly TeamsKnowledgeConversation[] = [
          ...configuration.channels,
          ...configuredChats,
        ];
        const reads: Awaited<ReturnType<typeof readConversation>>[] = [];
        for (let offset = 0; offset < conversations.length; offset += 4) {
          const batch = conversations.slice(offset, offset + 4);
          reads.push(
            ...(await Promise.all(
              batch.map((conversation) =>
                readConversation(
                  configuration,
                  conversation,
                  accessToken,
                  historySince,
                  interruptSignal,
                  isKnowledgeChat(conversation)
                    ? previous?.chats?.[conversationIdentity(conversation)]
                    : previous?.channels[conversationIdentity(conversation)],
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
        const chats = Object.fromEntries(
          configuredChats.map((chat, index) => [
            conversationIdentity(chat),
            reads[configuration.channels.length + index]?.cursor,
          ]),
        ) as Readonly<Record<string, ChannelCursor>>;
        return {
          sourceId: configuration.sourceId,
          source: "teams",
          workspaceId,
          cursor: encodeCursor({ version: 1, scopeHash, channels, chats }),
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

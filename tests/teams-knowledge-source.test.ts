import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  createTeamsKnowledgeSource,
  type TeamsKnowledgeChannel,
  type TeamsKnowledgeChat,
  type TeamsKnowledgeSourceConfiguration,
} from "../src/infrastructure/graph/teams-knowledge-source.ts";

const channel = (): TeamsKnowledgeChannel => ({
  teamId: "team-1",
  channelId: "19:delivery@thread.tacv2",
  label: "Delivery",
  sensitivity: "internal",
  acl: [{ effect: "allow", subjectType: "audience", subjectId: "delivery" }],
});

const chat = (): TeamsKnowledgeChat => ({
  chatId: "19:meeting_example@thread.v2",
  chatType: "meeting",
  label: "Delivery Standup",
  canonicalUrl: "https://teams.microsoft.com/l/chat/19:meeting_example@thread.v2/conversations",
  sensitivity: "internal",
  acl: [{ effect: "allow", subjectType: "audience", subjectId: "delivery" }],
});

const message = (
  id: string,
  content: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  id,
  createdDateTime: "2026-07-20T10:00:00.000Z",
  lastModifiedDateTime: "2026-07-20T10:00:00.000Z",
  messageType: "message",
  body: { contentType: "html", content: `<p>${content}</p>` },
  from: { user: { id: "person-1", displayName: "Delivery Lead" } },
  webUrl: `https://teams.microsoft.com/l/message/19:delivery@thread.tacv2/${id}`,
  ...overrides,
});

describe("Teams knowledge source", () => {
  it("bootstraps authorized threads with contextual passages and excludes unsafe messages", async () => {
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      requests.push(url);
      if (!url.includes("/replies"))
        return Response.json({
          value: [
            message("root-1", "Decision: ship SAR-42 after QA.", {
              createdDateTime: "2025-12-01T10:00:00.000Z",
              lastModifiedDateTime: "2025-12-01T10:00:00.000Z",
            }),
            message("root-2", "Testing bot"),
          ],
        });
      if (url.includes("root-1"))
        return Response.json({
          value: [
            message("reply-1", "We will finish SAR-42 verification tomorrow.", {
              replyToId: "root-1",
              createdDateTime: "2026-07-20T10:05:00.000Z",
              lastModifiedDateTime: "2026-07-20T10:06:00.000Z",
              mentions: [{ mentioned: { user: { id: "person-2", displayName: "Reviewer" } } }],
              attachments: [
                {
                  id: "attachment-1",
                  contentType: "reference",
                  name: "Acceptance.md",
                  contentUrl: "https://example.sharepoint.com/acceptance",
                },
              ],
            }),
            message("reply-ack", "Thanks", { replyToId: "root-1" }),
            message("reply-finance", "The project budget is confidential", { replyToId: "root-1" }),
            message("reply-bot", "Automated project status", {
              replyToId: "root-1",
              from: { application: { id: "bot-1", displayName: "Bot" } },
            }),
          ],
        });
      return Response.json({ value: [] });
    });
    const configuration: TeamsKnowledgeSourceConfiguration = {
      sourceId: "teams-example",
      workspaceId: "example",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      channels: [channel()],
      historySince: "2026-01-20T00:00:00.000Z",
      now: () => new Date("2026-07-22T00:00:00.000Z"),
      fetcher,
      minimumRequestIntervalMilliseconds: 0,
    };

    const snapshot = await Effect.runPromise(
      createTeamsKnowledgeSource(configuration).readSnapshot("example"),
    );

    expect(snapshot).toMatchObject({ source: "teams", mode: "full", retiredExternalIds: [] });
    expect(snapshot.cursor).toMatch(/^teams-v1:/);
    expect(snapshot.documents.map(({ externalId }) => externalId)).toEqual([
      "team-1:19:delivery@thread.tacv2:reply-1",
      "team-1:19:delivery@thread.tacv2:root-1",
    ]);
    const root = snapshot.documents.find(({ sourceType }) => sourceType === "thread");
    expect(root?.sourceUpdatedAt).toBe("2026-07-20T10:06:00.000Z");
    expect(root?.passages[0]?.body).toContain("Decision: ship SAR-42 after QA.");
    expect(root?.passages[0]?.body).toContain("finish SAR-42 verification tomorrow");
    expect(JSON.stringify(snapshot.documents)).not.toContain("project budget");
    expect(JSON.stringify(snapshot.documents)).not.toContain("Automated project status");
    expect(JSON.stringify(snapshot.documents)).not.toContain("Thanks");
    const reply = snapshot.documents.find(({ sourceType }) => sourceType === "thread_reply");
    expect(reply).toMatchObject({
      canonicalUrl: "https://teams.microsoft.com/l/message/19:delivery@thread.tacv2/reply-1",
      provenance: {
        teamId: "team-1",
        channelId: "19:delivery@thread.tacv2",
        threadId: "root-1",
        messageId: "reply-1",
        authorId: "person-1",
        mentions: "person-2",
      },
      acl: [{ subjectId: "delivery" }],
      deliveryProjection: {
        objects: expect.arrayContaining([
          expect.objectContaining({ kind: "person", externalKey: "entra:person-1" }),
          expect.objectContaining({ kind: "work_item", externalKey: "SAR-42" }),
        ]),
        claims: [
          expect.objectContaining({
            predicate: "teams.commitment",
            assertedBy: "entra:person-1",
          }),
        ],
      },
    });
    expect(reply?.provenance.attachments).toContain("Acceptance.md");
    expect(requests.every((url) => url.startsWith("https://graph.microsoft.com/"))).toBe(true);
  });

  it("versions edits, retires deletions, and repairs a missed notification from full inventory", async () => {
    let revision = 1;
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (!url.includes("/replies"))
        return Response.json({ value: [message("root-1", "Current delivery thread")] });
      return Response.json({
        value:
          revision === 1
            ? [
                message("reply-1", "SAR-42 is in review.", { replyToId: "root-1" }),
                message("reply-2", "SAR-43 is blocked.", { replyToId: "root-1" }),
              ]
            : [
                message("reply-1", "SAR-42 review is approved.", {
                  replyToId: "root-1",
                  lastModifiedDateTime: "2026-07-21T10:00:00.000Z",
                }),
                message("reply-2", "", {
                  replyToId: "root-1",
                  lastModifiedDateTime: "2026-07-21T10:01:00.000Z",
                  deletedDateTime: "2026-07-21T10:01:00.000Z",
                }),
                message("reply-3", "SAR-44 is ready for QA.", {
                  replyToId: "root-1",
                  createdDateTime: "2026-07-21T10:02:00.000Z",
                  lastModifiedDateTime: "2026-07-21T10:02:00.000Z",
                }),
              ],
      });
    };
    const source = createTeamsKnowledgeSource({
      sourceId: "teams-example",
      workspaceId: "example",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      channels: [channel()],
      historySince: "2026-01-20T00:00:00.000Z",
      fetcher,
      minimumRequestIntervalMilliseconds: 0,
    });

    const first = await Effect.runPromise(source.readSnapshot("example"));
    revision = 2;
    const repair = await Effect.runPromise(source.readSnapshot("example", first.cursor));

    expect(repair).toMatchObject({
      mode: "delta",
      retiredExternalIds: ["team-1:19:delivery@thread.tacv2:reply-2"],
    });
    expect(repair.documents.map(({ externalId }) => externalId)).toEqual([
      "team-1:19:delivery@thread.tacv2:reply-1",
      "team-1:19:delivery@thread.tacv2:reply-3",
      "team-1:19:delivery@thread.tacv2:root-1",
    ]);
    expect(
      repair.documents.find(({ externalId }) => externalId.endsWith("reply-1"))?.passages[0]?.body,
    ).toContain("review is approved");
    expect(JSON.stringify(repair.documents)).not.toContain("SAR-43 is blocked");
  });

  it("rejects pagination links that could leak the Graph token", async () => {
    const source = createTeamsKnowledgeSource({
      sourceId: "teams-example",
      workspaceId: "example",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      channels: [channel()],
      fetcher: async () =>
        Response.json({ value: [], "@odata.nextLink": "https://attacker.example/messages" }),
      minimumRequestIntervalMilliseconds: 0,
    });

    await expect(Effect.runPromise(source.readSnapshot("example"))).rejects.toThrow(
      "Configured Teams knowledge synchronization failed",
    );
  });

  it("retries transient Graph responses and transport failures with bounded backoff", async () => {
    const retryDelays: number[] = [];
    let attempt = 0;
    const fetcher = vi.fn(async (): Promise<Response> => {
      attempt += 1;
      if (attempt === 1)
        return Response.json(
          { error: { code: "ServiceUnavailable" } },
          { status: 503, headers: { "Retry-After": "0" } },
        );
      if (attempt === 2) throw new TypeError("Synthetic transport interruption");
      return Response.json({ value: [] });
    });
    const source = createTeamsKnowledgeSource({
      sourceId: "teams-example",
      workspaceId: "example",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      channels: [channel()],
      fetcher,
      minimumRequestIntervalMilliseconds: 0,
      retryDelay: async (milliseconds) => {
        retryDelays.push(milliseconds);
      },
    });

    await expect(Effect.runPromise(source.readSnapshot("example"))).resolves.toMatchObject({
      documents: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(retryDelays).toEqual([1_000, 2_000]);
  });

  it("fails deterministic Graph authorization errors without retrying", async () => {
    const retryDelay = vi.fn(async () => undefined);
    const fetcher = vi.fn(async () => Response.json({ error: {} }, { status: 403 }));
    const source = createTeamsKnowledgeSource({
      sourceId: "teams-example",
      workspaceId: "example",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      channels: [channel()],
      fetcher,
      minimumRequestIntervalMilliseconds: 0,
      retryDelay,
    });

    await expect(Effect.runPromise(source.readSnapshot("example"))).rejects.toThrow(
      "Configured Teams knowledge synchronization failed",
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(retryDelay).not.toHaveBeenCalled();
  });

  it("fails closed after exhausting the transient Graph retry bound", async () => {
    const retryDelays: number[] = [];
    const fetcher = vi.fn(async () => Response.json({ error: {} }, { status: 503 }));
    const source = createTeamsKnowledgeSource({
      sourceId: "teams-example",
      workspaceId: "example",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      channels: [channel()],
      fetcher,
      minimumRequestIntervalMilliseconds: 0,
      retryDelay: async (milliseconds) => {
        retryDelays.push(milliseconds);
      },
    });

    await expect(Effect.runPromise(source.readSnapshot("example"))).rejects.toThrow(
      "Configured Teams knowledge synchronization failed",
    );
    expect(fetcher).toHaveBeenCalledTimes(9);
    expect(retryDelays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  });

  it("paginates an explicitly mapped meeting chat and builds contextual conversation windows", async () => {
    const requests: string[] = [];
    const retryDelays: number[] = [];
    let throttled = false;
    const fetcher = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      requests.push(url);
      if (url.includes("page=2"))
        return Response.json({
          value: [
            message("chat-1", "Please test the publishing cron today.", {
              createdDateTime: "2026-07-20T09:00:00.000Z",
              lastModifiedDateTime: "2026-07-20T09:00:00.000Z",
              webUrl: null,
            }),
          ],
        });
      if (!throttled) {
        throttled = true;
        return Response.json(
          { error: { code: "TooManyRequests" } },
          { status: 429, headers: { "Retry-After": "0" } },
        );
      }
      return Response.json({
        value: [
          message("chat-noise", "Recording has started. View the notes here.", {
            createdDateTime: "2026-07-20T09:12:00.000Z",
            lastModifiedDateTime: "2026-07-20T09:12:00.000Z",
            from: { user: { id: "notetaker-1", displayName: "Meeting Notetaker" } },
            webUrl: null,
          }),
          message("chat-3", "We will update SAR-45 after the client confirms.", {
            createdDateTime: "2026-07-20T09:10:00.000Z",
            lastModifiedDateTime: "2026-07-20T09:10:00.000Z",
            webUrl: null,
            attachments: [
              {
                id: "chat-1",
                contentType: "messageReference",
                content: JSON.stringify({
                  messageId: "chat-1",
                  messagePreview: "Please test the publishing cron today.",
                  messageSender: { user: { displayName: "Delivery Lead" } },
                }),
              },
            ],
          }),
          message("chat-2", "The team is waiting for QA approval.", {
            createdDateTime: "2026-07-20T09:05:00.000Z",
            lastModifiedDateTime: "2026-07-20T09:05:00.000Z",
            webUrl: null,
          }),
        ],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/chats/19%3Ameeting_example%40thread.v2/messages?page=2",
      });
    });
    const source = createTeamsKnowledgeSource({
      sourceId: "teams-example",
      workspaceId: "example",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      channels: [],
      chats: [chat()],
      excludedAuthorIds: ["notetaker-1"],
      historySince: "2026-07-01T00:00:00.000Z",
      now: () => new Date("2026-07-22T00:00:00.000Z"),
      fetcher,
      minimumRequestIntervalMilliseconds: 0,
      retryDelay: async (milliseconds) => {
        retryDelays.push(milliseconds);
      },
    });

    const snapshot = await Effect.runPromise(source.readSnapshot("example"));

    expect(requests).toHaveLength(3);
    expect(requests[0]).toBe(requests[1]);
    expect(retryDelays).toEqual([1_000]);
    expect(requests[0]).toContain("/v1.0/chats/19%3Ameeting_example%40thread.v2/messages");
    expect(requests[0]).toContain("%24top=50");
    expect(requests[0]).toContain("%24orderby=lastModifiedDateTime+desc");
    expect(requests[0]).toContain("%24filter=lastModifiedDateTime+gt+2026-07-01T00%3A00%3A00.000Z");
    expect(snapshot.documents.map(({ externalId }) => externalId)).toEqual([
      "chat:19:meeting_example@thread.v2:chat-1",
      "chat:19:meeting_example@thread.v2:chat-2",
      "chat:19:meeting_example@thread.v2:chat-3",
    ]);
    const document = snapshot.documents.find(({ externalId }) => externalId.endsWith("chat-2"));
    expect(document).toMatchObject({
      sourceType: "chat_message",
      canonicalUrl: "https://teams.microsoft.com/l/chat/19:meeting_example@thread.v2/conversations",
      provenance: {
        chatId: "19:meeting_example@thread.v2",
        chatType: "meeting",
        messageId: "chat-2",
      },
      deliveryProjection: {
        objects: expect.arrayContaining([
          expect.objectContaining({
            kind: "team",
            externalKey: "teams:chat:19:meeting_example@thread.v2",
          }),
        ]),
      },
    });
    expect(document?.passages[0]?.body).toContain("Please test the publishing cron today.");
    expect(document?.passages[0]?.body).toContain("waiting for QA approval");
    expect(document?.passages[0]?.body).toContain("after the client confirms");
    const referencedReply = snapshot.documents.find(({ externalId }) =>
      externalId.endsWith("chat-3"),
    );
    expect(referencedReply?.provenance).toMatchObject({ parentId: "chat-1" });
    expect(referencedReply?.passages[0]?.body).toContain(
      "Replying to Delivery Lead: Please test the publishing cron today.",
    );
    expect(JSON.stringify(snapshot.documents)).not.toContain("Recording has started");
  });

  it("paces requests to one Teams conversation at the documented per-resource limit", async () => {
    let currentTime = Date.parse("2026-07-22T00:00:00.000Z");
    const delays: number[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      Response.json({
        value: String(input).includes("/replies")
          ? []
          : [1, 2, 3, 4].map((index) => message(`root-${index}`, `Delivery status ${index}`)),
      }),
    );
    const source = createTeamsKnowledgeSource({
      sourceId: "teams-example",
      workspaceId: "example",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      channels: [channel()],
      historySince: "2026-07-01T00:00:00.000Z",
      now: () => new Date(currentTime),
      fetcher,
      minimumRequestIntervalMilliseconds: 1_100,
      retryDelay: async (milliseconds) => {
        delays.push(milliseconds);
        currentTime += milliseconds;
      },
    });

    await Effect.runPromise(source.readSnapshot("example"));

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(delays).toEqual([1_100, 1_100, 1_100, 1_100]);
  });

  it("requires explicit reconciliation-only synchronization for private channels", async () => {
    const getAccessToken = vi.fn(async () => "must-not-be-used");
    const source = createTeamsKnowledgeSource({
      sourceId: "teams-example",
      workspaceId: "example",
      tokenProvider: { getAccessToken },
      channels: [{ ...channel(), kind: "private_team_channel" }],
      historySince: "2026-07-01T00:00:00.000Z",
      minimumRequestIntervalMilliseconds: 0,
    });

    await expect(Effect.runPromise(source.readSnapshot("example"))).rejects.toThrow(
      "Configured Teams knowledge synchronization failed",
    );
    expect(getAccessToken).not.toHaveBeenCalled();

    const requests: string[] = [];
    const accepted = createTeamsKnowledgeSource({
      sourceId: "teams-example",
      workspaceId: "example",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      channels: [
        {
          ...channel(),
          kind: "private_team_channel",
          notificationSubscription: "reconciliation_only",
        },
      ],
      historySince: "2026-07-01T00:00:00.000Z",
      fetcher: async (input) => {
        requests.push(String(input));
        return Response.json({ value: [] });
      },
      minimumRequestIntervalMilliseconds: 0,
    });
    await expect(Effect.runPromise(accepted.readSnapshot("example"))).resolves.toMatchObject({
      source: "teams",
      documents: [],
    });
    expect(requests[0]).toContain("/teams/team-1/channels/19%3Adelivery%40thread.tacv2/messages");
  });

  it("uses bounded exponential floors when Graph returns unusable retry intervals", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const fetcher = vi.fn(async () => {
      attempts += 1;
      return attempts <= 5
        ? Response.json(
            { error: { code: "TooManyRequests" } },
            { status: 429, headers: { "Retry-After": "0" } },
          )
        : Response.json({ value: [] });
    });
    const source = createTeamsKnowledgeSource({
      sourceId: "teams-example",
      workspaceId: "example",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      channels: [],
      chats: [chat()],
      historySince: "2026-07-01T00:00:00.000Z",
      fetcher,
      minimumRequestIntervalMilliseconds: 0,
      retryDelay: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    await Effect.runPromise(source.readSnapshot("example"));

    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
  });

  it("fails closed after the bounded Microsoft Graph throttle retries are exhausted", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { error: { code: "TooManyRequests" } },
        { status: 429, headers: { "Retry-After": "0" } },
      ),
    );
    const source = createTeamsKnowledgeSource({
      sourceId: "teams-example",
      workspaceId: "example",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      channels: [],
      chats: [chat()],
      historySince: "2026-07-01T00:00:00.000Z",
      now: () => new Date("2026-07-22T00:00:00.000Z"),
      fetcher,
      minimumRequestIntervalMilliseconds: 0,
      retryDelay: async () => undefined,
    });

    await expect(Effect.runPromise(source.readSnapshot("example"))).rejects.toThrow(
      "Configured Teams knowledge synchronization failed",
    );
    expect(fetcher).toHaveBeenCalledTimes(9);
  });
});

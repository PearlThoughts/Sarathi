import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  createTeamsKnowledgeSource,
  type TeamsKnowledgeChannel,
  type TeamsKnowledgeSourceConfiguration,
} from "../src/infrastructure/graph/teams-knowledge-source.ts";

const channel = (): TeamsKnowledgeChannel => ({
  teamId: "team-1",
  channelId: "19:delivery@thread.tacv2",
  label: "Delivery",
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
    });

    await expect(Effect.runPromise(source.readSnapshot("example"))).rejects.toThrow(
      "Configured Teams knowledge synchronization failed",
    );
  });
});

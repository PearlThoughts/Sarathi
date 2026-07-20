import { describe, expect, it, vi } from "vitest";
import {
  createTeamsGraphThreadReader,
  type TeamsGraphThreadReaderConfiguration,
  teamsThreadSourceKey,
} from "../src/infrastructure/graph/index.ts";

describe("Teams Graph thread reader", () => {
  it("does not call Graph for an unapproved channel", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const configuration: TeamsGraphThreadReaderConfiguration = {
      tokenProvider: { getAccessToken: async () => "synthetic" },
      allowedStandardChannels: new Set(),
      fetcher: fetcher as unknown as typeof fetch,
    };
    const reader = createTeamsGraphThreadReader(configuration);
    await expect(
      reader.readEvidence({
        workspaceId: "workspace",
        sourceKey: "teams:team:channel:root",
      }),
    ).resolves.toEqual({ records: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads a bounded workspace thread and removes markup from message context", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "root-1",
            createdDateTime: "2026-07-10T00:00:00Z",
            subject: "Root status",
            body: { content: "<p>Approved root context</p>" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                id: "reply-1",
                createdDateTime: "2026-07-11T00:00:00Z",
                subject: "Status",
                body: { content: "<b>Ready</b> for verification" },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    const reader = createTeamsGraphThreadReader({
      tokenProvider: { getAccessToken: async () => "synthetic" },
      allowedStandardChannels: new Set(["team:19:channel@thread.tacv2"]),
      fetcher: fetcher as unknown as typeof fetch,
      pageSize: 1,
    });
    const result = await reader.readEvidence({
      workspaceId: "workspace",
      sourceKey: teamsThreadSourceKey({
        teamId: "team",
        channelId: "19:channel@thread.tacv2",
        rootId: "root:message",
      }),
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0].toString()).not.toContain("/replies");
    expect(fetcher.mock.calls[1]?.[0].toString()).toContain("%24top=1");
    expect(result.records).toMatchObject([
      { externalId: "root-1", bodyExcerpt: "Approved root context" },
      { externalId: "reply-1", bodyExcerpt: "Ready for verification" },
    ]);
  });
});

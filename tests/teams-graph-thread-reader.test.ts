import { describe, expect, it, vi } from "vitest";
import {
  createTeamsGraphThreadReader,
  type TeamsGraphThreadReaderConfiguration,
} from "../src/infrastructure/graph/index.ts";

describe("Teams Graph thread reader", () => {
  it("does not call Graph for an unapproved channel", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const configuration: TeamsGraphThreadReaderConfiguration = {
      tokenProvider: { getAccessToken: async () => "synthetic" },
      approvedStandardChannels: new Set(),
      fetcher: fetcher as unknown as typeof fetch,
    };
    const reader = createTeamsGraphThreadReader(configuration);
    await expect(
      reader.readEvidence({ workspaceId: "workspace", sourceKey: "teams:team:channel:root" }),
    ).resolves.toEqual({ records: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads a bounded approved thread and removes markup from evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
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
      approvedStandardChannels: new Set(["team:channel"]),
      fetcher: fetcher as unknown as typeof fetch,
      pageSize: 1,
    });
    const result = await reader.readEvidence({
      workspaceId: "workspace",
      sourceKey: "teams:team:channel:root",
    });
    expect(fetcher.mock.calls[0]?.[0].toString()).toContain("%24top=1");
    expect(result.records).toMatchObject([
      { externalId: "reply-1", bodyExcerpt: "Ready for verification" },
    ]);
  });
});

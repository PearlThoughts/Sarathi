import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createTeamsGraphMembershipResolver } from "../src/infrastructure/graph/index.ts";

const conversation = {
  kind: "standard_team_channel",
  tenantId: "tenant-synthetic",
  teamId: "team-synthetic",
  graphTeamId: "graph-team-synthetic",
  channelId: "channel-synthetic",
} as const;

const request = {
  conversation,
  entraObjectId: "MEMBER-SYNTHETIC",
} as const;

const chatConversation = {
  kind: "meeting_chat",
  tenantId: "tenant-synthetic",
  chatId: "19:meeting_synthetic@thread.v2",
} as const;

const tokenProvider = {
  getAccessToken: vi.fn(async () => "synthetic-token"),
};

describe("Teams Graph membership resolver", () => {
  it("resolves a current standard-team member from every bounded Graph page", async () => {
    const requests: URL[] = [];
    const resolver = createTeamsGraphMembershipResolver({
      tokenProvider,
      now: () => Date.parse("2026-08-01T08:00:00.000Z"),
      cacheTtlMs: 60_000,
      fetcher: vi.fn(async (input) => {
        const url = new URL(input.toString());
        requests.push(url);
        return url.searchParams.has("page")
          ? Response.json({ value: [{ userId: "member-synthetic" }] })
          : Response.json({
              value: [{ userId: "another-member" }],
              "@odata.nextLink":
                "https://graph.microsoft.com/v1.0/teams/graph-team-synthetic/members?page=2",
            });
      }),
    });

    await expect(Effect.runPromise(resolver.resolveMembership(request))).resolves.toEqual({
      member: true,
      source: "microsoft_graph_roster",
      resolvedAt: "2026-08-01T08:00:00.000Z",
      expiresAt: "2026-08-01T08:01:00.000Z",
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.pathname).toBe("/v1.0/teams/graph-team-synthetic/members");
    expect(requests[0]?.searchParams.get("$select")).toBe("userId");
  });

  it("shares one short-lived roster read across callers and refreshes after expiry", async () => {
    let clock = Date.parse("2026-08-01T08:00:00.000Z");
    const fetcher = vi.fn(async () => Response.json({ value: [{ userId: "member-synthetic" }] }));
    const resolver = createTeamsGraphMembershipResolver({
      tokenProvider,
      now: () => clock,
      cacheTtlMs: 60_000,
      fetcher,
    });

    const first = resolver.resolveMembership(request);
    const second = resolver.resolveMembership({ ...request, entraObjectId: "non-member" });
    await expect(
      Effect.runPromise(Effect.all([first, second], { concurrency: "unbounded" })),
    ).resolves.toEqual([
      expect.objectContaining({ member: true }),
      expect.objectContaining({ member: false }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    clock += 60_001;
    await Effect.runPromise(resolver.resolveMembership(request));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    "group_chat",
    "meeting_chat",
  ] as const)("resolves a current %s participant from the chat roster", async (kind) => {
    const requests: URL[] = [];
    const resolver = createTeamsGraphMembershipResolver({
      tokenProvider,
      now: () => Date.parse("2026-08-01T08:00:00.000Z"),
      cacheTtlMs: 60_000,
      fetcher: vi.fn(async (input) => {
        requests.push(new URL(input.toString()));
        return Response.json({ value: [{ userId: "member-synthetic" }] });
      }),
    });

    await expect(
      Effect.runPromise(
        resolver.resolveMembership({
          conversation: { ...chatConversation, kind },
          entraObjectId: "MEMBER-SYNTHETIC",
        }),
      ),
    ).resolves.toMatchObject({ member: true, source: "microsoft_graph_roster" });
    expect(requests[0]?.pathname).toBe("/v1.0/chats/19%3Ameeting_synthetic%40thread.v2/members");
    expect(requests[0]?.searchParams.has("$select")).toBe(false);
  });

  it("keeps team and chat roster caches isolated", async () => {
    const fetcher = vi.fn(async () => Response.json({ value: [{ userId: "member-synthetic" }] }));
    const resolver = createTeamsGraphMembershipResolver({ tokenProvider, fetcher });

    await Effect.runPromise(resolver.resolveMembership(request));
    await Effect.runPromise(
      resolver.resolveMembership({
        conversation: chatConversation,
        entraObjectId: request.entraObjectId,
      }),
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([403, 404, 429] as const)("fails closed for Graph HTTP %s", async (status) => {
    const resolver = createTeamsGraphMembershipResolver({
      tokenProvider,
      fetcher: vi.fn(async () => new Response(undefined, { status })),
    });

    await expect(Effect.runPromise(resolver.resolveMembership(request))).rejects.toThrow(
      `Teams membership read failed with HTTP ${status}.`,
    );
  });

  it("fails closed when the Graph request times out", async () => {
    const resolver = createTeamsGraphMembershipResolver({
      tokenProvider,
      fetcher: vi.fn(async () => {
        throw new DOMException("request timed out", "TimeoutError");
      }),
    });

    await expect(Effect.runPromise(resolver.resolveMembership(request))).rejects.toThrow(
      "Teams membership could not be resolved.",
    );
  });

  it("rejects an unsafe pagination boundary without forwarding its token", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        value: [],
        "@odata.nextLink": "https://example.invalid/collect-token",
      }),
    );
    const resolver = createTeamsGraphMembershipResolver({ tokenProvider, fetcher });

    await expect(Effect.runPromise(resolver.resolveMembership(request))).rejects.toThrow(
      "left the Microsoft Graph boundary",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    "private_team_channel",
    "shared_team_channel",
    "personal_chat",
  ] as const)("denies unsupported %s before token acquisition or Graph access", async (kind) => {
    const getAccessToken = vi.fn(async () => "must-not-be-used");
    const fetcher = vi.fn(async () => Response.json({ value: [] }));
    const resolver = createTeamsGraphMembershipResolver({
      tokenProvider: { getAccessToken },
      fetcher,
    });

    await expect(
      Effect.runPromise(
        resolver.resolveMembership({
          ...request,
          conversation:
            kind === "personal_chat" ? { ...chatConversation, kind } : { ...conversation, kind },
        }),
      ),
    ).rejects.toThrow("does not support this conversation kind");
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("denies missing authenticated identity before token acquisition", async () => {
    const getAccessToken = vi.fn(async () => "must-not-be-used");
    const resolver = createTeamsGraphMembershipResolver({
      tokenProvider: { getAccessToken },
      fetcher: vi.fn(async () => Response.json({ value: [] })),
    });

    await expect(
      Effect.runPromise(resolver.resolveMembership({ ...request, entraObjectId: "" })),
    ).rejects.toThrow("requires authenticated resource identities");
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("rejects a cache window longer than the two-minute authorization bound", () => {
    expect(() =>
      createTeamsGraphMembershipResolver({ tokenProvider, cacheTtlMs: 120_001 }),
    ).toThrow("cannot exceed two minutes");
  });
});

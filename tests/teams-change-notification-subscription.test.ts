import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  ensureTeamsChangeNotificationSubscription,
  type TeamsNotificationSubscriptionConfiguration,
  type TeamsProviderSubscription,
  teamsConversationUsesChangeNotifications,
} from "../src/infrastructure/graph/teams-change-notification-subscription.ts";
import type {
  TeamsKnowledgeChannel,
  TeamsKnowledgeChat,
} from "../src/infrastructure/graph/teams-knowledge-source.ts";
import type {
  SynchronizationControlRepository,
  SynchronizationSubscription,
} from "../src/modules/knowledge-layer/index.ts";

const channel: TeamsKnowledgeChannel = {
  teamId: "team-1",
  channelId: "19:delivery@thread.tacv2",
  label: "Delivery",
  sensitivity: "internal",
  acl: [{ effect: "allow", subjectType: "workspace", subjectId: "example" }],
};

describe("Teams change-notification subscription", () => {
  it("keeps explicitly reconciliation-only channels out of the notification path", () => {
    expect(teamsConversationUsesChangeNotifications(channel)).toBe(true);
    expect(
      teamsConversationUsesChangeNotifications({
        ...channel,
        kind: "private_team_channel",
        channelId: "private-channel",
        notificationSubscription: "reconciliation_only",
      }),
    ).toBe(false);
    expect(
      teamsConversationUsesChangeNotifications({
        chatId: "19:meeting_example@thread.v2",
        chatType: "meeting",
        label: "Delivery Standup",
        canonicalUrl:
          "https://teams.microsoft.com/l/chat/19:meeting_example@thread.v2/conversations",
        sensitivity: "internal",
        acl: [{ effect: "allow", subjectType: "workspace", subjectId: "example" }],
      }),
    ).toBe(true);
    expect(() =>
      teamsConversationUsesChangeNotifications({
        ...channel,
        kind: "private_team_channel",
        channelId: "misconfigured-private-channel",
      }),
    ).toThrow("must use reconciliation-only synchronization");
  });

  it("recreates an expired provider subscription and stores only privacy-safe control metadata", async () => {
    const saved: SynchronizationSubscription[] = [];
    const repository: SynchronizationControlRepository = {
      registerEvent: () => Effect.die("not used"),
      saveSubscription: (subscription) =>
        Effect.sync(() => saved.push(subscription)).pipe(Effect.asVoid),
      readSubscriptions: () => Effect.succeed([]),
      acquireLease: () => Effect.die("not used"),
      heartbeatLease: () => Effect.die("not used"),
      releaseLease: () => Effect.die("not used"),
      startRun: () => Effect.die("not used"),
      completeRun: () => Effect.die("not used"),
      updateEvent: () => Effect.die("not used"),
      readStatus: () => Effect.die("not used"),
    };
    const requests: { readonly url: string; readonly init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        ...(init === undefined ? {} : { init }),
      });
      if (init?.method === "PATCH") return new Response("expired", { status: 410 });
      return Response.json({
        id: "subscription-new",
        expirationDateTime: "2026-07-22T12:00:00.000Z",
      });
    });
    const configuration: TeamsNotificationSubscriptionConfiguration = {
      workspaceId: "example",
      sourceId: "teams-example",
      tokenProvider: { getAccessToken: async () => "synthetic-token" },
      controlRepository: repository,
      notificationUrl: "https://sarathi.example/graph/notifications",
      lifecycleNotificationUrl: "https://sarathi.example/graph/lifecycle",
      clientState: "synthetic-protected-client-state",
      lifetimeMinutes: 60,
      renewalLeadMinutes: 15,
      now: () => new Date("2026-07-22T11:00:00.000Z"),
      fetcher,
    };

    const expired: TeamsProviderSubscription = {
      id: "subscription-expired",
      expiresAt: "2026-07-22T11:05:00.000Z",
    };
    const subscription = await Effect.runPromise(
      ensureTeamsChangeNotificationSubscription(configuration, channel, expired),
    );

    expect(requests.map(({ init }) => init?.method)).toEqual(["PATCH", "POST"]);
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      changeType: "created,updated,deleted",
      resource: "teams/team-1/channels/19:delivery@thread.tacv2/messages",
      includeResourceData: false,
    });
    expect(subscription).toMatchObject({
      id: "subscription-new",
      source: "teams",
      provider: "microsoft-graph",
      status: "active",
      retryCount: 0,
      nextRenewalAt: "2026-07-22T11:45:00.000Z",
    });
    expect(subscription.resourceHash).toMatch(/^sha256-/);
    expect(JSON.stringify(subscription)).not.toContain("client-state");
    expect(JSON.stringify(subscription)).not.toContain("graph/notifications");
    expect(saved).toEqual([subscription]);
  });

  it("does not call Graph before the renewal window", async () => {
    const saved: SynchronizationSubscription[] = [];
    const repository: SynchronizationControlRepository = {
      registerEvent: () => Effect.die("not used"),
      saveSubscription: (subscription) =>
        Effect.sync(() => saved.push(subscription)).pipe(Effect.asVoid),
      readSubscriptions: () => Effect.succeed([]),
      acquireLease: () => Effect.die("not used"),
      heartbeatLease: () => Effect.die("not used"),
      releaseLease: () => Effect.die("not used"),
      startRun: () => Effect.die("not used"),
      completeRun: () => Effect.die("not used"),
      updateEvent: () => Effect.die("not used"),
      readStatus: () => Effect.die("not used"),
    };
    const fetcher = vi.fn<typeof fetch>();
    const subscription = await Effect.runPromise(
      ensureTeamsChangeNotificationSubscription(
        {
          workspaceId: "example",
          sourceId: "teams-example",
          tokenProvider: { getAccessToken: async () => "synthetic-token" },
          controlRepository: repository,
          notificationUrl: "https://sarathi.example/graph/notifications",
          lifecycleNotificationUrl: "https://sarathi.example/graph/lifecycle",
          clientState: "synthetic-protected-client-state",
          now: () => new Date("2026-07-22T11:00:00.000Z"),
          fetcher: fetcher as unknown as typeof fetch,
        },
        channel,
        { id: "subscription-current", expiresAt: "2026-07-22T13:00:00.000Z" },
      ),
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(subscription.id).toBe("subscription-current");
    expect(saved).toEqual([subscription]);
  });

  it("subscribes to an explicitly mapped chat conversation", async () => {
    const saved: SynchronizationSubscription[] = [];
    const repository: SynchronizationControlRepository = {
      registerEvent: () => Effect.die("not used"),
      saveSubscription: (subscription) =>
        Effect.sync(() => saved.push(subscription)).pipe(Effect.asVoid),
      readSubscriptions: () => Effect.succeed([]),
      acquireLease: () => Effect.die("not used"),
      heartbeatLease: () => Effect.die("not used"),
      releaseLease: () => Effect.die("not used"),
      startRun: () => Effect.die("not used"),
      completeRun: () => Effect.die("not used"),
      updateEvent: () => Effect.die("not used"),
      readStatus: () => Effect.die("not used"),
    };
    const requests: RequestInit[] = [];
    const chat: TeamsKnowledgeChat = {
      chatId: "19:meeting_example@thread.v2",
      chatType: "meeting",
      label: "Delivery Standup",
      canonicalUrl: "https://teams.microsoft.com/l/chat/19:meeting_example@thread.v2/conversations",
      sensitivity: "internal",
      acl: [{ effect: "allow", subjectType: "workspace", subjectId: "example" }],
    };
    const subscription = await Effect.runPromise(
      ensureTeamsChangeNotificationSubscription(
        {
          workspaceId: "example",
          sourceId: "teams-example",
          tokenProvider: { getAccessToken: async () => "synthetic-token" },
          controlRepository: repository,
          notificationUrl: "https://sarathi.example/graph/notifications",
          lifecycleNotificationUrl: "https://sarathi.example/graph/lifecycle",
          clientState: "synthetic-protected-client-state",
          now: () => new Date("2026-07-22T11:00:00.000Z"),
          fetcher: async (_input, init) => {
            requests.push(init ?? {});
            return Response.json({
              id: "chat-subscription",
              expirationDateTime: "2026-07-22T12:00:00.000Z",
            });
          },
        },
        chat,
      ),
    );

    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      resource: "chats/19:meeting_example@thread.v2/messages",
      changeType: "created,updated,deleted",
    });
    expect(subscription.id).toBe("chat-subscription");
    expect(saved).toEqual([subscription]);
  });
});

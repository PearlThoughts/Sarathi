import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { RepositoryError } from "../src/domain/errors.ts";
import {
  createWorkspaceProjectionResolver,
  type WorkspaceProjection,
  workspaceProjectionAuthorizedActorIds,
  workspaceProjectionDeliveryChannels,
  workspaceProjectionFromEnvironment,
} from "../src/infrastructure/teams/index.ts";

const projection: WorkspaceProjection = {
  channels: [
    {
      tenantId: "tenant-synthetic",
      teamId: "team-synthetic",
      graphTeamId: "graph-team-synthetic",
      channelId: "channel-synthetic",
      scope: "standard" as const,
      workspaceId: "workspace-synthetic",
      sensitivity: "internal" as const,
      actors: [
        {
          entraObjectId: "entra-synthetic",
          actorId: "actor-synthetic",
          trustTier: "member" as const,
        },
      ],
    },
  ],
};

const command = {
  activityId: "activity-synthetic",
  conversation: {
    kind: "team_channel",
    tenantId: "tenant-synthetic",
    teamId: "team-synthetic",
    graphTeamId: "graph-team-synthetic",
    channelId: "channel-synthetic",
  },
  replyTarget: {
    kind: "channel_thread",
    conversationId: "conversation-synthetic",
    rootActivityId: "root-synthetic",
  },
  serviceUrl: "https://service.example.test",
  caller: { entraObjectId: "entra-synthetic", displayName: "Synthetic Member" },
  question: "What is the current goal?",
  receivedAt: "2026-07-11T10:00:00.000Z",
} as const;

const membershipProjection: WorkspaceProjection = {
  version: 2,
  conversations: [
    {
      kind: "standard_team_channel",
      tenantId: "tenant-synthetic",
      teamId: "team-synthetic",
      graphTeamId: "graph-team-synthetic",
      channelId: "channel-synthetic",
      workspaceId: "workspace-synthetic",
      audienceId: "audience-synthetic",
      sensitivity: "internal",
      membership: {
        kind: "team_membership",
        actorId: "team-member-synthetic",
        trustTier: "member",
      },
      permittedAudienceIds: ["audience-synthetic"],
      permittedSourceScopes: ["jira", "teams"],
    },
  ],
};

const chatProjection: WorkspaceProjection = {
  version: 2,
  conversations: [
    {
      kind: "meeting_chat",
      tenantId: "tenant-synthetic",
      chatId: "chat-synthetic",
      workspaceId: "workspace-synthetic",
      audienceId: "chat-audience-synthetic",
      sensitivity: "confidential",
      modelEgress: "allow",
      membership: {
        kind: "chat_membership",
        historyAccess: "current_roster",
        actorId: "chat-participant-synthetic",
        trustTier: "trusted",
      },
      permittedAudienceIds: ["chat-audience-synthetic"],
      permittedSourceScopes: ["jira", "vault", "github", "teams", "strategy"],
    },
  ],
};

const privateChannelProjection: WorkspaceProjection = {
  version: 2,
  conversations: [
    {
      kind: "private_team_channel",
      tenantId: "tenant-synthetic",
      teamId: "team-synthetic",
      graphTeamId: "graph-team-synthetic",
      channelId: "private-channel-synthetic",
      workspaceId: "workspace-synthetic",
      audienceId: "private-channel-audience-synthetic",
      sensitivity: "confidential",
      membership: {
        kind: "channel_membership",
        historyAccess: "current_roster",
        actorId: "private-channel-member-synthetic",
        trustTier: "trusted",
      },
      permittedAudienceIds: ["private-channel-audience-synthetic"],
      permittedSourceScopes: ["jira", "vault", "github", "teams", "strategy"],
    },
  ],
};

const chatCommand = {
  ...command,
  conversation: {
    kind: "meeting_chat",
    tenantId: "tenant-synthetic",
    chatId: "chat-synthetic",
  },
  replyTarget: { kind: "chat", conversationId: "chat-synthetic" },
} as const;

describe("workspace projection resolver", () => {
  it("requires a private JSON projection rather than falling back to an open scope", () => {
    expect(() => workspaceProjectionFromEnvironment({})).toThrow(RepositoryError);
    expect(() =>
      workspaceProjectionFromEnvironment({
        SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON: "{}",
      }),
    ).toThrow(RepositoryError);
    expect(() =>
      workspaceProjectionFromEnvironment({
        SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON: JSON.stringify({ version: 3, channels: [] }),
      }),
    ).toThrow("version is unsupported");
  });

  it("resolves an explicit standard-channel actor mapping", async () => {
    const resolver = createWorkspaceProjectionResolver(projection);
    await expect(Effect.runPromise(resolver.resolve(command))).resolves.toMatchObject({
      workspaceId: "workspace-synthetic",
      conversation: { kind: "standard_team_channel", channelId: "channel-synthetic" },
      replyTarget: { kind: "channel_thread", rootActivityId: "root-synthetic" },
      authenticatedActorId: expect.stringMatching(/^entra:sha256-/),
      callerId: "actor-synthetic",
      channelSensitivity: "internal",
      boundary: { modelEgress: "redact" },
      authorization: {
        effectiveAudience: {
          kind: "team",
          membership: { member: true, source: "explicit_actor_mapping" },
        },
        permittedSourceScopes: ["legacy_workspace"],
      },
    });
  });

  it("parses v2 membership admission without a copied actor list", () => {
    expect(
      workspaceProjectionFromEnvironment({
        SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON: JSON.stringify(membershipProjection),
      }),
    ).toEqual(membershipProjection);
  });

  it("resolves a current member with the configured audience and corpus grants", async () => {
    const membershipCalls: unknown[] = [];
    const resolver = createWorkspaceProjectionResolver(membershipProjection, {
      resolveMembership: (request) => {
        membershipCalls.push(request);
        return Effect.succeed({
          member: true,
          source: "microsoft_graph_roster",
          resolvedAt: "2026-08-01T08:00:00.000Z",
          expiresAt: "2026-08-01T08:02:00.000Z",
        });
      },
    });

    const resolved = await Effect.runPromise(resolver.resolve(command));

    expect(resolved).toMatchObject({
      workspaceId: "workspace-synthetic",
      callerId: "team-member-synthetic",
      authenticatedActorId: expect.stringMatching(/^entra:sha256-/),
      callerTrustTier: "member",
      authorization: {
        effectiveAudience: {
          id: "audience-synthetic",
          kind: "team",
          membership: { member: true, source: "microsoft_graph_roster" },
        },
        permittedAudienceIds: ["audience-synthetic"],
        permittedSourceScopes: ["jira", "teams"],
      },
    });
    expect(resolved?.authenticatedActorId).not.toContain(command.caller.entraObjectId);
    const differentlyCased = await Effect.runPromise(
      resolver.resolve({
        ...command,
        caller: { ...command.caller, entraObjectId: command.caller.entraObjectId.toUpperCase() },
      }),
    );
    expect(differentlyCased?.authenticatedActorId).toBe(resolved?.authenticatedActorId);
    expect(membershipCalls).toEqual([
      {
        conversation: { ...command.conversation, kind: "standard_team_channel" },
        entraObjectId: "entra-synthetic",
      },
      {
        conversation: { ...command.conversation, kind: "standard_team_channel" },
        entraObjectId: "ENTRA-SYNTHETIC",
      },
    ]);
  });

  it("resolves an explicitly admitted current meeting-chat participant", async () => {
    const membershipCalls: unknown[] = [];
    const resolver = createWorkspaceProjectionResolver(chatProjection, {
      resolveMembership: (request) => {
        membershipCalls.push(request);
        return Effect.succeed({
          member: true,
          source: "microsoft_graph_roster",
          resolvedAt: "2026-08-01T08:00:00.000Z",
          expiresAt: "2026-08-01T08:02:00.000Z",
        });
      },
    });

    await expect(Effect.runPromise(resolver.resolve(chatCommand))).resolves.toMatchObject({
      workspaceId: "workspace-synthetic",
      conversation: { kind: "meeting_chat", chatId: "chat-synthetic" },
      replyTarget: { kind: "chat", conversationId: "chat-synthetic" },
      callerId: "chat-participant-synthetic",
      callerTrustTier: "trusted",
      channelSensitivity: "confidential",
      boundary: { modelEgress: "allow" },
      authorization: {
        effectiveAudience: {
          id: "chat-audience-synthetic",
          kind: "chat",
          historyAccess: "current_roster",
          membership: { member: true, source: "microsoft_graph_roster" },
        },
        permittedAudienceIds: ["chat-audience-synthetic"],
        permittedSourceScopes: ["jira", "vault", "github", "teams", "strategy"],
      },
    });
    expect(membershipCalls).toEqual([
      {
        conversation: chatCommand.conversation,
        entraObjectId: "entra-synthetic",
      },
    ]);
  });

  it("resolves only a current member of an explicitly admitted private channel", async () => {
    const resolveMembership = vi.fn(() =>
      Effect.succeed({
        member: true,
        source: "microsoft_graph_roster" as const,
        resolvedAt: "2026-08-01T08:00:00.000Z",
        expiresAt: "2026-08-01T08:02:00.000Z",
      }),
    );
    const resolver = createWorkspaceProjectionResolver(privateChannelProjection, {
      resolveMembership,
    });
    const privateCommand = {
      ...command,
      conversation: { ...command.conversation, channelId: "private-channel-synthetic" },
    } as const;

    await expect(Effect.runPromise(resolver.resolve(privateCommand))).resolves.toMatchObject({
      conversation: { kind: "private_team_channel", channelId: "private-channel-synthetic" },
      replyTarget: { kind: "channel_thread", rootActivityId: "root-synthetic" },
      callerId: "private-channel-member-synthetic",
      callerTrustTier: "trusted",
      authorization: {
        effectiveAudience: {
          id: "private-channel-audience-synthetic",
          kind: "channel",
          historyAccess: "current_roster",
          membership: { member: true, source: "microsoft_graph_roster" },
        },
        permittedAudienceIds: ["private-channel-audience-synthetic"],
        permittedSourceScopes: ["jira", "vault", "github", "teams", "strategy"],
      },
    });
    expect(resolveMembership).toHaveBeenCalledWith({
      conversation: {
        ...privateCommand.conversation,
        kind: "private_team_channel",
      },
      entraObjectId: "entra-synthetic",
    });

    resolveMembership.mockReturnValueOnce(
      Effect.succeed({
        member: false,
        source: "microsoft_graph_roster" as const,
        resolvedAt: "2026-08-01T08:00:01.000Z",
        expiresAt: "2026-08-01T08:02:01.000Z",
      }),
    );
    await expect(
      Effect.runPromise(
        resolver.resolve({
          ...privateCommand,
          caller: { ...privateCommand.caller, entraObjectId: "parent-team-only-member" },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("denies an unmapped, mismatched, or cross-chat reply target before membership access", async () => {
    const resolveMembership = vi.fn(() =>
      Effect.succeed({
        member: true,
        source: "microsoft_graph_roster" as const,
        resolvedAt: "2026-08-01T08:00:00.000Z",
        expiresAt: "2026-08-01T08:02:00.000Z",
      }),
    );
    const resolver = createWorkspaceProjectionResolver(chatProjection, { resolveMembership });
    for (const denied of [
      { ...chatCommand, conversation: { ...chatCommand.conversation, chatId: "unmapped" } },
      {
        ...chatCommand,
        conversation: { ...chatCommand.conversation, kind: "group_chat" as const },
      },
      { ...chatCommand, replyTarget: { kind: "chat" as const, conversationId: "different-chat" } },
    ]) {
      await expect(Effect.runPromise(resolver.resolve(denied))).resolves.toBeUndefined();
    }
    expect(resolveMembership).not.toHaveBeenCalled();
  });

  it("denies a mapped meeting chat when the caller is not a current participant", async () => {
    const resolver = createWorkspaceProjectionResolver(chatProjection, {
      resolveMembership: () =>
        Effect.succeed({
          member: false,
          source: "microsoft_graph_roster",
          resolvedAt: "2026-08-01T08:00:00.000Z",
          expiresAt: "2026-08-01T08:02:00.000Z",
        }),
    });

    await expect(Effect.runPromise(resolver.resolve(chatCommand))).resolves.toBeUndefined();
  });

  it("denies a non-member and fails closed when membership resolution is unavailable", async () => {
    const nonMemberResolver = createWorkspaceProjectionResolver(membershipProjection, {
      resolveMembership: () =>
        Effect.succeed({
          member: false,
          source: "microsoft_graph_roster",
          resolvedAt: "2026-08-01T08:00:00.000Z",
          expiresAt: "2026-08-01T08:02:00.000Z",
        }),
    });
    await expect(Effect.runPromise(nonMemberResolver.resolve(command))).resolves.toBeUndefined();

    await expect(
      Effect.runPromise(createWorkspaceProjectionResolver(membershipProjection).resolve(command)),
    ).rejects.toThrow("membership authorization is unavailable");
  });

  it("projects v2 delivery channels and role actors without expanding the admitted scope", () => {
    expect(
      workspaceProjectionDeliveryChannels(
        membershipProjection,
        "workspace-synthetic",
        "team-member-synthetic",
      ),
    ).toEqual([
      {
        graphTeamId: "graph-team-synthetic",
        channelId: "channel-synthetic",
        workspaceId: "workspace-synthetic",
        sensitivity: "internal",
        scope: "standard",
      },
    ]);
    expect(
      workspaceProjectionAuthorizedActorIds(membershipProjection, "workspace-synthetic"),
    ).toEqual(["team-member-synthetic"]);
    expect(workspaceProjectionDeliveryChannels(chatProjection, "workspace-synthetic")).toEqual([]);
    expect(
      workspaceProjectionDeliveryChannels(
        privateChannelProjection,
        "workspace-synthetic",
        "private-channel-member-synthetic",
      ),
    ).toEqual([
      {
        graphTeamId: "graph-team-synthetic",
        channelId: "private-channel-synthetic",
        workspaceId: "workspace-synthetic",
        sensitivity: "confidential",
        scope: "private",
      },
    ]);
    expect(workspaceProjectionAuthorizedActorIds(chatProjection, "workspace-synthetic")).toEqual([
      "chat-participant-synthetic",
    ]);
    expect(
      workspaceProjectionDeliveryChannels(
        membershipProjection,
        "workspace-synthetic",
        "unmapped-role",
      ),
    ).toEqual([]);
  });

  it("rejects v2 mappings with missing audience, corpus, role actor, or unsupported scope", () => {
    if (!("conversations" in membershipProjection))
      throw new Error("Synthetic membership projection is not version 2.");
    const base = membershipProjection.conversations[0];
    if (base === undefined) throw new Error("Synthetic membership projection is missing.");
    for (const invalid of [
      { ...base, audienceId: "" },
      { ...base, permittedAudienceIds: ["different-audience"] },
      { ...base, permittedSourceScopes: [] },
      { ...base, permittedSourceScopes: ["tenant-wide"] },
      { ...base, membership: { ...base.membership, actorId: "" } },
      { ...base, kind: "private_team_channel", membership: { ...base.membership } },
    ]) {
      expect(() =>
        workspaceProjectionFromEnvironment({
          SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON: JSON.stringify({
            version: 2,
            conversations: [invalid],
          }),
        }),
      ).toThrow("invalid conversation mapping");
    }
    const privateChannel =
      "conversations" in privateChannelProjection
        ? privateChannelProjection.conversations[0]
        : undefined;
    if (privateChannel === undefined) throw new Error("Synthetic private channel is missing.");
    for (const invalid of [
      { ...privateChannel, membership: { ...privateChannel.membership, kind: "team_membership" } },
      {
        ...privateChannel,
        membership: { ...privateChannel.membership, historyAccess: "message_time" },
      },
      { ...privateChannel, kind: "shared_team_channel" },
    ]) {
      expect(() =>
        workspaceProjectionFromEnvironment({
          SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON: JSON.stringify({
            version: 2,
            conversations: [invalid],
          }),
        }),
      ).toThrow("invalid conversation mapping");
    }
    const chat = "conversations" in chatProjection ? chatProjection.conversations[0] : undefined;
    if (chat === undefined) throw new Error("Synthetic chat projection is missing.");
    for (const invalid of [
      { ...chat, membership: { ...chat.membership, historyAccess: "message_time" } },
      { ...chat, membership: { ...chat.membership, kind: "team_membership" } },
      { ...chat, kind: "personal_chat" },
      { ...chat, kind: "shared_team_channel" },
    ]) {
      expect(() =>
        workspaceProjectionFromEnvironment({
          SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON: JSON.stringify({
            version: 2,
            conversations: [invalid],
          }),
        }),
      ).toThrow("invalid conversation mapping");
    }
  });

  it("projects an explicit approved model-egress decision without lowering sensitivity", async () => {
    const firstChannel = projection.channels[0];
    if (firstChannel === undefined) throw new Error("Synthetic projection is missing its channel.");
    const approvedProjection: WorkspaceProjection = {
      channels: [{ ...firstChannel, modelEgress: "allow" }],
    };

    const resolved = await Effect.runPromise(
      createWorkspaceProjectionResolver(approvedProjection).resolve(command),
    );

    expect(resolved).toMatchObject({
      channelSensitivity: "internal",
      boundary: { sensitivity: "internal", modelEgress: "allow" },
    });
  });

  it("rejects an unknown projected model-egress policy", () => {
    expect(() =>
      workspaceProjectionFromEnvironment({
        SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON: JSON.stringify({
          channels: [{ ...projection.channels[0], modelEgress: "unreviewed-bypass" }],
        }),
      }),
    ).toThrow(RepositoryError);
  });

  it("fails closed for unmapped callers and channels", async () => {
    const resolver = createWorkspaceProjectionResolver(projection);
    await expect(
      Effect.runPromise(
        resolver.resolve({
          ...command,
          caller: { ...command.caller, entraObjectId: "unknown" },
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(
        resolver.resolve({
          ...command,
          conversation: { ...command.conversation, channelId: "unknown" },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    "group_chat",
    "meeting_chat",
    "personal_chat",
  ] as const)("denies unmapped %s conversations", async (kind) => {
    const resolver = createWorkspaceProjectionResolver(projection);
    await expect(
      Effect.runPromise(
        resolver.resolve({
          ...command,
          conversation: { kind, tenantId: "tenant-synthetic", chatId: "chat-synthetic" },
          replyTarget: { kind: "chat", conversationId: "chat-synthetic" },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects ambiguous channel mappings before handling activities", () => {
    const firstChannel = projection.channels[0];
    if (firstChannel === undefined) throw new Error("Synthetic projection is missing its channel.");
    expect(() =>
      createWorkspaceProjectionResolver({
        channels: [...projection.channels, firstChannel],
      }),
    ).toThrow(RepositoryError);
  });

  it("rejects ambiguous chat mappings before handling activities", () => {
    if (!("conversations" in chatProjection))
      throw new Error("Synthetic chat projection is not version 2.");
    const firstChat = chatProjection.conversations[0];
    if (firstChat === undefined) throw new Error("Synthetic projection is missing its chat.");
    expect(() =>
      createWorkspaceProjectionResolver({
        version: 2,
        conversations: [...chatProjection.conversations, firstChat],
      }),
    ).toThrow(RepositoryError);
  });
});

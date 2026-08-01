import { Effect } from "effect";
import {
  type CollaborationSourceScope,
  isCollaborationSourceScope,
} from "../../domain/collaboration-source-scope.ts";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import {
  defaultBoundaryForSensitivity,
  type ModelEgressPolicy,
  type SensitivityTier,
  type TrustTier,
} from "../../domain/policy.ts";
import type {
  ResolvedTeamsMention,
  TeamsChannelConversation,
  TeamsChatConversation,
  TeamsConversation,
  TeamsMembershipResolver,
  TeamsMentionCommand,
  TeamsMentionResolver,
} from "../../modules/teams-mention/index.ts";

type ConversationIdentity = {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly sensitivity: SensitivityTier;
  readonly modelEgress?: ModelEgressPolicy | undefined;
};

type ChannelIdentity = ConversationIdentity & {
  readonly teamId: string;
  readonly graphTeamId: string;
  readonly channelId: string;
};

type ChatIdentity = ConversationIdentity & {
  readonly chatId: string;
};

type LegacyChannelProjection = ChannelIdentity & {
  readonly scope: "standard";
  readonly actors: readonly {
    readonly entraObjectId: string;
    readonly actorId: string;
    readonly trustTier: TrustTier;
  }[];
};

type MembershipGrant = {
  readonly audienceId: string;
  readonly permittedAudienceIds: readonly string[];
  readonly permittedSourceScopes: readonly CollaborationSourceScope[];
};

type MembershipChannelProjection = ChannelIdentity &
  MembershipGrant & {
    readonly kind: "standard_team_channel";
    readonly membership: {
      readonly kind: "team_membership";
      readonly actorId: string;
      readonly trustTier: TrustTier;
    };
  };

type MembershipChatProjection = ChatIdentity &
  MembershipGrant & {
    readonly kind: "group_chat" | "meeting_chat";
    readonly membership: {
      readonly kind: "chat_membership";
      readonly historyAccess: "current_roster";
      readonly actorId: string;
      readonly trustTier: TrustTier;
    };
  };

type MembershipProjection = MembershipChannelProjection | MembershipChatProjection;

export type WorkspaceProjection =
  | {
      readonly version?: "legacy" | undefined;
      readonly channels: readonly LegacyChannelProjection[];
    }
  | { readonly version: 2; readonly conversations: readonly MembershipProjection[] };

const sensitivities = new Set<SensitivityTier>([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
const trustTiers = new Set<TrustTier>(["guest", "member", "trusted", "maintainer", "admin"]);
const modelEgressPolicies = new Set<ModelEgressPolicy>([
  "allow",
  "redact",
  "approval-required",
  "block",
]);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const stringList = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) return undefined;
  const items = value as string[];
  return new Set(items).size === items.length ? items : undefined;
};

const sourceScopeList = (value: unknown): readonly CollaborationSourceScope[] | undefined => {
  const items = stringList(value);
  return items?.every(isCollaborationSourceScope) ? items : undefined;
};

const conversationIdentity = (candidate: Record<string, unknown>): ConversationIdentity => {
  if (
    !nonEmptyString(candidate.tenantId) ||
    !nonEmptyString(candidate.workspaceId) ||
    !sensitivities.has(candidate.sensitivity as SensitivityTier) ||
    (candidate.modelEgress !== undefined &&
      !modelEgressPolicies.has(candidate.modelEgress as ModelEgressPolicy))
  ) {
    throw new RepositoryError({ message: "Teams workspace projection has an invalid identity." });
  }
  return {
    tenantId: candidate.tenantId,
    workspaceId: candidate.workspaceId,
    sensitivity: candidate.sensitivity as SensitivityTier,
    ...(candidate.modelEgress === undefined
      ? {}
      : { modelEgress: candidate.modelEgress as ModelEgressPolicy }),
  };
};

const channelIdentity = (candidate: Record<string, unknown>): ChannelIdentity => {
  if (
    !nonEmptyString(candidate.teamId) ||
    !nonEmptyString(candidate.graphTeamId) ||
    !nonEmptyString(candidate.channelId)
  ) {
    throw new RepositoryError({ message: "Teams workspace projection has an invalid identity." });
  }
  return {
    ...conversationIdentity(candidate),
    teamId: candidate.teamId,
    graphTeamId: candidate.graphTeamId,
    channelId: candidate.channelId,
  };
};

const chatIdentity = (candidate: Record<string, unknown>): ChatIdentity => {
  if (!nonEmptyString(candidate.chatId)) {
    throw new RepositoryError({ message: "Teams workspace projection has an invalid identity." });
  }
  return { ...conversationIdentity(candidate), chatId: candidate.chatId };
};

const parseLegacyProjection = (parsed: Record<string, unknown>): WorkspaceProjection => {
  if (!Array.isArray(parsed.channels)) {
    throw new RepositoryError({ message: "Teams workspace projection must contain channels." });
  }
  const channels = parsed.channels.map((candidate) => {
    const channel = candidate as Record<string, unknown>;
    if (channel.scope !== "standard" || !Array.isArray(channel.actors)) {
      throw new RepositoryError({
        message: "Teams workspace projection has an invalid channel mapping.",
      });
    }
    const actors = channel.actors.map((actorCandidate) => {
      const actor = actorCandidate as Record<string, unknown>;
      if (
        !nonEmptyString(actor.entraObjectId) ||
        !nonEmptyString(actor.actorId) ||
        !trustTiers.has(actor.trustTier as TrustTier)
      ) {
        throw new RepositoryError({
          message: "Teams workspace projection has an invalid actor mapping.",
        });
      }
      return {
        entraObjectId: actor.entraObjectId,
        actorId: actor.actorId,
        trustTier: actor.trustTier as TrustTier,
      };
    });
    return { ...channelIdentity(channel), scope: "standard" as const, actors };
  });
  return { version: "legacy", channels };
};

const parseMembershipProjection = (parsed: Record<string, unknown>): WorkspaceProjection => {
  if (!Array.isArray(parsed.conversations)) {
    throw new RepositoryError({
      message: "Teams workspace projection v2 must contain conversations.",
    });
  }
  const conversations = parsed.conversations.map((candidate) => {
    const conversation = candidate as Record<string, unknown>;
    const membership = conversation.membership as Record<string, unknown> | undefined;
    const permittedAudienceIds = stringList(conversation.permittedAudienceIds);
    const permittedSourceScopes = sourceScopeList(conversation.permittedSourceScopes);
    if (
      membership === undefined ||
      !nonEmptyString(conversation.audienceId) ||
      !nonEmptyString(membership.actorId) ||
      !trustTiers.has(membership.trustTier as TrustTier) ||
      permittedAudienceIds === undefined ||
      !permittedAudienceIds.includes(conversation.audienceId) ||
      permittedSourceScopes === undefined
    ) {
      throw new RepositoryError({
        message: "Teams workspace projection v2 has an invalid conversation mapping.",
      });
    }
    const grant = {
      audienceId: conversation.audienceId,
      permittedAudienceIds,
      permittedSourceScopes,
    };
    if (conversation.kind === "standard_team_channel" && membership.kind === "team_membership") {
      return {
        ...channelIdentity(conversation),
        ...grant,
        kind: "standard_team_channel" as const,
        membership: {
          kind: "team_membership" as const,
          actorId: membership.actorId,
          trustTier: membership.trustTier as TrustTier,
        },
      };
    }
    if (
      (conversation.kind === "group_chat" || conversation.kind === "meeting_chat") &&
      membership.kind === "chat_membership" &&
      membership.historyAccess === "current_roster"
    ) {
      return {
        ...chatIdentity(conversation),
        ...grant,
        kind: conversation.kind as "group_chat" | "meeting_chat",
        membership: {
          kind: "chat_membership" as const,
          historyAccess: "current_roster" as const,
          actorId: membership.actorId,
          trustTier: membership.trustTier as TrustTier,
        },
      };
    }
    throw new RepositoryError({
      message: "Teams workspace projection v2 has an invalid conversation mapping.",
    });
  });
  return { version: 2, conversations };
};

export const workspaceProjectionFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): WorkspaceProjection => {
  const raw = environment.SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON;
  if (raw === undefined || raw.trim() === "") {
    throw new RepositoryError({ message: "SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON is required." });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RepositoryError({ message: "Teams workspace projection must be valid JSON." });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new RepositoryError({ message: "Teams workspace projection must be an object." });
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== undefined && record.version !== "legacy" && record.version !== 2) {
    throw new RepositoryError({ message: "Teams workspace projection version is unsupported." });
  }
  return record.version === 2 ? parseMembershipProjection(record) : parseLegacyProjection(record);
};

const channelKey = (
  conversation: Pick<TeamsChannelConversation, "tenantId" | "teamId" | "channelId">,
): string => `${conversation.tenantId}:${conversation.teamId}:${conversation.channelId}`;

const chatKey = (conversation: Pick<TeamsChatConversation, "tenantId" | "chatId">): string =>
  `${conversation.tenantId}:${conversation.chatId}`;

export const workspaceProjectionDeliveryChannels = (
  projection: WorkspaceProjection,
  workspaceId?: string,
  actorId?: string,
): readonly (Pick<ChannelIdentity, "graphTeamId" | "channelId" | "workspaceId" | "sensitivity"> & {
  readonly scope: "standard";
})[] => {
  const mappings = "channels" in projection ? projection.channels : projection.conversations;
  return mappings.flatMap((channel) => {
    if (!("channelId" in channel)) return [];
    if (workspaceId !== undefined && channel.workspaceId !== workspaceId) return [];
    if (
      actorId !== undefined &&
      ("actors" in channel
        ? !channel.actors.some((actor) => actor.actorId === actorId)
        : channel.membership.actorId !== actorId)
    )
      return [];
    return [
      {
        graphTeamId: channel.graphTeamId,
        channelId: channel.channelId,
        workspaceId: channel.workspaceId,
        sensitivity: channel.sensitivity,
        scope: "standard" as const,
      },
    ];
  });
};

export const workspaceProjectionAuthorizedActorIds = (
  projection: WorkspaceProjection,
  workspaceId: string,
): readonly string[] => {
  const mappings = "channels" in projection ? projection.channels : projection.conversations;
  return [
    ...new Set(
      mappings.flatMap((channel) => {
        if (channel.workspaceId !== workspaceId) return [];
        return "actors" in channel
          ? channel.actors.map((actor) => actor.actorId)
          : [channel.membership.actorId];
      }),
    ),
  ];
};

const resolvedBoundary = (conversation: ConversationIdentity) => {
  const defaultBoundary = defaultBoundaryForSensitivity(conversation.sensitivity);
  return conversation.modelEgress === undefined
    ? defaultBoundary
    : { ...defaultBoundary, modelEgress: conversation.modelEgress };
};

const authenticatedActorId = (tenantId: string, entraObjectId: string): string =>
  `entra:${stableSha256(`${tenantId.toLowerCase()}:${entraObjectId.toLowerCase()}`)}`;

export const createWorkspaceProjectionResolver = (
  projection: WorkspaceProjection,
  membershipResolver?: TeamsMembershipResolver,
): TeamsMentionResolver => {
  const mappings = "channels" in projection ? projection.channels : projection.conversations;
  const channels = new Map<string, LegacyChannelProjection | MembershipChannelProjection>();
  const chats = new Map<string, MembershipChatProjection>();
  for (const mapping of mappings) {
    if (!("channelId" in mapping)) {
      const key = chatKey(mapping);
      if (chats.has(key)) {
        throw new RepositoryError({ message: "Workspace projection has an ambiguous mapping." });
      }
      chats.set(key, mapping);
      continue;
    }
    const key = channelKey(mapping);
    if (channels.has(key)) {
      throw new RepositoryError({ message: "Workspace projection has an ambiguous mapping." });
    }
    if ("actors" in mapping) {
      const actorIds = new Set<string>();
      for (const actor of mapping.actors) {
        if (actorIds.has(actor.entraObjectId)) {
          throw new RepositoryError({ message: "Workspace projection has an ambiguous actor." });
        }
        actorIds.add(actor.entraObjectId);
      }
    }
    channels.set(key, mapping);
  }

  const resolveMembershipMapping = (
    command: TeamsMentionCommand,
    mapping: MembershipProjection,
    conversation: TeamsConversation,
  ): Effect.Effect<ResolvedTeamsMention | undefined, RepositoryError> =>
    Effect.gen(function* () {
      if (membershipResolver === undefined) {
        return yield* Effect.fail(
          new RepositoryError({
            message: "Teams membership authorization is unavailable.",
            operation: "teams-membership-authorization",
          }),
        );
      }
      const membership = yield* membershipResolver.resolveMembership({
        conversation,
        entraObjectId: command.caller.entraObjectId,
      });
      if (!membership.member) return undefined;
      const isChat = "chatId" in mapping;
      return {
        workspaceId: mapping.workspaceId,
        conversation,
        replyTarget: command.replyTarget,
        authenticatedActorId: authenticatedActorId(
          conversation.tenantId,
          command.caller.entraObjectId,
        ),
        callerId: mapping.membership.actorId,
        callerTrustTier: mapping.membership.trustTier,
        channelSensitivity: mapping.sensitivity,
        boundary: resolvedBoundary(mapping),
        authorization: {
          effectiveAudience: {
            id: mapping.audienceId,
            kind: isChat ? ("chat" as const) : ("team" as const),
            ...(isChat && "historyAccess" in mapping.membership
              ? { historyAccess: mapping.membership.historyAccess }
              : {}),
            membership,
          },
          permittedAudienceIds: mapping.permittedAudienceIds,
          permittedSourceScopes: mapping.permittedSourceScopes,
        },
      };
    });

  return {
    resolve: (command) =>
      Effect.gen(function* () {
        if (command.conversation.kind === "team_channel") {
          if (command.replyTarget.kind !== "channel_thread") return undefined;
          const channel = channels.get(channelKey(command.conversation));
          if (channel === undefined) return undefined;
          const conversation = { ...command.conversation, kind: "standard_team_channel" as const };
          if ("actors" in channel) {
            const actor = channel.actors.find(
              (candidate) => candidate.entraObjectId === command.caller.entraObjectId,
            );
            if (actor === undefined) return undefined;
            const audienceId = `legacy:${stableSha256(channelKey(command.conversation))}`;
            return {
              workspaceId: channel.workspaceId,
              conversation,
              replyTarget: command.replyTarget,
              authenticatedActorId: authenticatedActorId(
                conversation.tenantId,
                command.caller.entraObjectId,
              ),
              callerId: actor.actorId,
              callerTrustTier: actor.trustTier,
              channelSensitivity: channel.sensitivity,
              boundary: resolvedBoundary(channel),
              authorization: {
                effectiveAudience: {
                  id: audienceId,
                  kind: "team" as const,
                  membership: {
                    member: true as const,
                    source: "explicit_actor_mapping" as const,
                    resolvedAt: command.receivedAt,
                  },
                },
                permittedAudienceIds: [audienceId],
                permittedSourceScopes: ["legacy_workspace"],
              },
            };
          }
          return yield* resolveMembershipMapping(command, channel, conversation);
        }
        if (command.conversation.kind === "personal_chat") return undefined;
        if (
          command.replyTarget.kind !== "chat" ||
          command.replyTarget.conversationId !== command.conversation.chatId
        )
          return undefined;
        const chat = chats.get(chatKey(command.conversation));
        if (chat === undefined || chat.kind !== command.conversation.kind) return undefined;
        return yield* resolveMembershipMapping(command, chat, command.conversation);
      }),
  };
};

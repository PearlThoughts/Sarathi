import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import {
  defaultBoundaryForSensitivity,
  type ModelEgressPolicy,
  type SensitivityTier,
  type TrustTier,
} from "../../domain/policy.ts";
import type {
  TeamsChannelConversation,
  TeamsMembershipResolver,
  TeamsMentionResolver,
} from "../../modules/teams-mention/index.ts";

type ChannelIdentity = {
  readonly tenantId: string;
  readonly teamId: string;
  readonly graphTeamId: string;
  readonly channelId: string;
  readonly workspaceId: string;
  readonly sensitivity: SensitivityTier;
  readonly modelEgress?: ModelEgressPolicy | undefined;
};

type LegacyChannelProjection = ChannelIdentity & {
  readonly scope: "standard";
  readonly actors: readonly {
    readonly entraObjectId: string;
    readonly actorId: string;
    readonly trustTier: TrustTier;
  }[];
};

type MembershipChannelProjection = ChannelIdentity & {
  readonly kind: "standard_team_channel";
  readonly audienceId: string;
  readonly membership: {
    readonly kind: "team_membership";
    readonly actorId: string;
    readonly trustTier: TrustTier;
  };
  readonly permittedAudienceIds: readonly string[];
  readonly permittedSourceScopes: readonly string[];
};

export type WorkspaceProjection =
  | {
      readonly version?: "legacy" | undefined;
      readonly channels: readonly LegacyChannelProjection[];
    }
  | { readonly version: 2; readonly conversations: readonly MembershipChannelProjection[] };

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

const channelIdentity = (candidate: Record<string, unknown>): ChannelIdentity => {
  if (
    !nonEmptyString(candidate.tenantId) ||
    !nonEmptyString(candidate.teamId) ||
    !nonEmptyString(candidate.graphTeamId) ||
    !nonEmptyString(candidate.channelId) ||
    !nonEmptyString(candidate.workspaceId) ||
    !sensitivities.has(candidate.sensitivity as SensitivityTier) ||
    (candidate.modelEgress !== undefined &&
      !modelEgressPolicies.has(candidate.modelEgress as ModelEgressPolicy))
  ) {
    throw new RepositoryError({ message: "Teams workspace projection has an invalid identity." });
  }
  return {
    tenantId: candidate.tenantId,
    teamId: candidate.teamId,
    graphTeamId: candidate.graphTeamId,
    channelId: candidate.channelId,
    workspaceId: candidate.workspaceId,
    sensitivity: candidate.sensitivity as SensitivityTier,
    ...(candidate.modelEgress === undefined
      ? {}
      : { modelEgress: candidate.modelEgress as ModelEgressPolicy }),
  };
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
    const permittedSourceScopes = stringList(conversation.permittedSourceScopes);
    if (
      conversation.kind !== "standard_team_channel" ||
      !nonEmptyString(conversation.audienceId) ||
      membership?.kind !== "team_membership" ||
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
    return {
      ...channelIdentity(conversation),
      kind: "standard_team_channel" as const,
      audienceId: conversation.audienceId,
      membership: {
        kind: "team_membership" as const,
        actorId: membership.actorId,
        trustTier: membership.trustTier as TrustTier,
      },
      permittedAudienceIds,
      permittedSourceScopes,
    };
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

export const workspaceProjectionDeliveryChannels = (
  projection: WorkspaceProjection,
  workspaceId?: string,
  actorId?: string,
): readonly (Pick<ChannelIdentity, "graphTeamId" | "channelId" | "workspaceId" | "sensitivity"> & {
  readonly scope: "standard";
})[] => {
  const mappings = "channels" in projection ? projection.channels : projection.conversations;
  return mappings.flatMap((channel) => {
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

const resolvedBoundary = (channel: ChannelIdentity) => {
  const defaultBoundary = defaultBoundaryForSensitivity(channel.sensitivity);
  return channel.modelEgress === undefined
    ? defaultBoundary
    : { ...defaultBoundary, modelEgress: channel.modelEgress };
};

const authenticatedActorId = (tenantId: string, entraObjectId: string): string =>
  `entra:${stableSha256(`${tenantId.toLowerCase()}:${entraObjectId.toLowerCase()}`)}`;

export const createWorkspaceProjectionResolver = (
  projection: WorkspaceProjection,
  membershipResolver?: TeamsMembershipResolver,
): TeamsMentionResolver => {
  const mappings = "channels" in projection ? projection.channels : projection.conversations;
  const channels = new Map<string, (typeof mappings)[number]>();
  for (const channel of mappings) {
    const key = channelKey(channel);
    if (channels.has(key)) {
      throw new RepositoryError({ message: "Workspace projection has an ambiguous mapping." });
    }
    if ("actors" in channel) {
      const actorIds = new Set<string>();
      for (const actor of channel.actors) {
        if (actorIds.has(actor.entraObjectId)) {
          throw new RepositoryError({ message: "Workspace projection has an ambiguous actor." });
        }
        actorIds.add(actor.entraObjectId);
      }
    }
    channels.set(key, channel);
  }

  return {
    resolve: (command) =>
      Effect.gen(function* () {
        if (command.conversation.kind !== "team_channel") return undefined;
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
        return {
          workspaceId: channel.workspaceId,
          conversation,
          replyTarget: command.replyTarget,
          authenticatedActorId: authenticatedActorId(
            conversation.tenantId,
            command.caller.entraObjectId,
          ),
          callerId: channel.membership.actorId,
          callerTrustTier: channel.membership.trustTier,
          channelSensitivity: channel.sensitivity,
          boundary: resolvedBoundary(channel),
          authorization: {
            effectiveAudience: {
              id: channel.audienceId,
              kind: "team" as const,
              membership,
            },
            permittedAudienceIds: channel.permittedAudienceIds,
            permittedSourceScopes: channel.permittedSourceScopes,
          },
        };
      }),
  };
};

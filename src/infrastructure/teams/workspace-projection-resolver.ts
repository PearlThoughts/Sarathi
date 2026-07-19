import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import {
  defaultBoundaryForSensitivity,
  type ModelEgressPolicy,
  type SensitivityTier,
  type TrustTier,
} from "../../domain/policy.ts";
import type {
  TeamsMentionCommand,
  TeamsMentionResolver,
} from "../../modules/teams-mention/index.ts";

export type WorkspaceProjection = {
  readonly channels: readonly {
    readonly tenantId: string;
    readonly teamId: string;
    readonly graphTeamId: string;
    readonly channelId: string;
    readonly scope: "standard";
    readonly workspaceId: string;
    readonly sensitivity: SensitivityTier;
    readonly modelEgress?: ModelEgressPolicy | undefined;
    readonly actors: readonly {
      readonly entraObjectId: string;
      readonly actorId: string;
      readonly trustTier: TrustTier;
    }[];
  }[];
};

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

export const workspaceProjectionFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): WorkspaceProjection => {
  const raw = environment.SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON;
  if (raw === undefined || raw.trim() === "") {
    throw new RepositoryError({
      message: "SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON is required.",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RepositoryError({
      message: "Teams workspace projection must be valid JSON.",
    });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { channels?: unknown }).channels)
  ) {
    throw new RepositoryError({
      message: "Teams workspace projection must contain channels.",
    });
  }
  const channels = (parsed as { channels: readonly unknown[] }).channels.map((candidate) => {
    const channel = candidate as Record<string, unknown>;
    if (
      !nonEmptyString(channel.tenantId) ||
      !nonEmptyString(channel.teamId) ||
      !nonEmptyString(channel.graphTeamId) ||
      !nonEmptyString(channel.channelId) ||
      !nonEmptyString(channel.workspaceId) ||
      channel.scope !== "standard" ||
      !sensitivities.has(channel.sensitivity as SensitivityTier) ||
      (channel.modelEgress !== undefined &&
        !modelEgressPolicies.has(channel.modelEgress as ModelEgressPolicy)) ||
      !Array.isArray(channel.actors)
    ) {
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
    return {
      tenantId: channel.tenantId,
      teamId: channel.teamId,
      graphTeamId: channel.graphTeamId,
      channelId: channel.channelId,
      scope: "standard" as const,
      workspaceId: channel.workspaceId,
      sensitivity: channel.sensitivity as SensitivityTier,
      ...(channel.modelEgress === undefined
        ? {}
        : { modelEgress: channel.modelEgress as ModelEgressPolicy }),
      actors,
    };
  });
  return { channels };
};

const channelKey = (
  command: Pick<TeamsMentionCommand, "tenantId" | "teamId" | "channelId">,
): string => `${command.tenantId}:${command.teamId}:${command.channelId}`;

export const createWorkspaceProjectionResolver = (
  projection: WorkspaceProjection,
): TeamsMentionResolver => {
  const channels = new Map<string, WorkspaceProjection["channels"][number]>();
  for (const channel of projection.channels) {
    const key = channelKey(channel);
    if (channels.has(key)) {
      throw new RepositoryError({
        message: "Workspace projection has an ambiguous channel mapping.",
      });
    }
    if (channel.scope !== "standard") {
      throw new RepositoryError({
        message: "Workspace projection permits only standard channels.",
      });
    }
    const actorIds = new Set<string>();
    for (const actor of channel.actors) {
      if (actorIds.has(actor.entraObjectId)) {
        throw new RepositoryError({
          message: "Workspace projection has an ambiguous actor mapping.",
        });
      }
      actorIds.add(actor.entraObjectId);
    }
    channels.set(key, channel);
  }

  return {
    resolve: (command) =>
      Effect.sync(() => {
        const channel = channels.get(channelKey(command));
        const actor = channel?.actors.find(
          (candidate) => candidate.entraObjectId === command.caller.entraObjectId,
        );
        if (channel === undefined || actor === undefined) return undefined;
        const defaultBoundary = defaultBoundaryForSensitivity(channel.sensitivity);
        return {
          workspaceId: channel.workspaceId,
          callerId: actor.actorId,
          callerTrustTier: actor.trustTier,
          channelSensitivity: channel.sensitivity,
          boundary:
            channel.modelEgress === undefined
              ? defaultBoundary
              : { ...defaultBoundary, modelEgress: channel.modelEgress },
        };
      }),
  };
};

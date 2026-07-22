import { RepositoryError } from "../../domain/errors.ts";
import type { SensitivityTier } from "../../domain/policy.ts";

export type TeamsDeliveryChannelScope = "standard" | "shared" | "private";

export type TeamsDeliveryChannelProjection = {
  readonly graphTeamId: string;
  readonly channelId: string;
  readonly workspaceId: string;
  readonly scope: TeamsDeliveryChannelScope;
  readonly sensitivity: SensitivityTier;
};

const scopes = new Set<TeamsDeliveryChannelScope>(["standard", "shared", "private"]);
const sensitivities = new Set<SensitivityTier>([
  "public",
  "internal",
  "confidential",
  "restricted",
]);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const validateChannel = (candidate: unknown): TeamsDeliveryChannelProjection => {
  const channel = candidate as Record<string, unknown>;
  if (
    !nonEmptyString(channel.graphTeamId) ||
    !nonEmptyString(channel.channelId) ||
    !nonEmptyString(channel.workspaceId) ||
    !scopes.has(channel.scope as TeamsDeliveryChannelScope) ||
    !sensitivities.has(channel.sensitivity as SensitivityTier)
  )
    throw new RepositoryError({
      message: "Teams delivery channel projection has an invalid channel mapping.",
    });
  return {
    graphTeamId: channel.graphTeamId,
    channelId: channel.channelId,
    workspaceId: channel.workspaceId,
    scope: channel.scope as TeamsDeliveryChannelScope,
    sensitivity: channel.sensitivity as SensitivityTier,
  };
};

export const deliveryChannelProjectionFromEnvironment = (
  environment: Record<string, string | undefined>,
  fallback: readonly TeamsDeliveryChannelProjection[],
): readonly TeamsDeliveryChannelProjection[] => {
  const raw = environment.SARATHI_TEAMS_DELIVERY_CHANNELS_JSON;
  if (raw === undefined || raw.trim() === "") return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RepositoryError({
      message: "Teams delivery channel projection must be valid JSON.",
    });
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 32)
    throw new RepositoryError({
      message: "Teams delivery channel projection requires 1 to 32 channels.",
    });
  const channels = parsed.map(validateChannel);
  const keys = new Set<string>();
  for (const channel of channels) {
    const key = `${channel.graphTeamId}\u0000${channel.channelId}`;
    if (keys.has(key))
      throw new RepositoryError({
        message: "Teams delivery channel projection has an ambiguous channel mapping.",
      });
    keys.add(key);
  }
  return channels;
};

import { RepositoryError } from "../../domain/errors.ts";
import type { SensitivityTier } from "../../domain/policy.ts";

export type TeamsDeliveryChannelScope = "standard" | "shared" | "private";

export type TeamsDeliveryChannelProjection = {
  readonly graphTeamId: string;
  readonly channelId: string;
  readonly workspaceId: string;
  readonly scope: TeamsDeliveryChannelScope;
  readonly sensitivity: SensitivityTier;
  readonly label?: string | undefined;
  readonly topics?: readonly string[] | undefined;
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

const optionalLabel = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (!nonEmptyString(value) || value.trim().length > 120)
    throw new RepositoryError({
      message: "Teams delivery channel projection has an invalid channel label.",
    });
  return value.trim();
};

const optionalTopics = (value: unknown): readonly string[] | undefined => {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 24 ||
    !value.every((topic) => nonEmptyString(topic) && topic.trim().length <= 120)
  )
    throw new RepositoryError({
      message: "Teams delivery channel projection has invalid routing topics.",
    });
  const topics = value.map((topic) => topic.trim());
  if (new Set(topics.map((topic) => topic.toLowerCase())).size !== topics.length)
    throw new RepositoryError({
      message: "Teams delivery channel projection has duplicate routing topics.",
    });
  return topics;
};

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
  const label = optionalLabel(channel.label);
  const topics = optionalTopics(channel.topics);
  return {
    graphTeamId: channel.graphTeamId,
    channelId: channel.channelId,
    workspaceId: channel.workspaceId,
    scope: channel.scope as TeamsDeliveryChannelScope,
    sensitivity: channel.sensitivity as SensitivityTier,
    ...(label === undefined ? {} : { label }),
    ...(topics === undefined ? {} : { topics }),
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

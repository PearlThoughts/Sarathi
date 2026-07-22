import { describe, expect, it } from "vitest";
import { RepositoryError } from "../src/domain/errors.ts";
import {
  deliveryChannelProjectionFromEnvironment,
  type TeamsDeliveryChannelProjection,
} from "../src/infrastructure/teams/index.ts";

const fallback: readonly TeamsDeliveryChannelProjection[] = [
  {
    graphTeamId: "graph-team-fallback",
    channelId: "channel-fallback",
    workspaceId: "workspace-example",
    scope: "standard",
    sensitivity: "internal",
  },
];

describe("Teams delivery channel projection", () => {
  it("preserves ingress mappings when no separate delivery allowlist is configured", () => {
    expect(deliveryChannelProjectionFromEnvironment({}, fallback)).toEqual(fallback);
  });

  it("accepts an explicit bounded mix of standard, shared, and private channels", () => {
    const channels = deliveryChannelProjectionFromEnvironment(
      {
        SARATHI_TEAMS_DELIVERY_CHANNELS_JSON: JSON.stringify([
          {
            ...fallback[0],
            label: "General delivery",
            topics: ["activity", "status"],
          },
          { ...fallback[0], channelId: "channel-shared", scope: "shared" },
          {
            ...fallback[0],
            channelId: "channel-private",
            scope: "private",
            sensitivity: "confidential",
          },
        ]),
      },
      [],
    );

    expect(channels.map(({ scope }) => scope)).toEqual(["standard", "shared", "private"]);
    expect(channels[0]).toMatchObject({
      label: "General delivery",
      topics: ["activity", "status"],
    });
  });

  it("rejects duplicate, malformed, empty, and oversized delivery allowlists", () => {
    const parse = (channels: readonly unknown[]) =>
      deliveryChannelProjectionFromEnvironment(
        { SARATHI_TEAMS_DELIVERY_CHANNELS_JSON: JSON.stringify(channels) },
        fallback,
      );

    expect(() => parse([fallback[0], fallback[0]])).toThrow(RepositoryError);
    expect(() => parse([{ ...fallback[0], scope: "tenant-wide" }])).toThrow(RepositoryError);
    expect(() => parse([{ ...fallback[0], label: " " }])).toThrow(RepositoryError);
    expect(() => parse([{ ...fallback[0], topics: ["status", "STATUS"] }])).toThrow(
      RepositoryError,
    );
    expect(() => parse([])).toThrow(RepositoryError);
    expect(() =>
      parse(
        Array.from({ length: 33 }, (_, index) => ({
          ...fallback[0],
          channelId: `channel-${index}`,
        })),
      ),
    ).toThrow(RepositoryError);
  });
});

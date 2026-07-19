import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { RepositoryError } from "../src/domain/errors.ts";
import {
  createWorkspaceProjectionResolver,
  type WorkspaceProjection,
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
  tenantId: "tenant-synthetic",
  teamId: "team-synthetic",
  graphTeamId: "graph-team-synthetic",
  channelId: "channel-synthetic",
  conversationId: "conversation-synthetic",
  rootActivityId: "root-synthetic",
  serviceUrl: "https://service.example.test",
  caller: { entraObjectId: "entra-synthetic", displayName: "Synthetic Member" },
  question: "What is the current goal?",
  receivedAt: "2026-07-11T10:00:00.000Z",
} as const;

describe("workspace projection resolver", () => {
  it("requires a private JSON projection rather than falling back to an open scope", () => {
    expect(() => workspaceProjectionFromEnvironment({})).toThrow(RepositoryError);
    expect(() =>
      workspaceProjectionFromEnvironment({
        SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON: "{}",
      }),
    ).toThrow(RepositoryError);
  });

  it("resolves an explicit standard-channel actor mapping", async () => {
    const resolver = createWorkspaceProjectionResolver(projection);
    await expect(Effect.runPromise(resolver.resolve(command))).resolves.toMatchObject({
      workspaceId: "workspace-synthetic",
      callerId: "actor-synthetic",
      channelSensitivity: "internal",
      boundary: { modelEgress: "redact" },
    });
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
      Effect.runPromise(resolver.resolve({ ...command, channelId: "unknown" })),
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
});

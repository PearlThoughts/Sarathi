import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  hostedTeamsIngressCompositionFromEnvironment,
  teamsIngressConfigurationFromEnvironment,
} from "../src/teams-ingress/node-server.ts";

describe("Teams ingress configuration", () => {
  it("fails closed when bot credentials are incomplete", () => {
    expect(() => teamsIngressConfigurationFromEnvironment({ MICROSOFT_APP_ID: "app" })).toThrow(
      "MICROSOFT_APP_PASSWORD is required",
    );
  });

  it("accepts a complete bot configuration without exposing it", () => {
    expect(
      teamsIngressConfigurationFromEnvironment({
        MICROSOFT_APP_ID: "app",
        MICROSOFT_APP_PASSWORD: "secret",
        MICROSOFT_APP_TENANT_ID: "tenant",
      }),
    ).toEqual({ appId: "app", appPassword: "secret", tenantId: "tenant" });
  });

  it("uses the approved standard-channel projection and remains unready until context and answers are composed", async () => {
    const composition = hostedTeamsIngressCompositionFromEnvironment({
      SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON: JSON.stringify({
        channels: [
          {
            tenantId: "tenant",
            teamId: "team",
            channelId: "channel",
            scope: "standard",
            workspaceId: "workspace",
            sensitivity: "public",
            actors: [{ entraObjectId: "entra", actorId: "actor", trustTier: "guest" }],
          },
        ],
      }),
    });

    expect(composition.ready).toBe(false);
    await expect(
      Effect.runPromise(
        composition.dependencies.resolver.resolve({
          activityId: "activity",
          tenantId: "tenant",
          teamId: "team",
          channelId: "channel",
          conversationId: "conversation",
          rootActivityId: "root",
          serviceUrl: "https://service.example.test",
          caller: { entraObjectId: "entra", displayName: "Caller" },
          question: "What changed?",
          receivedAt: "2026-07-11T00:00:00.000Z",
        }),
      ),
    ).resolves.toMatchObject({ workspaceId: "workspace", callerId: "actor" });
  });

  it("fails closed when the private workspace projection is absent", async () => {
    const composition = hostedTeamsIngressCompositionFromEnvironment({});

    await expect(
      Effect.runPromise(
        composition.dependencies.resolver.resolve({
          activityId: "activity",
          tenantId: "tenant",
          teamId: "team",
          channelId: "channel",
          conversationId: "conversation",
          rootActivityId: "root",
          serviceUrl: "https://service.example.test",
          caller: { entraObjectId: "entra", displayName: "Caller" },
          question: "What changed?",
          receivedAt: "2026-07-11T00:00:00.000Z",
        }),
      ),
    ).rejects.toThrow("Approved Teams workspace configuration is unavailable");
  });
});

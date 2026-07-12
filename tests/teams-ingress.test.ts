import { CloudAdapter } from "@microsoft/agents-hosting";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createTeamsIngressApplication,
  hostedFinanceReminderCompositionFromEnvironment,
  hostedTeamsIngressCompositionFromEnvironment,
  sameThreadReplyActivity,
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

  it("fails closed when a workspace projection is present but hosted dependencies are incomplete", async () => {
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
    ).rejects.toThrow("Approved Teams workspace configuration is unavailable");
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

  it("uses the configured CloudAdapter instead of creating an unconfigured production adapter", () => {
    const adapter = new CloudAdapter({
      clientId: "app",
      clientSecret: "password",
      tenantId: "tenant",
    });

    expect(() => createTeamsIngressApplication(undefined, adapter)).not.toThrow();
  });

  it("builds an explicit same-thread reply without including private activity content", () => {
    expect(sameThreadReplyActivity("root-activity", "Hello from Sarathi.")).toMatchObject({
      type: "message",
      replyToId: "root-activity",
      text: "Hello from Sarathi.",
    });
  });

  it("fails closed for Finance scheduling until an explicit workspace projection is present", () => {
    const incomplete = hostedFinanceReminderCompositionFromEnvironment({
      SARATHI_REMINDERS_ENABLED: "true",
    });
    expect(incomplete.enabled).toBe(false);

    const complete = hostedFinanceReminderCompositionFromEnvironment({
      SARATHI_REMINDERS_ENABLED: "true",
      SARATHI_FINANCE_RUNTIME_MODE: "shadow",
      SARATHI_REMINDER_WORKSPACE_ID: "synthetic-workspace",
      SARATHI_REMINDER_TIMEZONE: "UTC",
      SARATHI_WEEKLY_DIGEST_TIME: "09:00",
      SARATHI_EXCEPTION_DIGEST_TIME: "10:00",
      MICROSOFT_APP_ID: "synthetic-app",
      MICROSOFT_APP_PASSWORD: "synthetic-password",
      MICROSOFT_APP_TENANT_ID: "synthetic-tenant",
      SARATHI_STRATEGY_DATABASE_URL: "postgres://example.invalid/synthetic",
      JIRA_BASE_URL: "https://jira.example.invalid",
      JIRA_EMAIL: "synthetic@example.invalid",
      JIRA_API_TOKEN: "synthetic-token",
      SARATHI_COMPLIANCE_JIRA_PROJECT: "TEST",
      SARATHI_COMPLIANCE_JIRA_LABELS: "compliance",
      SARATHI_DEFAULT_CHAT_ID: "synthetic-chat",
    });
    expect(complete.enabled).toBe(false);
    expect(complete.mode).toBe("shadow");
  });

  it("keeps disabled Finance distinguishable from invalid configuration", async () => {
    await expect(
      hostedFinanceReminderCompositionFromEnvironment({}).readiness(),
    ).resolves.toMatchObject({
      mode: "disabled",
      configuration: "disabled",
      scheduler: "not_running",
    });
    await expect(
      hostedFinanceReminderCompositionFromEnvironment({
        SARATHI_FINANCE_RUNTIME_MODE: "live",
      }).readiness(),
    ).resolves.toMatchObject({ configuration: "unavailable" });
  });
});

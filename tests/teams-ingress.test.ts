import { Activity } from "@microsoft/agents-activity";
import { CloudAdapter } from "@microsoft/agents-hosting";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createPrivacySafeTeamsIngressDiagnosticSink,
  createTeamsIngressApplication,
  directTeamsMentionQuestion,
  financeReminderKindFromBody,
  hostedFinanceReminderCompositionFromEnvironment,
  hostedTeamsIngressCompositionFromEnvironment,
  sameThreadReplyActivity,
  stringListFromEnvironment,
  teamsIngressAuthConfiguration,
  teamsIngressConfigurationFromEnvironment,
  teamsMentionCommandFromActivity,
} from "../src/teams-ingress/node-server.ts";

describe("Teams ingress configuration", () => {
  it("parses private-overlay string lists from JSON or CSV without retaining syntax", () => {
    expect(stringListFromEnvironment("LABELS", '["finance-compliance", "statutory"]')).toEqual([
      "finance-compliance",
      "statutory",
    ]);
    expect(stringListFromEnvironment("LABELS", "finance-compliance, statutory")).toEqual([
      "finance-compliance",
      "statutory",
    ]);
  });

  it("rejects malformed structured list configuration", () => {
    expect(() => stringListFromEnvironment("LABELS", '["finance-compliance", 1]')).toThrow(
      "LABELS must be a string array",
    );
  });

  it("rejects missing or unknown Finance operation kinds", () => {
    expect(financeReminderKindFromBody({ kind: "planning" })).toBe("planning");
    expect(financeReminderKindFromBody({ kind: "exceptions" })).toBe("exceptions");
    expect(financeReminderKindFromBody({ kind: "other" })).toBeUndefined();
    expect(financeReminderKindFromBody({})).toBeUndefined();
  });

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

  it("materializes the SDK connection map required for JWT audience validation", () => {
    const auth = teamsIngressAuthConfiguration({
      appId: "app",
      appPassword: "secret",
      tenantId: "tenant",
    });

    expect(auth.connectionsMap).toEqual([{ serviceUrl: "*", connection: "serviceConnection" }]);
    expect(auth.connections?.get("serviceConnection")).toMatchObject({
      clientId: "app",
      clientSecret: "secret",
      tenantId: "tenant",
    });
  });

  it("fails closed when a workspace projection is present but hosted dependencies are incomplete", async () => {
    const composition = hostedTeamsIngressCompositionFromEnvironment({
      SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON: JSON.stringify({
        channels: [
          {
            tenantId: "tenant",
            teamId: "team",
            graphTeamId: "graph-team",
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
          graphTeamId: "graph-team",
          channelId: "channel",
          conversationId: "conversation",
          rootActivityId: "root",
          serviceUrl: "https://service.example.test",
          caller: { entraObjectId: "entra", displayName: "Caller" },
          question: "What changed?",
          receivedAt: "2026-07-11T00:00:00.000Z",
        }),
      ),
    ).rejects.toThrow("Connected Teams workspace configuration is unavailable");
  });

  it("fails closed when the private workspace projection is absent", async () => {
    const composition = hostedTeamsIngressCompositionFromEnvironment({});

    await expect(
      Effect.runPromise(
        composition.dependencies.resolver.resolve({
          activityId: "activity",
          tenantId: "tenant",
          teamId: "team",
          graphTeamId: "graph-team",
          channelId: "channel",
          conversationId: "conversation",
          rootActivityId: "root",
          serviceUrl: "https://service.example.test",
          caller: { entraObjectId: "entra", displayName: "Caller" },
          question: "What changed?",
          receivedAt: "2026-07-11T00:00:00.000Z",
        }),
      ),
    ).rejects.toThrow("Connected Teams workspace configuration is unavailable");
  });

  it("composes hello from only the approved projection and persistent audit configuration", async () => {
    const composition = hostedTeamsIngressCompositionFromEnvironment({
      SARATHI_TEAMS_HELLO_DIAGNOSTIC_ENABLED: "true",
      SARATHI_STRATEGY_DATABASE_URL: "postgres://example.invalid/synthetic",
      SARATHI_TEAMS_WORKSPACE_PROJECTION_JSON: JSON.stringify({
        channels: [
          {
            tenantId: "tenant",
            teamId: "team",
            graphTeamId: "graph-team",
            channelId: "channel",
            scope: "standard",
            workspaceId: "workspace",
            sensitivity: "internal",
            actors: [{ entraObjectId: "entra", actorId: "actor", trustTier: "member" }],
          },
        ],
      }),
    });

    expect(composition.ready).toBe(true);
    expect(composition.dependencies.helloDiagnosticEnabled).toBe(true);
    await expect(
      Effect.runPromise(
        composition.dependencies.resolver.resolve({
          activityId: "activity",
          tenantId: "tenant",
          teamId: "team",
          graphTeamId: "graph-team",
          channelId: "channel",
          conversationId: "conversation",
          rootActivityId: "root",
          serviceUrl: "https://service.example.test",
          caller: { entraObjectId: "entra", displayName: "Caller" },
          question: "hello",
          receivedAt: "2026-07-11T00:00:00.000Z",
        }),
      ),
    ).resolves.toMatchObject({ workspaceId: "workspace", callerId: "actor" });
  });

  it("uses the configured CloudAdapter instead of creating an unconfigured production adapter", () => {
    const adapter = new CloudAdapter({
      clientId: "app",
      clientSecret: "password",
      tenantId: "tenant",
    });

    expect(() => createTeamsIngressApplication(undefined, adapter)).not.toThrow();
  });

  it("normalizes the recipient mention using the visible Teams mention entity", () => {
    const activity = Activity.fromObject({
      type: "message",
      text: "<at>Sarathi</at> hello",
      recipient: { id: "28:sarathi-bot", name: "Sarathi" },
      entities: [
        {
          type: "mention",
          text: "<at>Sarathi</at>",
          mentioned: { id: "28:SARATHI-BOT", name: "Sarathi" },
        },
      ],
    });

    expect(directTeamsMentionQuestion(activity)).toBe("hello");
  });

  it("uses the Teams Entra group ID for Microsoft Graph reads", () => {
    const command = teamsMentionCommandFromActivity(
      Activity.fromObject({
        type: "message",
        id: "activity",
        replyToId: "root",
        timestamp: "2026-07-19T00:00:00.000Z",
        serviceUrl: "https://service.example.test",
        conversation: { id: "conversation" },
        from: { aadObjectId: "caller", name: "Caller" },
        channelData: {
          tenant: { id: "tenant" },
          team: { id: "19:bot-framework-team@thread.skype", aadGroupId: "graph-team-guid" },
          channel: { id: "19:channel@thread.tacv2" },
        },
      }),
      "What changed?",
    );

    expect(command).toMatchObject({
      teamId: "19:bot-framework-team@thread.skype",
      graphTeamId: "graph-team-guid",
      channelId: "19:channel@thread.tacv2",
      rootActivityId: "root",
    });
  });

  it("ignores text without a matching recipient mention entity", () => {
    const activity = Activity.fromObject({
      type: "message",
      text: "<at>Someone Else</at> hello",
      recipient: { id: "28:sarathi-bot", name: "Sarathi" },
      entities: [
        {
          type: "mention",
          text: "<at>Someone Else</at>",
          mentioned: { id: "29:someone-else", name: "Someone Else" },
        },
      ],
    });

    expect(directTeamsMentionQuestion(activity)).toBeUndefined();
    expect(
      directTeamsMentionQuestion(
        Activity.fromObject({
          type: "message",
          text: "@Sarathi hello",
          recipient: { id: "28:sarathi-bot", name: "Sarathi" },
        }),
      ),
    ).toBeUndefined();
  });

  it("emits only privacy-safe ingress diagnostics", () => {
    const lines: string[] = [];
    const sink = createPrivacySafeTeamsIngressDiagnosticSink((line) => lines.push(line));

    sink({
      event: "teams_ingress",
      stage: "activity",
      outcome: "ignored",
      activityHash: "already-hashed-activity",
      reason: "missing_matching_mention",
      missingFields: ["callerEntraObjectId"],
    });

    expect(lines).toEqual([
      JSON.stringify({
        event: "teams_ingress",
        stage: "activity",
        outcome: "ignored",
        activityHash: "already-hashed-activity",
        reason: "missing_matching_mention",
        missingFields: ["callerEntraObjectId"],
      }),
    ]);
    expect(lines[0]).not.toContain("Hello from a private thread");
    expect(lines[0]).not.toContain("28:sarathi-bot");
    expect(lines[0]).not.toContain("entra-object-id");
  });

  it("builds an explicit same-thread reply without including private activity content", () => {
    expect(sameThreadReplyActivity("root-activity", "Hello from Sarathi.")).toMatchObject({
      type: "message",
      replyToId: "root-activity",
      text: "Hello from Sarathi.",
    });
  });

  it("renders only resolved action targets as real Teams mention entities", () => {
    expect(
      sameThreadReplyActivity(
        "root-activity",
        "1. **Next:** <at>Delivery Reviewer</at>, please confirm the next step.",
        [
          {
            source: "teams",
            externalId: "reviewer-id",
            displayName: "Delivery Reviewer",
          },
          {
            source: "teams",
            externalId: "not-rendered-id",
            displayName: "Not Rendered",
          },
        ],
      ),
    ).toMatchObject({
      replyToId: "root-activity",
      entities: [
        {
          type: "mention",
          text: "<at>Delivery Reviewer</at>",
          mentioned: { id: "reviewer-id", name: "Delivery Reviewer" },
        },
      ],
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

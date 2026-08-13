import { Activity } from "@microsoft/agents-activity";
import { CloudAdapter } from "@microsoft/agents-hosting";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { AnswerFeedbackService } from "../src/modules/answer-feedback/index.ts";
import {
  createPrivacySafeTeamsIngressDiagnosticSink,
  createTeamsIngressApplication,
  directTeamsMentionQuestion,
  financeReminderKindFromBody,
  handleTeamsAnswerFeedbackAction,
  hostedFinanceReminderCompositionFromEnvironment,
  hostedTeamsIngressCompositionFromEnvironment,
  sameChatReplyActivity,
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
          conversation: {
            kind: "team_channel",
            tenantId: "tenant",
            teamId: "team",
            graphTeamId: "graph-team",
            channelId: "channel",
          },
          replyTarget: {
            kind: "channel_thread",
            conversationId: "conversation",
            rootActivityId: "root",
          },
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
          conversation: {
            kind: "team_channel",
            tenantId: "tenant",
            teamId: "team",
            graphTeamId: "graph-team",
            channelId: "channel",
          },
          replyTarget: {
            kind: "channel_thread",
            conversationId: "conversation",
            rootActivityId: "root",
          },
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
          conversation: {
            kind: "team_channel",
            tenantId: "tenant",
            teamId: "team",
            graphTeamId: "graph-team",
            channelId: "channel",
          },
          replyTarget: {
            kind: "channel_thread",
            conversationId: "conversation",
            rootActivityId: "root",
          },
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
      conversation: {
        kind: "team_channel",
        teamId: "19:bot-framework-team@thread.skype",
        graphTeamId: "graph-team-guid",
        channelId: "19:channel@thread.tacv2",
      },
      replyTarget: { kind: "channel_thread", rootActivityId: "root" },
    });
  });

  it.each([
    "standard",
    "private",
    "shared",
  ] as const)("does not infer %s channel authorization from an SDK channel-type hint", (membershipType) => {
    const command = teamsMentionCommandFromActivity(
      Activity.fromObject({
        type: "message",
        id: "activity",
        serviceUrl: "https://service.example.test",
        conversation: { id: "conversation" },
        from: { aadObjectId: "caller", name: "Caller" },
        channelData: {
          tenant: { id: "tenant" },
          team: { id: "team", aadGroupId: "graph-team" },
          channel: { id: "channel", membershipType },
        },
      }),
      "What changed?",
    );

    expect(command.conversation.kind).toBe("team_channel");
    expect(command.replyTarget.kind).toBe("channel_thread");
  });

  it.each([
    [{ conversationType: "groupChat", isGroup: true }, {}, "group_chat"],
    [
      { conversationType: "groupChat", isGroup: true },
      { meeting: { id: "meeting" } },
      "meeting_chat",
    ],
    [{ conversationType: "personal", isGroup: false }, {}, "personal_chat"],
  ] as const)("normalizes chat activity as %s", (conversation, extraChannelData, expectedKind) => {
    const command = teamsMentionCommandFromActivity(
      Activity.fromObject({
        type: "message",
        id: "activity",
        serviceUrl: "https://service.example.test",
        conversation: { id: "chat", ...conversation },
        from: { aadObjectId: "caller", name: "Caller" },
        channelData: { tenant: { id: "tenant" }, ...extraChannelData },
      }),
      "What changed?",
    );

    expect(command).toMatchObject({
      conversation: { kind: expectedKind, tenantId: "tenant", chatId: "chat" },
      replyTarget: { kind: "chat", conversationId: "chat" },
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
      responseMode: "structured",
      elapsedMs: 8123,
      acceptancePassed: false,
    });

    expect(lines).toEqual([
      JSON.stringify({
        event: "teams_ingress",
        stage: "activity",
        outcome: "ignored",
        activityHash: "already-hashed-activity",
        reason: "missing_matching_mention",
        missingFields: ["callerEntraObjectId"],
        responseMode: "structured",
        elapsedMs: 8123,
        acceptancePassed: false,
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

  it("attaches feedback controls without changing the Markdown answer", () => {
    const activity = sameThreadReplyActivity(
      "root-activity",
      "**Status:** Ready\n\n- Existing high-quality answer",
      [],
      { answerId: "af_11111111-1111-4111-8111-111111111111" },
    );

    expect(activity.text).toBe("**Status:** Ready\n\n- Existing high-quality answer");
    expect(activity.attachments).toHaveLength(1);
    expect(activity.attachments?.[0]?.content).toMatchObject({
      type: "AdaptiveCard",
      body: [{ text: "Was this answer useful?" }],
    });
    expect(JSON.stringify(activity.attachments)).not.toContain(activity.text);
  });

  it("authorizes a feedback action and returns a quiet replacement confirmation card", async () => {
    const diagnostics: unknown[] = [];
    const activity = Activity.fromObject({
      type: "invoke",
      id: "feedback-activity",
      replyToId: "answer-activity",
      serviceUrl: "https://service.example.test",
      conversation: { id: "conversation" },
      from: { aadObjectId: "entra", name: "Caller" },
      channelData: {
        tenant: { id: "tenant" },
        team: { id: "team", aadGroupId: "graph-team" },
        channel: { id: "channel" },
      },
    });
    const answerFeedback = {
      prepareAnswer: () => Effect.die("not used"),
      markAnswerDelivered: () => Effect.die("not used"),
      abandonAnswer: () => Effect.die("not used"),
      metrics: () => Effect.die("not used"),
      submit: (action, actor) => {
        expect(action).toMatchObject({
          rating: "partly_useful",
          reasons: ["missing_material_work", "wrong_delivery_status"],
          correction: "Mention the acceptance gap.",
        });
        expect(actor).toMatchObject({
          workspaceId: "workspace",
          actorId: "actor",
          permitted: true,
        });
        return Effect.succeed({
          idempotent: false,
          answer: {
            id: action.answerId,
            workspaceId: "workspace",
            recipientActorId: "actor",
            conversationBoundaryHash: actor.conversationBoundaryHash,
            sourceActivityHash: "sha256-source",
            answerFingerprint: "sha256-answer",
            queryFingerprint: "sha256-query",
            answerText: "Original answer",
            questionText: "Original question",
            modelName: "model-a",
            reasoningConfiguration: "medium",
            applicationRevision: "revision-a",
            responseProduct: "operational_answer",
            queryFamily: "status",
            generatedAt: "2026-08-13T10:00:00.000Z",
            state: "delivered",
          },
          revision: {
            id: "fr_22222222-2222-4222-8222-222222222222",
            answerId: action.answerId,
            workspaceId: "workspace",
            actorId: "actor",
            revision: 1,
            rating: action.rating,
            reasons: action.reasons,
            correction: action.correction,
            idempotencyKeyHash: "sha256-idempotency",
            submittedAt: "2026-08-13T10:01:00.000Z",
            reviewDisposition: "unreviewed",
          },
        });
      },
    } satisfies AnswerFeedbackService;

    const result = await handleTeamsAnswerFeedbackAction(
      activity,
      {
        data: {
          answerId: "af_11111111-1111-4111-8111-111111111111",
          idempotencyKey: "fi_33333333-3333-4333-8333-333333333333",
          rating: "partly_useful",
          feedbackReasons: "missing_material_work,wrong_delivery_status",
          feedbackCorrection: "Mention the acceptance gap.",
        },
      },
      {
        resolver: {
          resolve: (command) =>
            Effect.succeed({
              workspaceId: "workspace",
              conversation: {
                kind: "standard_team_channel" as const,
                tenantId: "tenant",
                teamId: "team",
                graphTeamId: "graph-team",
                channelId: "channel",
              },
              replyTarget: command.replyTarget,
              authenticatedActorId: "entra:synthetic",
              callerId: "actor",
              callerTrustTier: "trusted",
              channelSensitivity: "internal",
              boundary: {
                sensitivity: "internal",
                minimumTrustTier: "member",
                allowedDelegationStages: ["answer"],
                modelEgress: "allow",
                requiresHumanApproval: false,
                requiresPreRetrievalAuthorization: true,
                requiresToolAuthorization: true,
              },
              authorization: {
                effectiveAudience: {
                  id: "audience",
                  kind: "team",
                  membership: {
                    member: true,
                    source: "explicit_actor_mapping",
                    resolvedAt: "2026-08-13T10:00:00.000Z",
                  },
                },
                permittedAudienceIds: ["audience"],
                permittedSourceScopes: ["legacy_workspace"],
              },
            }),
        },
        authorizer: { authorizeContext: () => Effect.succeed({ allowed: true }) },
        answerFeedback,
      },
      (event) => diagnostics.push(event),
    );

    expect(result.body[0]).toMatchObject({
      text: "Feedback recorded: Partly useful. You can revise it below.",
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({ stage: "feedback", outcome: "recorded" }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("Original answer");
    expect(JSON.stringify(diagnostics)).not.toContain("Mention the acceptance gap");
  });

  it("fails malformed feedback safely without calling the resolver", async () => {
    let resolverCalls = 0;
    const result = await handleTeamsAnswerFeedbackAction(
      Activity.fromObject({ type: "invoke", id: "feedback-activity" }),
      { data: { answerId: "private answer body", arbitraryUrl: "https://private.example" } },
      {
        resolver: {
          resolve: () => {
            resolverCalls += 1;
            return Effect.succeed(undefined);
          },
        },
        authorizer: { authorizeContext: () => Effect.succeed({ allowed: false }) },
      },
    );

    expect(result.body[0]).toMatchObject({ color: "Attention" });
    expect(resolverCalls).toBe(0);
  });

  it("builds a flat chat reply without inventing a channel thread", () => {
    expect(sameChatReplyActivity("Hello from Sarathi.")).toMatchObject({
      type: "message",
      text: "Hello from Sarathi.",
    });
    expect(sameChatReplyActivity("Hello from Sarathi.").replyToId).toBeUndefined();
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

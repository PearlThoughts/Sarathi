import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { RepositoryError } from "../src/domain/errors.ts";
import { AnswerFeedbackError } from "../src/modules/answer-feedback/index.ts";
import {
  handleTeamsMention,
  stripSarathiMention,
  type TeamsMentionDependencies,
} from "../src/modules/teams-mention/index.ts";

const command = {
  activityId: "activity-1",
  conversation: {
    kind: "team_channel",
    tenantId: "tenant-1",
    teamId: "team-1",
    graphTeamId: "graph-team-1",
    channelId: "channel-1",
  },
  replyTarget: {
    kind: "channel_thread",
    conversationId: "conversation-1",
    rootActivityId: "root-1",
  },
  serviceUrl: "https://service.example.test",
  caller: { entraObjectId: "caller-1", displayName: "Delivery Member" },
  question: "What is the goal?",
  receivedAt: "2026-07-11T00:00:00.000Z",
} as const;

type AuditState = "new" | "processing" | "delivered" | "failed-retryable" | "failed-terminal";

const dependencies = (
  input: { readonly deliveryFails?: boolean; readonly helloDiagnosticEnabled?: boolean } = {},
): {
  readonly dependencies: TeamsMentionDependencies;
  readonly state: () => AuditState;
  readonly calls: {
    readonly delivered: () => number;
    readonly failed: () => number;
    readonly states: () => readonly AuditState[];
  };
} => {
  let auditState: AuditState = "new";
  let delivered = 0;
  let failed = 0;
  const states: AuditState[] = [];

  return {
    dependencies: {
      resolver: {
        resolve: () =>
          Effect.succeed({
            workspaceId: "workspace-1",
            conversation: { ...command.conversation, kind: "standard_team_channel" },
            replyTarget: command.replyTarget,
            authenticatedActorId: "entra:synthetic",
            callerId: "actor-1",
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
                id: "audience-1",
                kind: "team",
                membership: {
                  member: true,
                  source: "explicit_actor_mapping",
                  resolvedAt: command.receivedAt,
                },
              },
              permittedAudienceIds: ["audience-1"],
              permittedSourceScopes: ["legacy_workspace"],
            },
          }),
      },
      authorizer: { authorizeContext: () => Effect.succeed({ allowed: true }) },
      contextAssembler: {
        assemble: () =>
          Effect.succeed({ workspaceId: "workspace-1", question: command.question, evidence: [] }),
      },
      answerGenerator: {
        generate: () =>
          Effect.succeed({ text: "Known fact.", citations: [], unavailableSources: [] }),
      },
      delivery: {
        reply: () =>
          input.deliveryFails === true
            ? Effect.fail(new RepositoryError({ message: "Teams delivery failed" }))
            : Effect.sync(() => {
                delivered += 1;
              }),
      },
      audit: {
        acquireLease: () =>
          Effect.sync(() => {
            if (auditState === "delivered") return { kind: "duplicate-delivered" } as const;
            if (auditState === "processing") return { kind: "in-progress" } as const;
            if (auditState === "failed-terminal") return { kind: "terminal" } as const;
            auditState = "processing";
            states.push(auditState);
            return { kind: "acquired", attempt: 1 } as const;
          }),
        renewLease: () => Effect.succeed(auditState === "processing"),
        markDelivered: () =>
          Effect.sync(() => {
            auditState = "delivered";
            states.push(auditState);
          }),
        markFailed: (_activityId, state) =>
          Effect.sync(() => {
            failed += 1;
            auditState = state;
            states.push(auditState);
          }),
      },
      ...(input.helloDiagnosticEnabled === undefined
        ? {}
        : { helloDiagnosticEnabled: input.helloDiagnosticEnabled }),
    },
    state: () => auditState,
    calls: { delivered: () => delivered, failed: () => failed, states: () => states },
  };
};

describe("teams mention", () => {
  it("strips only the Sarathi mention", () => {
    expect(stripSarathiMention("<at>Sarathi</at> What is the goal?", "<at>Sarathi</at>")).toBe(
      "What is the goal?",
    );
    expect(stripSarathiMention("<at>Someone</at> hello", "<at>Sarathi</at>")).toBe(
      "<at>Someone</at> hello",
    );
  });

  it("answers an authorized direct mention once", async () => {
    const fixture = dependencies();
    await expect(
      Effect.runPromise(handleTeamsMention(command, fixture.dependencies)),
    ).resolves.toMatchObject({
      kind: "answered",
      answer: { text: "Known fact." },
    });
    expect(fixture.state()).toBe("delivered");
    expect(fixture.calls.delivered()).toBe(1);
  });

  it("prepares feedback before delivery, attaches its opaque identifier, and marks it delivered", async () => {
    const fixture = dependencies();
    const calls: string[] = [];
    let deliveredInvitation: unknown;
    const feedbackDependencies: TeamsMentionDependencies = {
      ...fixture.dependencies,
      answerFeedback: {
        prepareAnswer: (input) =>
          Effect.sync(() => {
            expect(input).toMatchObject({
              workspaceId: "workspace-1",
              recipientActorId: "actor-1",
              answerText: "Known fact.",
              questionText: "What is the goal?",
              responseProduct: "grounded_answer",
              queryFamily: "general_question",
            });
            expect(input.conversationBoundaryHash).toMatch(/^sha256-[a-f0-9]{64}$/);
            calls.push("prepare");
            return { answerId: "af_11111111-1111-4111-8111-111111111111" };
          }),
        markAnswerDelivered: () => Effect.sync(() => calls.push("mark")),
        abandonAnswer: () => Effect.sync(() => calls.push("abandon")),
        submit: () => Effect.die("not used"),
        metrics: () => Effect.die("not used"),
      },
      feedbackGenerationContext: {
        modelName: "model-a",
        reasoningConfiguration: "medium",
        applicationRevision: "revision-a",
      },
      delivery: {
        reply: (_command, _answer, invitation) =>
          Effect.sync(() => {
            calls.push("deliver");
            deliveredInvitation = invitation;
          }),
      },
    };

    await Effect.runPromise(handleTeamsMention(command, feedbackDependencies));

    expect(deliveredInvitation).toEqual({
      answerId: "af_11111111-1111-4111-8111-111111111111",
    });
    expect(calls).toEqual(["prepare", "deliver", "mark"]);
  });

  it("delivers the original answer when feedback preparation is unavailable", async () => {
    const fixture = dependencies();
    const diagnostics: string[] = [];
    const feedbackDependencies: TeamsMentionDependencies = {
      ...fixture.dependencies,
      answerFeedback: {
        prepareAnswer: () =>
          Effect.fail(new AnswerFeedbackError("persistence_unavailable", "unavailable")),
        markAnswerDelivered: () => Effect.void,
        abandonAnswer: () => Effect.void,
        submit: () => Effect.die("not used"),
        metrics: () => Effect.die("not used"),
      },
      feedbackGenerationContext: {
        modelName: "model-a",
        reasoningConfiguration: "medium",
        applicationRevision: "revision-a",
      },
      feedbackDiagnostic: (stage, reason) => diagnostics.push(`${stage}:${reason}`),
    };

    await expect(
      Effect.runPromise(handleTeamsMention(command, feedbackDependencies)),
    ).resolves.toMatchObject({ kind: "answered", answer: { text: "Known fact." } });
    expect(fixture.calls.delivered()).toBe(1);
    expect(diagnostics).toEqual(["prepare:persistence_unavailable"]);
  });

  it("does not answer a duplicate after successful delivery", async () => {
    const fixture = dependencies();
    await Effect.runPromise(handleTeamsMention(command, fixture.dependencies));
    await expect(
      Effect.runPromise(handleTeamsMention(command, fixture.dependencies)),
    ).resolves.toEqual({
      kind: "ignored",
      reason: "duplicate",
    });
    expect(fixture.calls.delivered()).toBe(1);
    expect(fixture.state()).toBe("delivered");
  });

  it("does not deliver after losing the activity lease during composition", async () => {
    const fixture = dependencies();
    let renewals = 0;
    const lostLeaseDependencies: TeamsMentionDependencies = {
      ...fixture.dependencies,
      audit: {
        ...fixture.dependencies.audit,
        renewLease: () => Effect.succeed(++renewals === 1),
      },
    };

    await expect(
      Effect.runPromise(handleTeamsMention(command, lostLeaseDependencies)),
    ).resolves.toEqual({ kind: "ignored", reason: "duplicate" });
    expect(renewals).toBe(2);
    expect(fixture.calls.delivered()).toBe(0);
    expect(fixture.state()).toBe("processing");
  });

  it.each([
    "group_chat",
    "personal_chat",
  ] as const)("denies unsupported %s before authorization, retrieval, or model composition", async (kind) => {
    const fixture = dependencies();
    let authorizationCalls = 0;
    let contextCalls = 0;
    let modelCalls = 0;
    const unsupportedCommand = {
      ...command,
      conversation: { kind, tenantId: "tenant-1", chatId: "chat-1" },
      replyTarget: { kind: "chat" as const, conversationId: "chat-1" },
    };
    const failClosedDependencies: TeamsMentionDependencies = {
      ...fixture.dependencies,
      resolver: { resolve: () => Effect.succeed(undefined) },
      authorizer: {
        authorizeContext: () => {
          authorizationCalls += 1;
          return Effect.succeed({ allowed: true });
        },
      },
      contextAssembler: {
        assemble: () => {
          contextCalls += 1;
          return Effect.succeed({ workspaceId: "workspace-1", question: "", evidence: [] });
        },
      },
      answerGenerator: {
        generate: () => {
          modelCalls += 1;
          return Effect.succeed({ text: "unsafe", citations: [], unavailableSources: [] });
        },
      },
    };

    await expect(
      Effect.runPromise(handleTeamsMention(unsupportedCommand, failClosedDependencies)),
    ).resolves.toEqual({
      kind: "denied",
      reason: "Sarathi is not available for this caller or channel.",
    });
    expect(authorizationCalls).toBe(0);
    expect(contextCalls).toBe(0);
    expect(modelCalls).toBe(0);
    expect(fixture.calls.delivered()).toBe(0);
  });

  it("answers the authorized hello diagnostic without retrieving evidence or calling a model", async () => {
    const fixture = dependencies({ helloDiagnosticEnabled: true });
    let contextCalls = 0;
    let modelCalls = 0;
    const diagnosticDependencies = {
      ...fixture.dependencies,
      contextAssembler: {
        assemble: () => {
          contextCalls += 1;
          return Effect.succeed({ workspaceId: "workspace-1", question: "hello", evidence: [] });
        },
      },
      answerGenerator: {
        generate: () => {
          modelCalls += 1;
          return fixture.dependencies.answerGenerator.generate({
            workspaceId: "workspace-1",
            question: "hello",
            evidence: [],
          });
        },
      },
    } as TeamsMentionDependencies;

    await expect(
      Effect.runPromise(
        handleTeamsMention({ ...command, question: "hello" }, diagnosticDependencies),
      ),
    ).resolves.toEqual({
      kind: "answered",
      answer: { text: "Hello from Sarathi.", citations: [], unavailableSources: [] },
    });
    expect(contextCalls).toBe(0);
    expect(modelCalls).toBe(0);
    expect(fixture.calls.delivered()).toBe(1);
  });

  it("fails closed for hello when the private diagnostic enablement is absent", async () => {
    const fixture = dependencies();
    let contextCalls = 0;
    const diagnosticDependencies = {
      ...fixture.dependencies,
      contextAssembler: {
        assemble: () => {
          contextCalls += 1;
          return Effect.succeed({ workspaceId: "workspace-1", question: "hello", evidence: [] });
        },
      },
    } as TeamsMentionDependencies;

    await expect(
      Effect.runPromise(
        handleTeamsMention({ ...command, question: "hello" }, diagnosticDependencies),
      ),
    ).resolves.toEqual({
      kind: "denied",
      reason: "Sarathi diagnostics are not enabled here.",
    });
    expect(contextCalls).toBe(0);
    expect(fixture.calls.delivered()).toBe(0);
    expect(fixture.state()).toBe("failed-terminal");
  });

  it("suppresses duplicate hello diagnostic delivery", async () => {
    const fixture = dependencies({ helloDiagnosticEnabled: true });
    const hello = { ...command, question: "hello" };
    await Effect.runPromise(handleTeamsMention(hello, fixture.dependencies));
    await expect(
      Effect.runPromise(handleTeamsMention(hello, fixture.dependencies)),
    ).resolves.toEqual({
      kind: "ignored",
      reason: "duplicate",
    });
    expect(fixture.calls.delivered()).toBe(1);
  });

  it("authorizes and passes the bounded thread context to delivery intelligence", async () => {
    const fixture = dependencies();
    let reporterCalls = 0;
    let contextCalls = 0;
    let modelCalls = 0;
    let genericAuthorizationCalls = 0;
    const deliveryDependencies: TeamsMentionDependencies = {
      ...fixture.dependencies,
      authorizer: {
        authorizeContext: () => {
          genericAuthorizationCalls += 1;
          return Effect.succeed({ allowed: true });
        },
      },
      deliveryTimeZone: "Asia/Kolkata",
      deliveryAssistant: {
        answer: (request) => {
          reporterCalls += 1;
          if (request.plan === undefined) throw new Error("Expected compiled delivery plan");
          expect(request).toMatchObject({
            workspaceId: "workspace-1",
            actorId: "actor-1",
            requestedAt: command.receivedAt,
            question: "Sarathi post team work summary",
            responseProduct: "operational_answer",
            plan: { intents: ["activity"], maximumLines: 3, requiresFinance: false },
            questionContext: {
              channelId: "channel-1",
              conversationId: "conversation-1",
              rootMessageId: "root-1",
              currentMessageId: "activity-1",
            },
          });
          return Effect.succeed({
            text: "GitHub: shipped.\nJira: advanced.\nTeams: decided.",
            citations: [],
            unavailableSources: [],
            status: "ok",
            plan: request.plan,
            conflicts: [],
            responseMode: "fast",
            responseProduct: "operational_answer",
            responseBudget: {
              sourceTimeoutMs: 4_500,
              compositionTimeoutMs: 2_500,
              totalBudgetMs: 6_500,
            },
            acceptance: {
              mode: "fast",
              product: "operational_answer",
              elapsedMs: 10,
              latencyTargetMs: 10_000,
              latencyPassed: true,
              requestedIntents: 1,
              coveredIntents: 1,
              completenessRatio: 1,
              completenessPassed: true,
              materialStatements: 0,
              citedStatements: 0,
              citationCoverage: 1,
              citationPassed: true,
              groundingPassed: true,
              freshEvidence: 0,
              evaluatedEvidence: 0,
              freshnessCoverage: 1,
              freshnessPassed: true,
              formatPassed: true,
              passed: true,
            },
          });
        },
      },
      contextAssembler: {
        assemble: () => {
          contextCalls += 1;
          return Effect.succeed({
            workspaceId: "workspace-1",
            question: command.question,
            evidence: [
              {
                source: "teams",
                sourceId: "root-1",
                sourceUrl: "https://teams.example.test/root-1",
                title: "Atlas Site Composer",
                excerpt: "What is the current status of Atlas Site Composer?",
                occurredAt: "2026-07-10T00:00:00.000Z",
                updatedAt: "2026-07-10T00:00:00.000Z",
                sensitivity: "internal",
                freshness: "current",
                contextRole: "conversation",
              },
            ],
          });
        },
      },
      answerGenerator: {
        generate: (envelope) => {
          modelCalls += 1;
          return fixture.dependencies.answerGenerator.generate(envelope);
        },
      },
    };

    await expect(
      Effect.runPromise(
        handleTeamsMention(
          { ...command, question: "Sarathi post team work summary" },
          deliveryDependencies,
        ),
      ),
    ).resolves.toMatchObject({
      kind: "answered",
      answer: { text: "GitHub: shipped.\nJira: advanced.\nTeams: decided." },
    });
    expect(reporterCalls).toBe(1);
    expect(contextCalls).toBe(1);
    expect(modelCalls).toBe(0);
    expect(genericAuthorizationCalls).toBe(1);
    expect(fixture.calls.delivered()).toBe(1);
  });

  it("forwards membership-scoped audience and corpus grants into delivery retrieval", async () => {
    const fixture = dependencies();
    const legacyResolved = await Effect.runPromise(fixture.dependencies.resolver.resolve(command));
    if (legacyResolved === undefined) throw new Error("Expected the synthetic mention to resolve.");
    const requests: unknown[] = [];
    const scopedDependencies: TeamsMentionDependencies = {
      ...fixture.dependencies,
      resolver: {
        resolve: () =>
          Effect.succeed({
            ...legacyResolved,
            authorization: {
              effectiveAudience: {
                id: "team-audience",
                kind: "team" as const,
                membership: {
                  member: true as const,
                  source: "microsoft_graph_roster" as const,
                  resolvedAt: command.receivedAt,
                  expiresAt: "2026-07-11T00:02:00.000Z",
                },
              },
              permittedAudienceIds: ["team-audience"],
              permittedSourceScopes: ["jira", "teams"] as const,
            },
          }),
      },
      deliveryTimeZone: "Asia/Kolkata",
      deliveryAssistant: {
        answer: (request) => {
          requests.push(request);
          return Effect.fail(new RepositoryError({ message: "stop after authorization proof" }));
        },
      },
    };

    await expect(
      Effect.runPromise(
        handleTeamsMention(
          {
            ...command,
            replyTarget: { ...command.replyTarget, rootActivityId: command.activityId },
            question: "What is the current delivery status?",
          },
          scopedDependencies,
        ),
      ),
    ).resolves.toMatchObject({ kind: "denied" });
    expect(requests).toEqual([
      expect.objectContaining({
        audienceIds: ["team-audience"],
        permittedSourceScopes: ["jira", "teams"],
      }),
    ]);
  });

  it("answers a top-level delivery question without redundant context assembly", async () => {
    const fixture = dependencies();
    let contextCalls = 0;
    let reporterCalls = 0;
    const topLevelCommand = {
      ...command,
      replyTarget: { ...command.replyTarget, rootActivityId: command.activityId },
      question: "What is planned this week?",
    };
    const deliveryDependencies: TeamsMentionDependencies = {
      ...fixture.dependencies,
      deliveryTimeZone: "Asia/Kolkata",
      contextAssembler: {
        assemble: () => {
          contextCalls += 1;
          return Effect.fail(new RepositoryError({ message: "Supplemental search unavailable" }));
        },
      },
      deliveryAssistant: {
        answer: (request) => {
          reporterCalls += 1;
          expect(request.questionContext).toMatchObject({
            rootMessageId: command.activityId,
            currentMessageId: command.activityId,
            evidence: [],
          });
          if (request.plan === undefined) throw new Error("Expected compiled delivery plan");
          return Effect.succeed({
            text: "Planned work is source-backed.",
            citations: [],
            unavailableSources: [],
            status: "ok",
            plan: request.plan,
            conflicts: [],
            responseMode: "fast",
            responseProduct: "period_delivery_brief",
            responseBudget: {
              sourceTimeoutMs: 8_000,
              compositionTimeoutMs: 4_000,
              totalBudgetMs: 12_000,
            },
            acceptance: {
              mode: "fast",
              product: "period_delivery_brief",
              elapsedMs: 10,
              latencyTargetMs: 10_000,
              latencyPassed: true,
              requestedIntents: 1,
              coveredIntents: 1,
              completenessRatio: 1,
              completenessPassed: true,
              materialStatements: 0,
              citedStatements: 0,
              citationCoverage: 1,
              citationPassed: true,
              groundingPassed: true,
              freshEvidence: 0,
              evaluatedEvidence: 0,
              freshnessCoverage: 1,
              freshnessPassed: true,
              formatPassed: true,
              passed: true,
            },
          });
        },
      },
    };

    await expect(
      Effect.runPromise(handleTeamsMention(topLevelCommand, deliveryDependencies)),
    ).resolves.toMatchObject({
      kind: "answered",
      answer: { text: "Planned work is source-backed." },
    });
    expect(contextCalls).toBe(0);
    expect(reporterCalls).toBe(1);
  });

  it("posts the safe report failure notice once and records the external delivery", async () => {
    const fixture = dependencies();
    let postedText = "";
    let postedReplies = 0;
    const deliveryDependencies: TeamsMentionDependencies = {
      ...fixture.dependencies,
      deliveryTimeZone: "Asia/Kolkata",
      delivery: {
        reply: (_command, answer) =>
          Effect.sync(() => {
            postedText = answer.text;
            postedReplies += 1;
          }),
      },
      deliveryAssistant: {
        answer: (request) => {
          if (request.plan === undefined) throw new Error("Expected compiled delivery plan");
          return Effect.succeed({
            text: [
              "Response composition failed.",
              "",
              "Error code: SARATHI-REPORT-COMPOSITION-FAILED",
              "Correlation code: SAR-1234ABCD",
              "Please retry the request.",
            ].join("\n"),
            citations: [],
            unavailableSources: [],
            status: "failed",
            plan: request.plan,
            conflicts: [],
            responseMode: "deep_dive",
            responseProduct: "period_delivery_brief",
            responseBudget: {
              sourceTimeoutMs: 90_000,
              compositionTimeoutMs: 120_000,
              totalBudgetMs: 240_000,
            },
            acceptance: {
              mode: "deep_dive",
              product: "period_delivery_brief",
              elapsedMs: 10,
              latencyPassed: true,
              requestedIntents: 1,
              coveredIntents: 0,
              completenessRatio: 0,
              completenessPassed: false,
              materialStatements: 0,
              citedStatements: 0,
              citationCoverage: 1,
              citationPassed: true,
              groundingPassed: true,
              freshEvidence: 0,
              evaluatedEvidence: 0,
              freshnessCoverage: 1,
              freshnessPassed: true,
              formatPassed: false,
              passed: false,
            },
            failure: {
              code: "SARATHI-REPORT-COMPOSITION-FAILED",
              classification: "SARATHI-REPORT-PROVIDER-FAILED",
              correlationCode: "SAR-1234ABCD",
            },
          });
        },
      },
    };

    await expect(
      Effect.runPromise(
        handleTeamsMention(
          {
            ...command,
            replyTarget: { ...command.replyTarget, rootActivityId: command.activityId },
            question: "What was delivered last week?",
          },
          deliveryDependencies,
        ),
      ),
    ).resolves.toMatchObject({
      kind: "answered",
      answer: { status: "failed", citations: [] },
    });
    await expect(
      Effect.runPromise(
        handleTeamsMention(
          {
            ...command,
            replyTarget: { ...command.replyTarget, rootActivityId: command.activityId },
            question: "What was delivered last week?",
          },
          deliveryDependencies,
        ),
      ),
    ).resolves.toEqual({ kind: "ignored", reason: "duplicate" });
    expect(postedText).toContain("SARATHI-REPORT-COMPOSITION-FAILED");
    expect(postedText).not.toContain("## Delivered");
    expect(postedReplies).toBe(1);
    expect(fixture.state()).toBe("delivered");
    expect(fixture.calls.delivered()).toBe(0);
    expect(fixture.calls.failed()).toBe(0);
  });

  it("denies a delivery question before context retrieval when the boundary disallows it", async () => {
    const fixture = dependencies();
    let contextCalls = 0;
    let deliveryCalls = 0;
    const deniedDependencies: TeamsMentionDependencies = {
      ...fixture.dependencies,
      deliveryTimeZone: "Asia/Kolkata",
      deliveryAssistant: {
        answer: () => {
          deliveryCalls += 1;
          throw new Error("Delivery intelligence must not run before authorization.");
        },
      },
      authorizer: {
        authorizeContext: () => Effect.succeed({ allowed: false }),
      },
      contextAssembler: {
        assemble: () => {
          contextCalls += 1;
          throw new Error("Context retrieval must not run before authorization.");
        },
      },
    };

    await expect(
      Effect.runPromise(
        handleTeamsMention(
          { ...command, question: "What is the current project status?" },
          deniedDependencies,
        ),
      ),
    ).resolves.toEqual({
      kind: "denied",
      reason: "Sarathi cannot use this thread's context.",
    });
    expect(contextCalls).toBe(0);
    expect(deliveryCalls).toBe(0);
    expect(fixture.state()).toBe("failed-terminal");
  });

  it("records retryable failure without recording delivery", async () => {
    const fixture = dependencies({ deliveryFails: true });
    await expect(
      Effect.runPromise(handleTeamsMention(command, fixture.dependencies)),
    ).resolves.toMatchObject({ kind: "denied" });
    expect(fixture.state()).toBe("failed-retryable");
    expect(fixture.calls.delivered()).toBe(0);
    expect(fixture.calls.failed()).toBe(1);
    expect(fixture.calls.states()).toEqual(["processing", "failed-retryable"]);
  });

  it("retries safely after a transient delivery failure", async () => {
    const fixture = dependencies({ deliveryFails: true });
    await Effect.runPromise(handleTeamsMention(command, fixture.dependencies));
    const retry = dependencies();
    const sharedAudit = fixture.dependencies.audit;
    const retried = { ...retry.dependencies, audit: sharedAudit };
    await expect(Effect.runPromise(handleTeamsMention(command, retried))).resolves.toMatchObject({
      kind: "answered",
    });
    expect(fixture.state()).toBe("delivered");
    expect(retry.calls.delivered()).toBe(1);
    expect(fixture.calls.states()).toEqual([
      "processing",
      "failed-retryable",
      "processing",
      "delivered",
    ]);
  });
});

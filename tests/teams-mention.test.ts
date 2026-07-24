import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { RepositoryError } from "../src/domain/errors.ts";
import {
  handleTeamsMention,
  stripSarathiMention,
  type TeamsMentionDependencies,
} from "../src/modules/teams-mention/index.ts";

const command = {
  activityId: "activity-1",
  tenantId: "tenant-1",
  teamId: "team-1",
  graphTeamId: "graph-team-1",
  channelId: "channel-1",
  conversationId: "conversation-1",
  rootActivityId: "root-1",
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
            acceptance: {
              mode: "fast",
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
                title: "Modern Website Builder",
                excerpt: "What is the current status of Modern Website Builder?",
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

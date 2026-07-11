import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  handleTeamsMention,
  stripSarathiMention,
  type TeamsMentionDependencies,
} from "../src/modules/teams-mention/index.ts";

const command = {
  activityId: "activity-1",
  tenantId: "tenant-1",
  teamId: "team-1",
  channelId: "channel-1",
  conversationId: "conversation-1",
  rootActivityId: "root-1",
  serviceUrl: "https://service.example.test",
  caller: { entraObjectId: "caller-1", displayName: "Delivery Member" },
  question: "What is the goal?",
  receivedAt: "2026-07-11T00:00:00.000Z",
} as const;

const dependencies = (reserved = true): TeamsMentionDependencies => ({
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
    generate: () => Effect.succeed({ text: "Known fact.", citations: [], unavailableSources: [] }),
  },
  delivery: { reply: () => Effect.void },
  audit: { reserveActivity: () => Effect.succeed(reserved), record: () => Effect.void },
});

describe("teams mention", () => {
  it("strips only the Sarathi mention", () => {
    expect(stripSarathiMention("<at>bot-1</at> What is the goal?", "bot-1")).toBe(
      "What is the goal?",
    );
  });

  it("answers an authorized direct mention once", async () => {
    await expect(
      Effect.runPromise(handleTeamsMention(command, dependencies())),
    ).resolves.toMatchObject({
      kind: "answered",
      answer: { text: "Known fact." },
    });
  });

  it("does not answer a duplicate activity", async () => {
    await expect(
      Effect.runPromise(handleTeamsMention(command, dependencies(false))),
    ).resolves.toEqual({
      kind: "ignored",
      reason: "duplicate",
    });
  });
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createAuthorizedContextAssembler } from "../src/modules/teams-mention/index.ts";

const command = {
  activityId: "activity",
  tenantId: "tenant",
  teamId: "team",
  channelId: "channel",
  conversationId: "conversation",
  rootActivityId: "root",
  serviceUrl: "https://service.example.test",
  caller: { entraObjectId: "caller", displayName: "Caller" },
  question: "What changed?",
  receivedAt: "2026-07-11T00:00:00.000Z",
} as const;

const resolved = {
  workspaceId: "workspace",
  callerId: "actor",
  callerTrustTier: "member" as const,
  channelSensitivity: "internal" as const,
  boundary: {
    sensitivity: "internal" as const,
    minimumTrustTier: "member" as const,
    allowedDelegationStages: ["answer"] as const,
    modelEgress: "allow" as const,
    requiresHumanApproval: false,
    requiresPreRetrievalAuthorization: true,
    requiresToolAuthorization: true,
  },
};

describe("authorized context assembler", () => {
  it("keeps only consented, sensitivity-bounded HTTPS evidence with a citation link", async () => {
    const sourceKeys: string[] = [];
    const assembler = createAuthorizedContextAssembler([
      {
        sourceKey: () => "teams:team:channel:root",
        reader: {
          readEvidence: async (request) => {
            sourceKeys.push(request.sourceKey);
            return {
              records: [
                {
                  sourceSystem: "teams",
                  sourceType: "message",
                  externalId: "allowed",
                  externalUrl: "https://teams.example.test/message/allowed",
                  occurredAt: "2026-07-11T00:00:00.000Z",
                  title: "Allowed",
                  bodyExcerpt: "Confirmed delivery status.",
                  sensitivity: "internal",
                  consent: {
                    status: "granted",
                    scope: "team",
                    recordedAt: "2026-07-11T00:00:00.000Z",
                  },
                },
                {
                  sourceSystem: "vault",
                  sourceType: "note",
                  externalId: "restricted",
                  externalUrl: "https://vault.example.test/restricted",
                  occurredAt: "2026-07-11T00:00:00.000Z",
                  title: "Restricted",
                  sensitivity: "restricted",
                  consent: {
                    status: "granted",
                    scope: "vault",
                    recordedAt: "2026-07-11T00:00:00.000Z",
                  },
                },
                {
                  sourceSystem: "jira",
                  sourceType: "issue",
                  externalId: "unconsented",
                  externalUrl: "http://jira.example.test/issue/1",
                  occurredAt: "2026-07-11T00:00:00.000Z",
                  title: "Unconsented",
                  sensitivity: "internal",
                  consent: {
                    status: "unknown",
                    scope: "jira",
                    recordedAt: "2026-07-11T00:00:00.000Z",
                  },
                },
              ],
            };
          },
        },
      },
    ]);

    await expect(Effect.runPromise(assembler.assemble(command, resolved))).resolves.toEqual({
      workspaceId: "workspace",
      question: "What changed?",
      evidence: [
        expect.objectContaining({
          source: "teams",
          sourceId: "allowed",
          sourceUrl: "https://teams.example.test/message/allowed",
          sensitivity: "internal",
        }),
      ],
    });
    expect(sourceKeys).toEqual(["teams:team:channel:root"]);
  });

  it("fails closed instead of returning a partial envelope when a reader fails", async () => {
    const assembler = createAuthorizedContextAssembler([
      {
        sourceKey: () => "jira:F1851-754",
        reader: { readEvidence: async () => Promise.reject(new Error("unavailable")) },
      },
    ]);

    await expect(Effect.runPromise(assembler.assemble(command, resolved))).rejects.toThrow(
      "Approved context retrieval failed",
    );
  });
});

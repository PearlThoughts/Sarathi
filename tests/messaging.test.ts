import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
  type ExternalPrincipalMapper,
  resolveExternalPrincipal,
} from "../src/modules/identity-access/index.ts";
import type {
  IncomingMessage,
  MessageDelivery,
  MessageSurface,
  OutgoingMessage,
} from "../src/modules/messaging/index.ts";

describe("messaging contracts", () => {
  it("models incoming Teams messages without adapter-specific objects", () => {
    const surface: MessageSurface = "chat";
    const message: IncomingMessage = {
      reference: {
        system: "microsoft-teams",
        surface,
        externalConversationId: "conversation-1",
        externalMessageId: "message-1",
      },
      externalPrincipal: {
        issuer: "microsoft-entra",
        subject: "user-1",
        displayName: "User One",
      },
      text: "What is blocked?",
      receivedAt: "2026-07-04T06:00:00.000Z",
    };

    expect(message.reference.surface).toBe("chat");
    expect(message.externalPrincipal.subject).toBe("user-1");
  });

  it("maps external messaging principals before treating them as Sarathi principals", async () => {
    const mapper: ExternalPrincipalMapper = {
      provider: "external-principal-mapper",
      mapPrincipal: (principal) =>
        Effect.succeed(
          Option.some({
            id: `entra:${principal.subject}`,
            roles: ["member"],
            organizationIds: ["installed-organization"],
            teamIds: ["engineering"],
          }),
        ),
    };

    const principal = await Effect.runPromise(
      resolveExternalPrincipal(mapper, {
        issuer: "microsoft-entra",
        subject: "user-1",
      }),
    );

    expect(principal).toMatchObject({
      id: "entra:user-1",
      roles: ["member"],
    });
  });

  it("fails closed for unmapped external messaging principals", async () => {
    const mapper: ExternalPrincipalMapper = {
      provider: "external-principal-mapper",
      mapPrincipal: () => Effect.succeed(Option.none()),
    };

    await expect(
      Effect.runPromise(
        resolveExternalPrincipal(mapper, {
          issuer: "bot-framework",
          subject: "unknown-user",
        }),
      ),
    ).rejects.toThrow("external principal is not mapped");
  });

  it("defines proactive message delivery without binding to Bot Framework internals", async () => {
    const message: OutgoingMessage = {
      reference: {
        system: "microsoft-teams",
        surface: "chat",
        externalConversationId: "conversation-1",
      },
      text: "Follow-up digest",
      format: "markdown",
    };
    const delivery: MessageDelivery = {
      provider: "message-delivery",
      sendMessage: (outgoing) =>
        Effect.succeed({
          delivered: outgoing.reference.system === "microsoft-teams",
          externalMessageId: "message-1",
        }),
    };

    await expect(Effect.runPromise(delivery.sendMessage(message))).resolves.toEqual({
      delivered: true,
      externalMessageId: "message-1",
    });
  });
});

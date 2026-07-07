import type { SourceSystem } from "../../../domain/source-systems.ts";

export type MessageSurface = "channel" | "chat" | "thread";

export type MessageReference = {
  readonly system: Extract<SourceSystem, "microsoft-teams">;
  readonly surface: MessageSurface;
  readonly externalConversationId: string;
  readonly externalMessageId?: string | undefined;
  readonly serviceUrl?: string | undefined;
};

export type IncomingMessage = {
  readonly reference: MessageReference;
  readonly externalPrincipal: {
    readonly issuer: string;
    readonly subject: string;
    readonly displayName?: string | undefined;
  };
  readonly text: string;
  readonly receivedAt: string;
};

export type OutgoingMessage = {
  readonly reference: MessageReference;
  readonly text: string;
  readonly format: "markdown" | "plain";
};

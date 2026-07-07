import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { OutgoingMessage } from "../domain/message.ts";

export type MessageDeliveryResult = {
  readonly delivered: boolean;
  readonly externalMessageId?: string | undefined;
};

export type MessageDelivery = {
  readonly provider: "message-delivery";
  readonly sendMessage: (
    message: OutgoingMessage,
  ) => Effect.Effect<MessageDeliveryResult, RepositoryError>;
};

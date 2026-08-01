import { Effect } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import type { DeliveryAssistant } from "../ports/delivery-intelligence-ports.ts";

export const defaultDeliveryMaxConcurrency = 1;
export const defaultDeliveryMaxQueueDepth = 2;

export type BoundedDeliveryAssistantConfiguration = {
  readonly maxConcurrency?: number | undefined;
  readonly maxQueueDepth?: number | undefined;
};

export type BoundedDeliveryAssistant = DeliveryAssistant & {
  readonly capacity: () => {
    readonly activeAndQueued: number;
    readonly maximum: number;
    readonly maxConcurrency: number;
    readonly maxQueueDepth: number;
  };
};

const positiveInteger = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be positive.`);
  return value;
};

const nonNegativeInteger = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be non-negative.`);
  return value;
};

export const createBoundedDeliveryAssistant = (
  assistant: DeliveryAssistant,
  configuration: BoundedDeliveryAssistantConfiguration = {},
): BoundedDeliveryAssistant => {
  const maxConcurrency = positiveInteger(
    "maxConcurrency",
    configuration.maxConcurrency ?? defaultDeliveryMaxConcurrency,
  );
  const maxQueueDepth = nonNegativeInteger(
    "maxQueueDepth",
    configuration.maxQueueDepth ?? defaultDeliveryMaxQueueDepth,
  );
  const maximum = maxConcurrency + maxQueueDepth;
  const semaphore = Effect.runSync(Effect.makeSemaphore(maxConcurrency));
  let activeAndQueued = 0;

  return {
    answer: (request) =>
      Effect.acquireUseRelease(
        Effect.suspend(() => {
          if (activeAndQueued >= maximum) {
            return Effect.fail(
              new RepositoryError({
                message: "Delivery composition capacity is temporarily unavailable.",
                operation: "delivery-composition-capacity",
              }),
            );
          }
          activeAndQueued += 1;
          return Effect.void;
        }),
        () => semaphore.withPermits(1)(assistant.answer(request)),
        () =>
          Effect.sync(() => {
            activeAndQueued -= 1;
          }),
      ),
    capacity: () => ({ activeAndQueued, maximum, maxConcurrency, maxQueueDepth }),
  };
};

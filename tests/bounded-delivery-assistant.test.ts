import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { RepositoryError } from "../src/domain/errors.ts";
import { defaultTeamsMentionLeaseDurationMs } from "../src/infrastructure/postgres/index.ts";
import {
  createBoundedDeliveryAssistant,
  type DeliveryAssistant,
  type DeliveryAssistantAnswer,
  type DeliveryAssistantRequest,
  defaultDeliveryMaxQueueDepth,
  deliveryTransportTimeoutMs,
} from "../src/modules/delivery-intelligence/index.ts";

const request = {} as DeliveryAssistantRequest;
const answer = {} as DeliveryAssistantAnswer;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

describe("bounded delivery assistant", () => {
  it("queues within capacity and rejects overflow without invoking the assistant", async () => {
    const starts = [deferred(), deferred()];
    const releases = [deferred(), deferred()];
    let invocations = 0;
    const assistant: DeliveryAssistant = {
      answer: () =>
        Effect.tryPromise({
          try: async () => {
            const index = invocations++;
            starts[index]?.resolve();
            await releases[index]?.promise;
            return answer;
          },
          catch: () => new RepositoryError({ message: "unexpected test failure" }),
        }),
    };
    const bounded = createBoundedDeliveryAssistant(assistant, {
      maxConcurrency: 1,
      maxQueueDepth: 1,
    });

    const first = Effect.runPromise(bounded.answer(request));
    await starts[0]?.promise;
    const second = Effect.runPromise(bounded.answer(request));
    await Promise.resolve();
    expect(bounded.capacity()).toMatchObject({ activeAndQueued: 2, maximum: 2 });
    await expect(Effect.runPromise(Effect.either(bounded.answer(request)))).resolves.toMatchObject({
      _tag: "Left",
      left: expect.objectContaining({ operation: "delivery-composition-capacity" }),
    });
    expect(invocations).toBe(1);

    releases[0]?.resolve();
    await starts[1]?.promise;
    expect(invocations).toBe(2);
    releases[1]?.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([answer, answer]);
    expect(bounded.capacity().activeAndQueued).toBe(0);
  });

  it("releases capacity when an active request is interrupted", async () => {
    const started = deferred();
    let invocations = 0;
    const assistant: DeliveryAssistant = {
      answer: () => {
        invocations += 1;
        return invocations === 1
          ? Effect.sync(started.resolve).pipe(Effect.zipRight(Effect.never))
          : Effect.succeed(answer);
      },
    };
    const bounded = createBoundedDeliveryAssistant(assistant, {
      maxConcurrency: 1,
      maxQueueDepth: 0,
    });

    const fiber = Effect.runFork(bounded.answer(request));
    await started.promise;
    expect(bounded.capacity().activeAndQueued).toBe(1);
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(bounded.capacity().activeAndQueued).toBe(0);
    await expect(Effect.runPromise(bounded.answer(request))).resolves.toBe(answer);
  });

  it("releases capacity when the wrapped assistant fails", async () => {
    let invocations = 0;
    const assistant: DeliveryAssistant = {
      answer: () => {
        invocations += 1;
        return invocations === 1
          ? Effect.fail(new RepositoryError({ message: "provider unavailable" }))
          : Effect.succeed(answer);
      },
    };
    const bounded = createBoundedDeliveryAssistant(assistant, {
      maxConcurrency: 1,
      maxQueueDepth: 0,
    });

    await expect(Effect.runPromise(Effect.either(bounded.answer(request)))).resolves.toMatchObject({
      _tag: "Left",
      left: expect.objectContaining({ message: "provider unavailable" }),
    });
    expect(bounded.capacity().activeAndQueued).toBe(0);
    await expect(Effect.runPromise(bounded.answer(request))).resolves.toBe(answer);
  });

  it("keeps the default queue inside the expiring activity lease budget", () => {
    const worstCaseCompletionMs =
      (defaultDeliveryMaxQueueDepth + 1) * deliveryTransportTimeoutMs("leadership_report");
    expect(worstCaseCompletionMs).toBeLessThan(defaultTeamsMentionLeaseDurationMs);
  });

  it("rejects invalid capacity configuration", () => {
    const assistant: DeliveryAssistant = { answer: () => Effect.succeed(answer) };
    expect(() => createBoundedDeliveryAssistant(assistant, { maxConcurrency: 0 })).toThrow(
      "maxConcurrency must be positive",
    );
    expect(() => createBoundedDeliveryAssistant(assistant, { maxQueueDepth: -1 })).toThrow(
      "maxQueueDepth must be non-negative",
    );
  });
});

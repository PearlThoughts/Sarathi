import { Tracer as EffectOpenTelemetryTracer } from "@effect/opentelemetry";
import { Effect, Exit } from "effect";
import {
  type DeliveryExecutionAttributes,
  type DeliveryExecutionFailureClass,
  type DeliveryExecutionStage,
  sanitizeDeliveryExecutionAttributes,
} from "../domain/execution-telemetry.ts";
import type {
  DeliveryExecutionObserver,
  DeliveryExecutionSpan,
} from "../ports/delivery-execution-observer.ts";
import { createNoopDeliveryExecutionObserver } from "../ports/delivery-execution-observer.ts";

export type DeliveryExecutionContext = {
  readonly observer: DeliveryExecutionObserver;
  readonly span: DeliveryExecutionSpan;
  readonly deadlineEpochMs: number;
  readonly signal: AbortSignal;
  readonly nowEpochMs: () => number;
};

export const remainingDeliveryExecutionBudgetMs = (context: DeliveryExecutionContext): number =>
  Math.max(0, context.deadlineEpochMs - context.nowEpochMs());

export const startDeliveryExecution = (input: {
  readonly observer: DeliveryExecutionObserver;
  readonly deadlineEpochMs: number;
  readonly signal: AbortSignal;
  readonly nowEpochMs?: (() => number) | undefined;
  readonly stage?: "delivery.report" | "scheduler.execute" | "synchronization.execute" | undefined;
  readonly attributes?: DeliveryExecutionAttributes | undefined;
}): DeliveryExecutionContext => ({
  observer: input.observer,
  span: input.observer.startSpan({
    stage: input.stage ?? "delivery.report",
    attributes: sanitizeDeliveryExecutionAttributes(input.attributes ?? {}),
  }),
  deadlineEpochMs: input.deadlineEpochMs,
  signal: input.signal,
  nowEpochMs: input.nowEpochMs ?? Date.now,
});

export const childDeliveryExecution = (
  parent: DeliveryExecutionContext,
  stage: DeliveryExecutionStage,
  attributes: DeliveryExecutionAttributes = {},
): DeliveryExecutionContext => ({
  ...parent,
  span: parent.observer.startSpan({
    stage,
    parent: parent.span,
    attributes: sanitizeDeliveryExecutionAttributes({
      ...attributes,
      "budget.remaining.ms": remainingDeliveryExecutionBudgetMs(parent),
    }),
  }),
});

export const endDeliveryExecution = (
  context: DeliveryExecutionContext,
  outcome: "success" | "failed" | "cancelled" | "timeout",
  attributes: DeliveryExecutionAttributes = {},
  failureClass: DeliveryExecutionFailureClass = "none",
): void => {
  const elapsedMs = Math.max(0, Date.now() - context.span.startedAtEpochMs);
  const safeAttributes = sanitizeDeliveryExecutionAttributes({
    ...attributes,
    "elapsed.ms": elapsedMs,
    "budget.remaining.ms": remainingDeliveryExecutionBudgetMs(context),
    "cancellation.state": context.signal.aborted ? "acknowledged" : "not_requested",
  });
  context.observer.endSpan(context.span, { outcome, failureClass, attributes: safeAttributes });
  context.observer.recordMetric({
    name: "delivery.stage.duration",
    value: elapsedMs,
    unit: "ms",
    labels: { stage: context.span.stage, outcome, failure_class: failureClass },
  });
  context.observer.recordMetric({
    name: "delivery.budget.remaining",
    value: remainingDeliveryExecutionBudgetMs(context),
    unit: "ms",
    labels: { stage: context.span.stage, outcome },
  });
};

export const observeDeliveryEffect = <A, E, R>(
  parent: DeliveryExecutionContext,
  stage: DeliveryExecutionStage,
  attributes: DeliveryExecutionAttributes,
  make: (context: DeliveryExecutionContext) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  const context = childDeliveryExecution(parent, stage, attributes);
  const effectParentSpan = EffectOpenTelemetryTracer.makeExternalSpan({
    traceId: context.span.traceId,
    spanId: context.span.parentSpanId ?? context.span.spanId,
  });
  return make(context).pipe(
    Effect.onExit((exit) =>
      Effect.sync(() => {
        if (Exit.isSuccess(exit)) {
          endDeliveryExecution(context, "success");
          return;
        }
        const outcome = context.signal.aborted
          ? "cancelled"
          : remainingDeliveryExecutionBudgetMs(context) === 0
            ? "timeout"
            : "failed";
        endDeliveryExecution(
          context,
          outcome,
          {},
          outcome === "timeout" ? "internal_deadline_exhaustion" : "other",
        );
      }),
    ),
    Effect.withSpan(stage, { attributes: sanitizeDeliveryExecutionAttributes(attributes) }),
    Effect.withParentSpan(effectParentSpan),
  );
};

export const createInMemoryDeliveryExecutionObserver = (): DeliveryExecutionObserver & {
  readonly spans: readonly {
    readonly span: DeliveryExecutionSpan;
    readonly outcome?: string | undefined;
    readonly attributes?: DeliveryExecutionAttributes | undefined;
  }[];
  readonly metrics: readonly unknown[];
  readonly errors: readonly unknown[];
} => {
  const spans: {
    span: DeliveryExecutionSpan;
    outcome?: string | undefined;
    attributes?: DeliveryExecutionAttributes | undefined;
  }[] = [];
  const metrics: unknown[] = [];
  const errors: unknown[] = [];
  const noop = createNoopDeliveryExecutionObserver();
  return {
    spans,
    metrics,
    errors,
    startSpan: (input) => {
      const span = noop.startSpan(input);
      spans.push({ span });
      return span;
    },
    endSpan: (span, input) => {
      const index = spans.findIndex((entry) => entry.span.spanId === span.spanId);
      if (index >= 0) spans[index] = { span, outcome: input.outcome, attributes: input.attributes };
    },
    recordMetric: (input) => metrics.push(input),
    captureError: (input) => errors.push(input),
  };
};

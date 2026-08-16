import type {
  DeliveryExecutionAttributes,
  DeliveryExecutionFailureClass,
  DeliveryExecutionMetricLabels,
  DeliveryExecutionMetricName,
  DeliveryExecutionOutcome,
  DeliveryExecutionStage,
} from "../domain/execution-telemetry.ts";

export type DeliveryExecutionSpan = {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string | undefined;
  readonly stage: DeliveryExecutionStage;
  readonly startedAtEpochMs: number;
};

export type DeliveryExecutionObserver = {
  readonly startSpan: (input: {
    readonly stage: DeliveryExecutionStage;
    readonly parent?: DeliveryExecutionSpan | undefined;
    readonly attributes?: DeliveryExecutionAttributes | undefined;
  }) => DeliveryExecutionSpan;
  readonly endSpan: (
    span: DeliveryExecutionSpan,
    input: {
      readonly outcome: DeliveryExecutionOutcome;
      readonly failureClass?: DeliveryExecutionFailureClass | undefined;
      readonly attributes?: DeliveryExecutionAttributes | undefined;
    },
  ) => void;
  readonly recordMetric: (input: {
    readonly name: DeliveryExecutionMetricName;
    readonly value: number;
    readonly unit: "1" | "ms" | "By" | "USD";
    readonly labels?: DeliveryExecutionMetricLabels | undefined;
  }) => void;
  readonly captureError: (input: {
    readonly code: string;
    readonly stage: DeliveryExecutionStage;
    readonly failureClass: DeliveryExecutionFailureClass;
    readonly deploymentId?: string | undefined;
    readonly elapsedMs?: number | undefined;
  }) => void;
};

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");

export const createNoopDeliveryExecutionObserver = (): DeliveryExecutionObserver => ({
  startSpan: ({ stage, parent }) => ({
    traceId: parent?.traceId ?? randomHex(16),
    spanId: randomHex(8),
    ...(parent === undefined ? {} : { parentSpanId: parent.spanId }),
    stage,
    startedAtEpochMs: Date.now(),
  }),
  endSpan: () => undefined,
  recordMetric: () => undefined,
  captureError: () => undefined,
});

import {
  type Attributes,
  metrics,
  context as otelContext,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import {
  type DeliveryExecutionAttributes,
  type DeliveryExecutionMetricName,
  type DeliveryExecutionObserver,
  type DeliveryExecutionSpan,
  sanitizeDeliveryExecutionAttributes,
  sanitizeDeliveryExecutionMetricLabels,
} from "../../modules/delivery-execution-observability/index.ts";

type SafeErrorCapture = (input: {
  readonly code: string;
  readonly stage: string;
  readonly failureClass: string;
  readonly deploymentId?: string | undefined;
  readonly elapsedMs?: number | undefined;
}) => void;

type OpenTelemetryDeliveryObserverConfiguration = {
  readonly structuredLog?: ((event: Readonly<Record<string, unknown>>) => void) | undefined;
  readonly safeErrorCapture?: SafeErrorCapture | undefined;
};

const safeOtelAttributes = (attributes: DeliveryExecutionAttributes | undefined): Attributes =>
  sanitizeDeliveryExecutionAttributes(attributes ?? {}) as Attributes;

export const createOpenTelemetryDeliveryExecutionObserver = (
  configuration: OpenTelemetryDeliveryObserverConfiguration = {},
): DeliveryExecutionObserver => {
  const tracer = trace.getTracer("sarathi.delivery-execution", "1");
  const meter = metrics.getMeter("sarathi.delivery-execution", "1");
  const activeSpans = new Map<string, Span>();
  const instruments = new Map<
    DeliveryExecutionMetricName,
    ReturnType<typeof meter.createHistogram>
  >();
  const log = (event: Readonly<Record<string, unknown>>): void => {
    if (configuration.structuredLog === undefined) return;
    queueMicrotask(() => {
      try {
        configuration.structuredLog?.(event);
      } catch {
        // Telemetry logging is explicitly fail-open.
      }
    });
  };
  return {
    startSpan: ({ stage, parent, attributes }) => {
      const parentOtelSpan = parent === undefined ? undefined : activeSpans.get(parent.spanId);
      const parentContext =
        parentOtelSpan === undefined
          ? otelContext.active()
          : trace.setSpan(otelContext.active(), parentOtelSpan);
      const otelSpan = tracer.startSpan(
        stage,
        { attributes: safeOtelAttributes(attributes) },
        parentContext,
      );
      const spanContext = otelSpan.spanContext();
      const span: DeliveryExecutionSpan = {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        ...(parent === undefined ? {} : { parentSpanId: parent.spanId }),
        stage,
        startedAtEpochMs: Date.now(),
      };
      activeSpans.set(span.spanId, otelSpan);
      return span;
    },
    endSpan: (span, input) => {
      const otelSpan = activeSpans.get(span.spanId);
      if (otelSpan !== undefined) {
        otelSpan.setAttributes(safeOtelAttributes(input.attributes));
        otelSpan.setAttribute("delivery.outcome", input.outcome);
        otelSpan.setAttribute("delivery.failure_class", input.failureClass ?? "none");
        otelSpan.setStatus({
          code: input.outcome === "success" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        });
        otelSpan.end();
        activeSpans.delete(span.spanId);
      }
      log({
        event: "delivery_execution_span",
        stage: span.stage,
        outcome: input.outcome,
        failure_class: input.failureClass ?? "none",
        elapsed_ms: Math.max(0, Date.now() - span.startedAtEpochMs),
        trace_id: span.traceId,
        span_id: span.spanId,
        ...(span.parentSpanId === undefined ? {} : { parent_span_id: span.parentSpanId }),
        ...sanitizeDeliveryExecutionAttributes(input.attributes ?? {}),
      });
    },
    recordMetric: ({ name, value, unit, labels }) => {
      try {
        const instrument =
          instruments.get(name) ?? meter.createHistogram(name, { unit, description: name });
        instruments.set(name, instrument);
        instrument.record(value, sanitizeDeliveryExecutionMetricLabels(labels ?? {}) as Attributes);
      } catch {
        // Metrics cannot fail or extend report execution.
      }
    },
    captureError: (input) => {
      queueMicrotask(() => {
        try {
          configuration.safeErrorCapture?.(input);
        } catch {
          // Error reporting is explicitly fail-open.
        }
      });
    },
  };
};

type DeliveryOpenTelemetryRuntimeConfiguration = {
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly serviceVersion?: string | undefined;
  readonly deploymentId?: string | undefined;
  readonly environment: "production" | "staging" | "development" | "test" | "other";
  readonly exportIntervalMs?: number | undefined;
  readonly exportTimeoutMs?: number | undefined;
  readonly maximumQueueSize?: number | undefined;
};

const otlpUrl = (base: string, signal: "traces" | "metrics"): string =>
  `${base.replace(/\/+$/, "")}/v1/${signal}`;

const startDeliveryOpenTelemetryRuntime = (
  configuration: DeliveryOpenTelemetryRuntimeConfiguration,
): { readonly shutdown: () => Promise<void> } => {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "sarathi",
    ...(configuration.serviceVersion === undefined
      ? {}
      : { [ATTR_SERVICE_VERSION]: configuration.serviceVersion }),
    "deployment.environment.name": configuration.environment,
    ...(configuration.deploymentId === undefined
      ? {}
      : { "service.instance.id": configuration.deploymentId }),
  });
  const traceExporter = new OTLPTraceExporter({
    url: otlpUrl(configuration.endpoint, "traces"),
    ...(configuration.headers === undefined ? {} : { headers: { ...configuration.headers } }),
    timeoutMillis: configuration.exportTimeoutMs ?? 2_000,
  });
  const spanProcessor = new BatchSpanProcessor(traceExporter, {
    maxQueueSize: configuration.maximumQueueSize ?? 2_048,
    maxExportBatchSize: 256,
    scheduledDelayMillis: configuration.exportIntervalMs ?? 2_000,
    exportTimeoutMillis: configuration.exportTimeoutMs ?? 2_000,
  });
  const tracerProvider = new NodeTracerProvider({ resource, spanProcessors: [spanProcessor] });
  tracerProvider.register();

  const metricExporter = new OTLPMetricExporter({
    url: otlpUrl(configuration.endpoint, "metrics"),
    ...(configuration.headers === undefined ? {} : { headers: { ...configuration.headers } }),
    timeoutMillis: configuration.exportTimeoutMs ?? 2_000,
  });
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: configuration.exportIntervalMs ?? 5_000,
    exportTimeoutMillis: configuration.exportTimeoutMs ?? 2_000,
  });
  const meterProvider = new MeterProvider({ resource, readers: [metricReader] });
  metrics.setGlobalMeterProvider(meterProvider);

  return {
    shutdown: async () => {
      await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
};

type DeliveryTelemetryEnvironment = Readonly<Record<string, string | undefined>>;

let processObserver: DeliveryExecutionObserver | undefined;
let processRuntime: { readonly shutdown: () => Promise<void> } | undefined;

const runtimeEnvironment = (
  value: string | undefined,
): "production" | "staging" | "development" | "test" | "other" => {
  const normalized = value?.toLocaleLowerCase("en");
  if (
    normalized === "production" ||
    normalized === "staging" ||
    normalized === "development" ||
    normalized === "test"
  )
    return normalized;
  return "other";
};

const validatedEndpoint = (value: string): string => {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")
    throw new Error("SARATHI_OTLP_ENDPOINT must use HTTP or HTTPS.");
  return endpoint.toString().replace(/\/$/, "");
};

export const deliveryExecutionObserverFromEnvironment = (
  environment: DeliveryTelemetryEnvironment,
): DeliveryExecutionObserver => {
  if (processObserver !== undefined) return processObserver;
  const structuredLog = (event: Readonly<Record<string, unknown>>): void => {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  };
  const observer = createOpenTelemetryDeliveryExecutionObserver({ structuredLog });
  processObserver = observer;
  const endpoint = environment.SARATHI_OTLP_ENDPOINT?.trim();
  if (endpoint === undefined || endpoint === "") return observer;
  try {
    const authorization = environment.SARATHI_OTLP_AUTHORIZATION?.trim();
    processRuntime = startDeliveryOpenTelemetryRuntime({
      endpoint: validatedEndpoint(endpoint),
      ...(authorization === undefined || authorization === ""
        ? {}
        : { headers: { Authorization: authorization } }),
      ...(environment.RAILWAY_GIT_COMMIT_SHA === undefined
        ? {}
        : { serviceVersion: environment.RAILWAY_GIT_COMMIT_SHA }),
      ...(environment.RAILWAY_DEPLOYMENT_ID === undefined
        ? {}
        : { deploymentId: environment.RAILWAY_DEPLOYMENT_ID }),
      environment: runtimeEnvironment(environment.RAILWAY_ENVIRONMENT_NAME ?? environment.NODE_ENV),
    });
    process.once("beforeExit", () => {
      void shutdownDeliveryOpenTelemetryRuntime();
    });
  } catch {
    structuredLog({
      event: "delivery_telemetry_runtime",
      outcome: "failed",
      failure_class: "telemetry_overhead",
    });
  }
  return observer;
};

const shutdownDeliveryOpenTelemetryRuntime = async (): Promise<void> => {
  await processRuntime?.shutdown();
  processRuntime = undefined;
  processObserver = undefined;
};

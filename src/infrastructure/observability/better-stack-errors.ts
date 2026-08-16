import * as Sentry from "@sentry/bun";
import {
  deliveryExecutionFailureClasses,
  deliveryExecutionStages,
} from "../../modules/delivery-execution-observability/index.ts";

type SafeDeliveryError = {
  readonly code: string;
  readonly stage: string;
  readonly failureClass: string;
  readonly deploymentId?: string | undefined;
  readonly elapsedMs?: number | undefined;
};

type SafeBetterStackErrorEvent = {
  readonly message: string;
  readonly level: "error";
  readonly tags: {
    readonly code: string;
    readonly stage: string;
    readonly failure_class: string;
    readonly deployment_id?: string;
  };
  readonly extra?: { readonly elapsed_ms: number };
};

const boundedCode = (value: string, fallback: string): string =>
  value.length > 0 && value.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(value) ? value : fallback;

const safeErrorCodes = new Set([
  "SARATHI-CLI-RUNTIME-COMPOSITION",
  "SARATHI-CONTROLLED-ERROR-TEST",
  "SARATHI-REPORT-DEADLINE",
]);
const safeStages = new Set<string>(deliveryExecutionStages);
const safeFailureClasses = new Set<string>(deliveryExecutionFailureClasses);
const boundedEnum = (value: string, allowed: ReadonlySet<string>, fallback: string): string =>
  allowed.has(value) ? value : fallback;

export const safeBetterStackErrorEvent = (input: SafeDeliveryError): SafeBetterStackErrorEvent => ({
  message: boundedEnum(input.code, safeErrorCodes, "SARATHI-SAFE-ERROR"),
  level: "error",
  tags: {
    code: boundedEnum(input.code, safeErrorCodes, "SARATHI-SAFE-ERROR"),
    stage: boundedEnum(input.stage, safeStages, "other"),
    failure_class: boundedEnum(input.failureClass, safeFailureClasses, "other"),
    ...(input.deploymentId === undefined
      ? {}
      : { deployment_id: boundedCode(input.deploymentId, "other") }),
  },
  ...(input.elapsedMs === undefined || !Number.isFinite(input.elapsedMs)
    ? {}
    : { extra: { elapsed_ms: Math.max(0, input.elapsedMs) } }),
});

const validatedBetterStackDsn = (value: string): string => {
  const dsn = new URL(value);
  if (dsn.protocol !== "https:" || !dsn.hostname.endsWith("betterstack.com"))
    throw new Error("SARATHI_ERRORS_DSN must be a Better Stack HTTPS endpoint.");
  return dsn.toString();
};

let initialized = false;

export const createBetterStackSafeErrorCapture = (
  environment: Readonly<Record<string, string | undefined>>,
): ((input: SafeDeliveryError) => void) | undefined => {
  const dsn = environment.SARATHI_ERRORS_DSN?.trim();
  if (dsn === undefined || dsn === "") return undefined;
  try {
    if (!initialized) {
      Sentry.init({
        dsn: validatedBetterStackDsn(dsn),
        sendDefaultPii: false,
        defaultIntegrations: false,
        integrations: [],
        tracesSampleRate: 0,
        sampleRate: 1,
        attachStacktrace: false,
        maxBreadcrumbs: 0,
        beforeSend: (event) => {
          const safe = safeBetterStackErrorEvent({
            code: typeof event.tags?.code === "string" ? event.tags.code : "SARATHI-SAFE-ERROR",
            stage: typeof event.tags?.stage === "string" ? event.tags.stage : "other",
            failureClass:
              typeof event.tags?.failure_class === "string" ? event.tags.failure_class : "other",
            ...(typeof event.tags?.deployment_id === "string"
              ? { deploymentId: event.tags.deployment_id }
              : {}),
            ...(typeof event.extra?.elapsed_ms === "number"
              ? { elapsedMs: event.extra.elapsed_ms }
              : {}),
          });
          return {
            type: undefined,
            ...(event.event_id === undefined ? {} : { event_id: event.event_id }),
            ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
            platform: "javascript",
            ...safe,
          };
        },
      });
      initialized = true;
    }
  } catch {
    return undefined;
  }
  return (input) => {
    try {
      const safe = safeBetterStackErrorEvent(input);
      Sentry.withScope((scope) => {
        scope.clear();
        for (const [key, value] of Object.entries(safe.tags)) scope.setTag(key, value);
        if (safe.extra !== undefined) scope.setExtra("elapsed_ms", safe.extra.elapsed_ms);
        Sentry.captureMessage(safe.message, "error");
      });
    } catch {
      // Better Stack Errors is asynchronous and explicitly fail-open.
    }
  };
};

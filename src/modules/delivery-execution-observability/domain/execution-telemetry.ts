export const deliveryExecutionStages = [
  "delivery.report",
  "teams.ingress",
  "cli.ingress",
  "authorization.resolve",
  "question.plan",
  "product.resolve",
  "query.decompose",
  "period.census",
  "source.retrieve",
  "database.wait",
  "database.query",
  "retrieval.fuse",
  "domain.rerank",
  "parent.expand",
  "episode.consolidate",
  "lifecycle.classify",
  "completion.assess",
  "envelope.build",
  "provider.generate",
  "composition.validate",
  "teams.deliver",
  "cli.deliver",
  "scheduler.execute",
  "synchronization.execute",
] as const;

export type DeliveryExecutionStage = (typeof deliveryExecutionStages)[number];

export const deliveryExecutionOutcomes = ["success", "failed", "cancelled", "timeout"] as const;
export type DeliveryExecutionOutcome = (typeof deliveryExecutionOutcomes)[number];

export const deliveryExecutionFailureClasses = [
  "none",
  "internal_deadline_exhaustion",
  "database_pool_starvation",
  "slow_query",
  "candidate_expansion",
  "sequential_budget_multiplication",
  "scheduler_contention",
  "cancellation_not_propagated",
  "provider_rejection",
  "provider_timeout",
  "provider_cancelled",
  "provider_billing",
  "provider_rate_limit",
  "provider_failure",
  "envelope_size_explosion",
  "delivery_transport_timeout",
  "telemetry_overhead",
  "other",
] as const;

export type DeliveryExecutionFailureClass = (typeof deliveryExecutionFailureClasses)[number];

export const deliveryExecutionMetricNames = [
  "delivery.stage.duration",
  "delivery.report.outcome",
  "delivery.deadline.exhaustion",
  "delivery.budget.remaining",
  "delivery.provider.duration",
  "delivery.provider.tokens",
  "delivery.provider.cost",
  "delivery.candidates.count",
  "delivery.episodes.count",
  "delivery.envelope.size",
  "delivery.database.pool_wait",
  "delivery.database.query_duration",
  "delivery.report.in_flight",
  "delivery.scheduler.overlap",
  "delivery.runtime.event_loop_delay",
  "delivery.runtime.heap_used",
  "delivery.runtime.gc_duration",
  "delivery.runtime.cpu_saturation",
  "delivery.telemetry.queue_dropped",
  "delivery.telemetry.export_failure",
] as const;

export type DeliveryExecutionMetricName = (typeof deliveryExecutionMetricNames)[number];

export type DeliveryExecutionAttributes = {
  readonly "service.name"?: "sarathi" | "sarathi-otel-collector" | undefined;
  readonly "service.version"?: string | undefined;
  readonly "deployment.id"?: string | undefined;
  readonly environment?: "production" | "staging" | "development" | "test" | "other" | undefined;
  readonly "response.product"?:
    | "operational_answer"
    | "period_delivery_brief"
    | "leadership_report"
    | "implementation_investigation"
    | "other"
    | undefined;
  readonly "response.mode"?: "fast" | "structured" | "deep_dive" | "other" | undefined;
  readonly "relevance.profile"?:
    | "legacy"
    | "semantic"
    | "reranked"
    | "expanded"
    | "other"
    | undefined;
  readonly "model.name"?: string | undefined;
  readonly "reasoning.effort"?: "low" | "medium" | "high" | "other" | undefined;
  readonly source?:
    | "jira"
    | "vault"
    | "github"
    | "teams"
    | "email"
    | "strategy"
    | "projection"
    | "knowledge"
    | "intent"
    | "other"
    | undefined;
  readonly operation?: string | undefined;
  readonly "timeout.ms"?: number | undefined;
  readonly "elapsed.ms"?: number | undefined;
  readonly "budget.remaining.ms"?: number | undefined;
  readonly "candidates.retrieved"?: number | undefined;
  readonly "candidates.unique"?: number | undefined;
  readonly "candidates.duplicates_removed"?: number | undefined;
  readonly "candidates.excluded"?: number | undefined;
  readonly "parent.expansion.ratio"?: number | undefined;
  readonly "episodes.count"?: number | undefined;
  readonly "episodes.merge_ratio"?: number | undefined;
  readonly "missing_facets.count"?: number | undefined;
  readonly "database.pool_wait.ms"?: number | undefined;
  readonly "database.query.ms"?: number | undefined;
  readonly "database.rows"?: number | undefined;
  readonly "database.waiting"?: number | undefined;
  readonly "queries.count"?: number | undefined;
  readonly "provider.status_class"?:
    | "success"
    | "402"
    | "429"
    | "5xx"
    | "timeout"
    | "cancelled"
    | "other"
    | undefined;
  readonly "provider.retry"?: number | undefined;
  readonly "cancellation.state"?:
    | "not_requested"
    | "requested"
    | "acknowledged"
    | "other"
    | undefined;
  readonly "tokens.input"?: number | undefined;
  readonly "tokens.output"?: number | undefined;
  readonly "tokens.reasoning"?: number | undefined;
  readonly "tokens.total"?: number | undefined;
  readonly "cost.estimated.usd"?: number | undefined;
  readonly "envelope.items"?: number | undefined;
  readonly "envelope.bytes"?: number | undefined;
  readonly "reports.in_flight"?: number | undefined;
  readonly "scheduler.overlap"?: boolean | undefined;
  readonly "runtime.event_loop_delay.ms"?: number | undefined;
  readonly "runtime.heap_used.bytes"?: number | undefined;
  readonly "runtime.gc.ms"?: number | undefined;
  readonly "runtime.cpu.saturation"?: number | undefined;
  readonly "telemetry.queue.depth"?: number | undefined;
  readonly "telemetry.queue.dropped"?: number | undefined;
  readonly "telemetry.export.failures"?: number | undefined;
};

export type DeliveryExecutionMetricLabels = {
  readonly stage?: DeliveryExecutionStage | "other" | undefined;
  readonly outcome?: DeliveryExecutionOutcome | "other" | undefined;
  readonly failure_class?: DeliveryExecutionFailureClass | undefined;
  readonly response_mode?: "fast" | "structured" | "deep_dive" | "other" | undefined;
  readonly response_product?:
    | "operational_answer"
    | "period_delivery_brief"
    | "leadership_report"
    | "implementation_investigation"
    | "other"
    | undefined;
  readonly source?:
    | "jira"
    | "vault"
    | "github"
    | "teams"
    | "email"
    | "strategy"
    | "projection"
    | "knowledge"
    | "intent"
    | "other"
    | undefined;
  readonly operation?: "read" | "write" | "compose" | "validate" | "deliver" | "other" | undefined;
  readonly provider_status_class?:
    | "success"
    | "402"
    | "429"
    | "5xx"
    | "timeout"
    | "cancelled"
    | "other"
    | undefined;
  readonly cancellation_state?:
    | "not_requested"
    | "requested"
    | "acknowledged"
    | "other"
    | undefined;
  readonly token_kind?: "input" | "output" | "reasoning" | "total" | "other" | undefined;
  readonly exhaustion_stage?: DeliveryExecutionStage | "other" | undefined;
  readonly environment?: "production" | "staging" | "development" | "test" | "other" | undefined;
  readonly overlap?: "yes" | "no" | "other" | undefined;
};

const attributeKeys = new Set<keyof DeliveryExecutionAttributes>([
  "service.name",
  "service.version",
  "deployment.id",
  "environment",
  "response.product",
  "response.mode",
  "relevance.profile",
  "model.name",
  "reasoning.effort",
  "source",
  "operation",
  "timeout.ms",
  "elapsed.ms",
  "budget.remaining.ms",
  "candidates.retrieved",
  "candidates.unique",
  "candidates.duplicates_removed",
  "candidates.excluded",
  "parent.expansion.ratio",
  "episodes.count",
  "episodes.merge_ratio",
  "missing_facets.count",
  "database.pool_wait.ms",
  "database.query.ms",
  "database.rows",
  "database.waiting",
  "queries.count",
  "provider.status_class",
  "provider.retry",
  "cancellation.state",
  "tokens.input",
  "tokens.output",
  "tokens.reasoning",
  "tokens.total",
  "cost.estimated.usd",
  "envelope.items",
  "envelope.bytes",
  "reports.in_flight",
  "scheduler.overlap",
  "runtime.event_loop_delay.ms",
  "runtime.heap_used.bytes",
  "runtime.gc.ms",
  "runtime.cpu.saturation",
  "telemetry.queue.depth",
  "telemetry.queue.dropped",
  "telemetry.export.failures",
]);

const metricLabelKeys = new Set<keyof DeliveryExecutionMetricLabels>([
  "stage",
  "outcome",
  "failure_class",
  "response_mode",
  "response_product",
  "source",
  "operation",
  "provider_status_class",
  "cancellation_state",
  "token_kind",
  "exhaustion_stage",
  "environment",
  "overlap",
]);

const boundedString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 160 && !/[\r\n]/.test(value);

const safeScalar = (value: unknown): value is string | number | boolean =>
  boundedString(value) ||
  (typeof value === "number" && Number.isFinite(value)) ||
  typeof value === "boolean";

export const sanitizeDeliveryExecutionAttributes = (
  attributes: Readonly<Record<string, unknown>>,
): DeliveryExecutionAttributes =>
  Object.fromEntries(
    Object.entries(attributes).filter(
      ([key, value]) =>
        attributeKeys.has(key as keyof DeliveryExecutionAttributes) && safeScalar(value),
    ),
  ) as DeliveryExecutionAttributes;

const boundedLabelValues: Readonly<
  Record<keyof DeliveryExecutionMetricLabels, ReadonlySet<string>>
> = {
  stage: new Set([...deliveryExecutionStages, "other"]),
  outcome: new Set([...deliveryExecutionOutcomes, "other"]),
  failure_class: new Set(deliveryExecutionFailureClasses),
  response_mode: new Set(["fast", "structured", "deep_dive", "other"]),
  response_product: new Set([
    "operational_answer",
    "period_delivery_brief",
    "leadership_report",
    "implementation_investigation",
    "other",
  ]),
  source: new Set([
    "jira",
    "vault",
    "github",
    "teams",
    "email",
    "strategy",
    "projection",
    "knowledge",
    "intent",
    "other",
  ]),
  operation: new Set(["read", "write", "compose", "validate", "deliver", "other"]),
  provider_status_class: new Set(["success", "402", "429", "5xx", "timeout", "cancelled", "other"]),
  cancellation_state: new Set(["not_requested", "requested", "acknowledged", "other"]),
  token_kind: new Set(["input", "output", "reasoning", "total", "other"]),
  exhaustion_stage: new Set([...deliveryExecutionStages, "other"]),
  environment: new Set(["production", "staging", "development", "test", "other"]),
  overlap: new Set(["yes", "no", "other"]),
};

export const sanitizeDeliveryExecutionMetricLabels = (
  labels: Readonly<Record<string, unknown>>,
): DeliveryExecutionMetricLabels => {
  const bounded: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (!metricLabelKeys.has(key as keyof DeliveryExecutionMetricLabels)) continue;
    const allowed = boundedLabelValues[key as keyof DeliveryExecutionMetricLabels];
    bounded[key] = typeof value === "string" && allowed.has(value) ? value : "other";
  }
  return bounded as DeliveryExecutionMetricLabels;
};

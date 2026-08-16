# ADR 0013: Delivery Execution Observability And Absolute Deadline Control

## Status

Accepted for incremental implementation on 2026-08-16.

## Context

A delivery report can exhaust its declared total budget before provider composition, but the existing diagnostics identify only ingress and provider outcomes. Independent stage timeouts, database waiting, retrieval expansion, scheduler overlap, envelope growth, and cancellation behavior are therefore not attributable. Raising the outer timeout would hide the execution shape and keep abandoned work consuming capacity.

The capability crosses delivery application workflows, database and provider ports, hosted and CLI ingress, scheduler execution, runtime resources, deployment, and incident operations. It also carries a strict privacy boundary: telemetry must explain execution without questions, answers, prompts, source content, people, source-native identifiers, private URLs, or private configuration.

## Decision

Add `delivery-execution-observability` as a vendor-neutral platform capability. Its public contract owns the safe stage, outcome, failure, measurement, and bounded-label vocabulary plus one `DeliveryExecutionContext` containing an opaque execution identity, an absolute deadline, cooperative cancellation, and span lineage. Delivery and scheduling application code depends only on this contract.

Create one `delivery.report` root trace for each report and explicit child spans for ingress, authorization, planning, census, retrieval/database work, fusion/reranking, parent expansion, episode/lifecycle/completion work, envelope construction, provider composition, validation, and delivery. Scheduler and synchronization runs are separate roots. Correlate overlap through bounded resource and database measurements, never trace parentage or identifier-valued metric labels.

Propagate the same absolute deadline and cancellation signal through every internal port. A stage receives only the remaining total budget and must preserve a declared reserve for required downstream work. Database and provider adapters stop cooperatively when cancelled, and provider composition is forbidden after expiry.

Treat the declared source allocation as one phase deadline shared by initial retrieval and report enrichment. Hybrid PostgreSQL retrieval selects a bounded exact, full-text, or vector candidate set before applying the authorized passage and parent-context join. Expanded relevance attaches parent context in that query rather than repeating the complete hybrid search. Period enrichment and model-envelope inputs are independently bounded by material capability coverage. These bounds preserve exhaustive period census as the completeness authority; semantic enrichment remains supporting context and cannot add delivery candidates.

Export structured JSON and OpenTelemetry at infrastructure edges through a bounded asynchronous fail-open queue. Prefer an OpenTelemetry Collector on Railway private networking for batching, retry, memory limiting, redaction, and sampling; direct OTLP/HTTP remains an explicitly configured fallback behind the same port if the collector cannot be operated proportionately. Keep failed and slow report traces; sample fast successes at a bounded rate.

Use OpenTelemetry as trace authority. Better Stack Errors receives only explicit safe errors with default PII and SDK performance tracing disabled. Keep AI SDK experimental telemetry disabled unless a permanent boundary test proves that model inputs, outputs, prompts, sources, and private identifiers cannot be exported.

## Alternatives Considered

- Increase the total timeout: rejected because it does not identify or bound the consuming stage, stop abandoned work, or protect transport alignment.
- Emit ad-hoc stage logs from the delivery workflow: rejected because it lacks parentage, consistent deadlines, metric cardinality controls, exporter health, and a reusable privacy boundary.
- Couple domain code directly to OpenTelemetry or Better Stack SDKs: rejected because provider/runtime concerns would enter delivery semantics and make safe testing harder.
- Enable AI SDK experimental telemetry: rejected until its exported payload is proven compatible with the no-content telemetry boundary.
- Make the collector synchronous: rejected because telemetry cannot be a report dependency.

## Consequences

### Positive

- Slow and failed reports become attributable by stage, remaining budget, database wait, candidate growth, resource pressure, and provider classification.
- One absolute deadline prevents sequential timeout multiplication and gives cancellation one meaning across adapters.
- Privacy and metric-cardinality policy becomes testable at one boundary.
- Exporters and observability vendors can change without changing delivery application logic.

### Negative

- The runtime gains an asynchronous queue, trace context, resource sampling, and collector operational surface.
- Database cancellation and pool-wait measurement require adapter-specific work while remaining hidden behind public ports.
- High-fidelity failed/slow traces have storage and ingestion cost, requiring bounded sampling and retention.

## Acceptance

Acceptance requires a trace waterfall that explains the prior failure class, fault injection for every material stage, cancellation proof for database and provider work, privacy/cardinality gates, negligible bounded telemetry overhead, successful receipt in the production telemetry and error backends, active health/readiness monitors and exercised alerts, and a frozen-snapshot production CLI report within its unchanged declared budget. Deployment, health, telemetry receipt, CLI output, Teams routing, and human acceptance remain separate evidence.

## References

- [AI Delivery Assistant Intelligence](../../specs/005-knowledge-layer/spec.md)
- [Implementation Plan](../../specs/005-knowledge-layer/plan.md)
- [Evidence-First Period Delivery Reporting](../../specs/005-knowledge-layer/period-delivery-reporting.md)
- [Delivery Response Modes](../product/delivery-response-modes.md)
- [Module Boundaries](../architecture/module-boundaries.md)

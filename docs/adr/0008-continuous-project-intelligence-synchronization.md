# ADR 0008: Continuous Project Intelligence Synchronization

## Status

Accepted for implementation.

## Context

The existing knowledge layer synchronizes configured Jira and knowledge-root
content, while repository and collaboration sources are read primarily at query
time. This produces correct bounded demonstrations but cannot reliably answer
quarterly, weekly, daily, trend, ownership-transition, recurring-problem, or
wait-duration questions when source reads are slow, shallow, or temporally
inconsistent.

The system already owns PostgreSQL, pgvector, Drizzle migrations, versioned source
records, passages, embeddings, checkpoints, deletion reconciliation, delivery
projections, source adapters, and policy enforcement. Introducing another search,
graph, queue, or orchestration product would add a second operational boundary
before the existing stack is exhausted.

## Decision

Use one continuous synchronization lifecycle for configured Jira, versioned
knowledge roots, source-code repositories, and collaboration channels.

- Source events trigger low-latency changed-item ingestion where supported.
- An hourly checkpointed reconciliation is the correctness and repair path.
- PostgreSQL stores idempotent event deliveries, source versions, active passages,
  embeddings, delivery projections, tombstones, subscription state, leases, and
  checkpoints.
- Source-code repositories gain a persistent default-branch code and activity
  projection with changed-file indexing; the live API remains the authority for
  current verification.
- Collaboration channels gain a configurable historical bootstrap and continuous
  message/thread projection with edit and deletion reconciliation.
- Jira wait duration is derived from changelog status intervals.
- Response depth is explicit: fast operational answers retain a ten-second target,
  while requested structured briefs and deep dives optimize completeness over the
  fast-answer latency budget.

Implement deterministic synchronization and query workflows with the existing
Effect application services and PostgreSQL state. Do not introduce LangGraph now.
LangGraph or another durable agent runtime may be reconsidered only for measured
long-running, model-directed workflows needing branching, pause/resume, human
intervention, and replay that the typed application workflow cannot support
cleanly.

## Consequences

### Positive

- Cross-source answers operate on one temporally comparable local projection.
- Event latency and reconciliation correctness are separate and observable.
- Current code discovery is fast while exact answers can still verify live state.
- Weekly, quarterly, daily, wait-duration, and recurring-pattern queries share the
  same canonical records instead of issuing broad live fan-out reads.
- The public runtime remains provider- and workspace-neutral.

### Negative

- Repository and collaboration bodies now carry storage, deletion, retention,
  backup, embedding-cost, and policy obligations.
- Change-notification subscriptions require renewal and repair monitoring.
- Hourly reconciliation creates bounded source API and embedding load.
- Historical backfills need private per-workspace retention and scope decisions.

## Alternatives Considered

- **Live retrieval only**: lower storage responsibility, but cannot provide stable
  temporal joins, predictable latency, deletion history, or reliable recurrence.
- **Hourly polling only**: simpler, but unnecessarily delays common updates and
  increases repeated enumeration. Retained as the repair path, not sole trigger.
- **Events only**: low latency, but webhooks and subscriptions can be duplicated,
  delayed, expire, omit oversized deliveries, or be misconfigured.
- **LangGraph for every workflow**: supplies durable agent graphs and human
  interrupts, but duplicates current checkpoint/workflow responsibilities without
  a present model-directed orchestration requirement.
- **Separate graph/vector/queue services**: may scale individual concerns, but add
  consistency and operating boundaries before PostgreSQL limits are demonstrated.

## References

- [Continuous Synchronization Sub-Spec](../../specs/005-knowledge-layer/continuous-source-synchronization.md)
- [ADR 0006](./0006-postgres-knowledge-retrieval-stack.md)
- [Delivery Intelligence Redesign](../../specs/005-knowledge-layer/delivery-intelligence.md)


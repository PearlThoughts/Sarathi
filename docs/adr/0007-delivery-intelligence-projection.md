# ADR 0007: Delivery Intelligence as the Primary Project Model

## Status

Accepted for the existing production-pilot child capability.

## Context

Sarathi must answer the operating questions normally directed to a Delivery Manager or Project Manager: project scope, requirements, ownership, capacity, dependencies, blockers, sprint commitments, delivered outcomes, risks, recurring problems, decisions, next actions, budget for authorized users, and current activity.

The original knowledge design stores source items, immutable versions, passages, ACL metadata, embeddings, and checkpoints. That is necessary for unstructured retrieval, provenance, citations, edits, and deletions, but semantic passages do not provide stable project identity, typed relationships, lifecycle state, aggregation, conflict detection, or predictable answers to delivery questions.

An interim design introduced a `delivery-activity` module and time-oriented question views. Daily and sprint reporting are required, but organizing the bounded context around activity or reporting periods would make ownership, requirements, scope, dependencies, and capacity secondary concepts.

This decision affects domain boundaries, persistence, synchronization, query planning, source adapters, Teams composition, CLI operations, authorization, and production migration.

## Decision

Make `delivery-intelligence` the primary bounded context for project operating knowledge. Keep `knowledge-layer` as a supporting bounded context for versioned documents, passages, search projections, citations, checkpoints, and deletion reconciliation.

### Domain model

The delivery model contains:

- **objects**: projects, people, teams, modules, requirements, milestones, sprints, work items, deliverables, risks, decisions, and configured extensions;
- **relations**: contains, owns, assigned-to, depends-on, blocks, contributes-to, implements, affects, duplicates, and supersedes;
- **observations**: immutable normalized source events or state observations;
- **claims**: attributed statements about a subject and predicate;
- **metrics**: typed measurements such as estimate, capacity, allocation, throughput, budget, cost, rate, and burn;
- **conflicts**: derived groups of incompatible active claims;
- **knowledge references**: links to authorized source versions and passages without duplicating bodies.

All records are workspace-scoped, source-linked, sensitivity-labelled, reconcilable, and optionally qualified by occurrence, observation, effective, sprint, or milestone fields.

### Time

Time is an optional dimension on records and query predicates. Daily activity, current week, current sprint, previous sprint, history, and recurrence are views over the same objects, relations, observations, claims, and metrics. No time-centric aggregate or event-sourcing rewrite owns the delivery model.

### Query planning

Questions compile into a validated `DeliveryQueryPlan` built from a whitelisted grammar: selectors, predicates, typed relation traversals, grouping, measures, ordering, limits, required sources, and an optional time boundary. The executor rejects arbitrary SQL, arbitrary connector queries, unknown operators, excessive traversal, and unbounded result volume.

High-frequency questions may use deterministic planning. Broader language may use a schema-constrained model planner, but the application validates the resulting plan before any source call. A new wording reuses the grammar and does not justify a new table or adapter.

### Source authority

- Jira and configured Vault roots are synchronized into versioned knowledge records and rebuildable delivery projections.
- GitHub remains live; repository bodies and embeddings are not persisted.
- Connected Teams and scoped project-email records may be read or synchronized without per-record approval.
- A source-native event is trusted as evidence that the event occurred. Statements inside sources are claims, not automatically resolved truth.
- Conflicting active claims remain attributable and are disclosed with citations. Authority and recency rank but do not silently erase them.

### Visibility and finance

Mapped members may query connected non-financial data in their workspace. Original source audience metadata remains provenance, while the workspace capability policy determines serving visibility. Cross-workspace access remains denied.

Finance measurements and finance-classified content use separate confidential storage and repository operations. General delivery objects cannot contain finance-like attributes. Budget answers fail closed without an explicit finance entitlement.

### Persistence and migration

PostgreSQL remains the only durable datastore. Drizzle schema definitions and generated migrations own the additive delivery tables and indexes. Existing audit and knowledge tables remain intact.

Unreleased intermediate delivery migrations on the feature branch may be regenerated into one coherent migration before deployment. Delivery projections are rebuildable from source records; application rollback stops the synchronizer and leaves additive tables unused.

## Consequences

### Positive

- The system represents the Delivery Manager question space directly instead of treating every answer as semantic document retrieval.
- Ownership, dependency, blocker, scope, sprint, risk, capacity, recurrence, and conflict queries share one model and one authorization path.
- Time-based reports remain supported without distorting non-temporal concepts.
- Knowledge retrieval, citations, deletion reconciliation, and pgvector remain useful without owning product semantics.
- Source adapters normalize into stable contracts while frameworks and SDKs remain outside domain/application code.
- Finance can be tightened independently from general workspace visibility.

### Negative

- The refactor replaces unreleased `delivery-activity` contracts and intermediate migrations rather than preserving compatibility.
- Source reconciliation must coordinate knowledge and delivery projections transactionally.
- A generic but safe query grammar requires stronger validation and architecture tests than a handful of hard-coded intents.
- Workspace-wide non-financial visibility is broader than source-audience-preserving access and must remain explicit in private configuration and acceptance tests.

## Alternatives Considered

- **Keep knowledge retrieval as the primary model**: rejected because passages cannot reliably express joins, lifecycle state, dependency direction, aggregation, capacity, or conflict.
- **Keep `delivery-activity` as the bounded context**: rejected because time-based reporting is only one capability and would subordinate scope, ownership, requirements, and relationships.
- **Create a bespoke handler per question**: rejected because wording variants would duplicate authorization, source access, storage, and ranking logic.
- **Adopt a graph database**: rejected because PostgreSQL can enforce the current relation and traversal requirements without another operational/security boundary.
- **Persist the GitHub codebase**: rejected because live GitHub is the current authority and duplicated code creates avoidable deletion, ACL, and freshness obligations.
- **Use unrestricted model-generated queries**: rejected because it would bypass bounded operators, source scopes, predictable cost, and authorization review.

## Rollback

Deploy the prior application revision and stop delivery synchronization. Leave additive delivery tables unused. Restore PostgreSQL only through the verified production backup path; do not drop or replace existing audit or knowledge tables during application rollback.

## References

- [AI Delivery Assistant Intelligence](../../specs/005-knowledge-layer/spec.md)
- [Delivery Intelligence Redesign](../../specs/005-knowledge-layer/delivery-intelligence.md)
- [ADR 0006: PostgreSQL Knowledge Retrieval Stack](./0006-postgres-knowledge-retrieval-stack.md)
- [Module Boundaries](../architecture/module-boundaries.md)

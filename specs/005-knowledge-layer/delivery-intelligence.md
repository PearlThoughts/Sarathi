# Sub-Spec: Delivery Intelligence Redesign

## Purpose

Refactor the existing knowledge-led implementation into a reusable delivery-intelligence capability. The redesign organizes project data for the full Delivery Manager question space while retaining the knowledge layer as the unstructured-content and provenance subsystem.

This sub-spec changes the existing child capability. It does not create another product plan, epic, convoy, bot, or deployment.

## Ownership Boundaries

- `delivery-intelligence` owns delivery objects, relations, observations, claims, metrics, conflicts, safe query planning, result fusion, and concise reporting.
- `knowledge-layer` owns versioned documents, passages, embeddings, full-text/vector retrieval, citations, source reconciliation, and checkpoints.
- `boundary-policy` owns workspace, actor, sensitivity, finance, destination, and model-egress authorization.
- Infrastructure owns PostgreSQL/Drizzle, Jira, Vault, GitHub, Graph, email, model, embedding, clocks, and environment configuration.
- Teams mention handling consumes the delivery-intelligence public port and does not own project-query semantics.

## Model

The reusable core is:

```text
DeliveryObject <-> DeliveryRelation
      |                 |
      +------ DeliveryObservation
      +------ DeliveryClaim -> derived DeliveryConflict
      +------ DeliveryMetric
      +------ KnowledgeReference
```

Every persisted record has workspace, source, stable external identity, sensitivity, provenance, active/deleted state, and optional observation/effective timestamps. Time fields qualify a record; they do not define the aggregate or module.

Financial measurements and finance-classified content are isolated from shared delivery attributes. General workspace members cannot materialize them.

## Query Model

A `DeliveryQuestionPlanner` compiles supported language into a `DeliveryQueryPlan`. The plan contains only whitelisted operations:

- select object, relation, observation, claim, metric, conflict, knowledge, or live GitHub results;
- filter by configured project, object kind, lifecycle state, owner, component, sprint, sensitivity, or optional time window;
- traverse configured relation kinds in a declared direction and bounded depth;
- group, count, rank, or summarize using declared measures;
- require, prefer, or omit connected sources;
- cap result volume and model-visible content.

Common questions become plans over this grammar. Daily activity is one plan with an optional workspace-local day window. Dependency waits, stuck work, last-sprint delivery, current-week work, top risks, recurring issues, scope, ownership, capacity, and requirements use the same model.

Unrecognized wording compiles to a bounded generic plan over structured delivery records and authorized hybrid Jira/Vault retrieval. A model may synthesize only the filtered result envelope; application code still validates every selector, predicate, traversal, measure, limit, and citation before execution or delivery.

## Source Projection

- Jira projects objects, hierarchy, ownership, status, sprint, estimates, dependencies, blockers, risk indicators, changes, descriptions, and comments.
- Vault projects durable requirements, decisions, risks, milestones, owners, policies, and unstructured passages from configured project roots.
- GitHub remains live for repository truth. Normalized results may enter a response, but repository bodies and embeddings are not stored.
- Teams and scoped project email provide observations and attributed claims from all records visible through the configured project connector. There is no per-message approval field.
- Conflicting claims remain active together until their source records converge or are deleted.

## Reporting

The executor runs independent required reads concurrently, applies authorization before materialization, deduplicates cross-source results, evaluates conflicts and completeness, and returns a bounded `DeliveryResult`. Deterministic renderers produce a short acknowledgement or situation paraphrase followed by concise emoji-led, bold-labelled bullets. A numbered next action appears only when a connected source supports it with a resolvable citation. Native Teams mentions identify a person only when that cited action safely resolves the person. Tables and richer layouts are reserved for comparisons that materially benefit from them and are supported by Teams; optional model synthesis receives only the bounded result.

Supported fast-path queries must complete through Teams in less than ten seconds. Latency is a query acceptance property, not the domain boundary.

### Live evaluation contract

The 2026-07-22 delivery-manager matrix showed that latency and visual formatting can pass while the answer remains unsafe. Query execution therefore also enforces:

- a named project/module/item boundary before unrelated records may enter synthesis;
- exact selector and intent compatibility for every returned result;
- required-source coverage for questions that explicitly depend on GitHub or compare named systems;
- source-role exclusion for assistant prompts, bot replies, test-only messages, and malformed mention attempts;
- first-class review-queue and conflict intents rather than generic nearest-message retrieval;
- answer completeness for the requested fields, with a bounded coverage failure instead of invented ownership, blockers, mitigation, recurrence, or next actions;
- conflict disclosure only when attributed claims about the same subject and predicate come from at least two distinct sources;
- capacity answers only from explicit availability, allocation, leave, or bandwidth signals rather than generic activity or assignee changes;
- model composition and deterministic recommendations may not manufacture a next action when no cited action evidence exists;
- delegation only when a source-resolved Teams identity belongs to an action that is related to the material answer.

## Migration

The redesign is additive relative to production. Existing audit and knowledge tables remain intact. Unreleased delivery-projection migrations on the feature branch may be regenerated before deployment so the final Drizzle journal contains one coherent delivery-intelligence schema rather than preserving abandoned intermediate tables.

Rollback uses the prior application revision and stops the new synchronizer. Additive tables may remain unused. Production restore uses the verified PostgreSQL backup path only.

## Exit Criteria

- Architecture fitness prevents delivery domain/application code from importing infrastructure or knowledge-layer internals.
- Drizzle migration tests prove existing audit and knowledge tables survive and the delivery schema is reversible/rebuildable.
- Reconciliation tests prove deduplication, edits, deletions, scope removal, and conflict convergence.
- Authorization tests prove no connector call or content materialization for an unmapped actor, wrong workspace, disallowed source, excessive sensitivity, or non-finance actor requesting finance.
- Query tests prove scope, ownership, dependencies, blockers, sprint delivery, current work, risks, recurring issues, requirements, decisions, and activity without a table or adapter per wording.
- Citation and log tests prove resolvable links and no private bodies or credentials in logs.
- Exact-branch CI, runtime smoke, governed merge, verified backup, production migration, deployment, bounded synchronization, real answers, sub-ten-second Teams reporting, and rollback evidence are complete.

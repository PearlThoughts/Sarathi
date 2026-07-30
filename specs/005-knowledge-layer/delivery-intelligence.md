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
- GitHub provides both a continuously synchronized, commit-pinned projection and live verification when freshness or exactness requires it. Sarathi stores authorized file/symbol passages and delivery metadata, but does not replicate every branch or raw repository revision. [Code-Derived Delivery Intelligence](./code-delivery-intelligence.md) defines the richer delivery-aligned artifact model and clearly separates current implementation from proposed capability.
- Teams and scoped project email provide observations and attributed claims from all records visible through the configured project connector. A separate bounded Teams delivery-channel allowlist may declare standard, shared, and private scopes without widening the narrower ingress mapping; every read still requires workspace, actor, sensitivity, and explicit channel authorization. There is no per-message approval field.
- Conflicting claims remain active together until their source records converge or are deleted.

## Reporting

The executor runs independent required reads concurrently, applies authorization before materialization, deduplicates cross-source results, evaluates conflicts and completeness, and returns a bounded `DeliveryResult`. The request selects an `operational_answer`, `period_delivery_brief`, `leadership_report`, or `implementation_investigation`. User-visible answers lead with the requested delivery topics, place one feature or work item on each bullet, and move source links to a compact references footer. Successful reports do not append internal coverage, evidence, proof, confidence, or methodology prose.

For period reports, bounded means a declared source/time scope—not an arbitrary top-k truncation. The executor first builds an exhaustive `PeriodCensus`, then groups and ranks the accepted population for presentation. [Evidence-First Period Delivery Reporting](./period-delivery-reporting.md) defines the required change capsules, capability ledger, delivery chains, outcome assertions, coverage accounting, and gold-report evaluation.

Whole-team weekly work groups the result window by source-stable owner identity and shows one representative bullet per owner. A next action appears only when the question asks for one and a connected source supplies it. Native Teams mentions identify a person only when that action safely resolves the person. Optional model synthesis receives only the authorized result envelope.

Operational and structured answers remain bounded for runtime safety but have no artificial user-facing line-count or ten-second acceptance requirement. They may use the space needed to answer every requested field cleanly.

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
- finance-shaped Teams messages remain excluded at the adapter boundary even when their channel is otherwise allowlisted;
- canonical channel labels and routing topics provide project/module context for terse channel-local messages and prevent unrelated or inaccessible channels from contaminating every query;
- compound briefs allocate one bounded row to every requested decision field; missing fields remain visible instead of being displaced by a fixed three-line evidence budget;
- normalized lifecycle state ranks active Jira work above terminal history, and a historical-only current-status answer is explicitly partial;
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

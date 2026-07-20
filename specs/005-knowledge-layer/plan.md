# Implementation Plan: AI Delivery Assistant Intelligence

**Branch**: `feat/daily-activity-report` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

## 1. Execution Goal

Refactor the existing production-pilot child capability from a knowledge-led answer path into a reusable delivery-intelligence system. Complete the work through governed merge, non-destructive production migration, bounded connector synchronization, real Teams answers under ten seconds, confidentiality proof, and rollback evidence.

## 2. Technical Context

- Runtime: strict TypeScript on Bun for domain, application, CLI, and tests; existing Node 22 Teams edge.
- Composition: Effect-based application ports with pure domain rules.
- Storage: existing Railway PostgreSQL, pgvector, Drizzle ORM, generated/versioned migrations, and Drizzle migration journal.
- Providers: Vercel AI SDK abstractions with OpenRouter as the only production model and embedding provider; deterministic test adapters.
- Sources: synchronized Jira and Vault, live GitHub, bounded Graph reads for Teams and scoped project email.
- Retrieval: structured delivery queries first; exact/full-text/vector knowledge retrieval and GitHub live search as supporting operations.
- Verification: Vitest, Bun integration tests, architecture fitness, privacy scan, `bun run check`, runtime smoke, production acceptance, and rollback proof.

## 3. Constitution and Architecture Check

- Authorization before retrieval/tool/model egress: required and test-backed.
- One installed organization with isolated workspaces: preserved.
- Non-financial workspace sharing: explicit serving policy for mapped members; not per-record approval.
- Finance isolation: separate projection and entitlement; general queries fail closed.
- Domain-first dependency direction: `delivery-intelligence` does not import infrastructure or knowledge implementation details.
- Source authority: derived delivery state is rebuildable and never writes back in this capability.
- Time: optional record/query dimension; no time-centric root aggregate or event-sourcing rewrite.

## 4. Capability Ownership

```text
src/modules/delivery-intelligence/
  domain/       delivery objects, relations, observations, claims, metrics,
                conflicts, safe plan vocabulary, result contracts
  application/  question planning, query execution, fusion, completeness,
                conflict evaluation, concise composition
  ports/        projection repository, connected sources, live GitHub,
                optional model planner/composer
  index.ts      sole cross-capability public surface

src/modules/knowledge-layer/
  domain/       documents, versions, passages, authorization metadata,
                ranking and citations
  application/  ingestion, reconciliation, hybrid retrieval and cited context
  ports/        repository, source, embedding, live-search contracts

src/infrastructure/
  postgres/     Drizzle schema/migrations and repository implementations
  jira/         Jira anti-corruption and projection adapters
  vault/        Vault anti-corruption and projection adapters
  github/       live repository activity/search adapters
  graph/        connected Teams and scoped project-email adapters
  model/        Vercel AI SDK OpenRouter adapters

src/cli/commands/
  delivery-runtime.ts  ingestion, reconcile, query, status, rebuild
```

Teams mention handling consumes one `DeliveryAssistant` port. It does not classify delivery questions, calculate time windows, query connectors, or compose delivery reports itself.

## 5. Delivery Slices

### Slice A — Ratified Model and Architecture Fitness

1. Replace the recent-activity sub-spec with the delivery-intelligence redesign and update ADR 0007.
2. Add `delivery-intelligence` to the machine-readable architecture manifest and dependency fitness rules.
3. Define the domain model and validated query grammar with time as an optional constraint.
4. Add parity tests for the existing daily-report wording before removing `delivery-activity`.

### Slice B — Coherent Drizzle Schema and Migration

1. Replace unreleased intermediate delivery migrations with one generated delivery-intelligence migration.
2. Add source-linked delivery object, relation, observation, claim, metric, finance-metric, and ACL/provenance tables.
3. Keep knowledge source/item/version/passage/projection/checkpoint and all existing audit tables intact.
4. Add indexes and constraints for workspace, stable source identity, active reconciliation, relation traversal, conflict grouping, dedupe, and bounded time filters.
5. Prove upgrade, idempotence, existing-table preservation, failure behavior, and rollback/rebuild procedure.

### Slice C — Projection and Reconciliation

1. Move delivery projection contracts out of `knowledge-layer` into `delivery-intelligence`.
2. Reconcile knowledge and delivery projections transactionally from one source version without duplicating bodies.
3. Normalize Jira into objects, relations, observations, claims, and non-financial metrics over the configured project boundary.
4. Normalize Vault project metadata and claims while retaining heading passages in the knowledge subsystem.
5. Reconcile edits, deletions, scope changes, ACL changes, and conflict convergence.

### Slice D — Query Planning and Execution

1. Replace the view enum with a whitelisted composable plan: selectors, predicates, traversals, grouping, measures, ordering, limit, source needs, and optional time boundary.
2. Implement repository reads for ownership, dependencies, blockers, requirements, scope, current work, delivery, risks, decisions, capacity, recurring patterns, claims, and conflicts.
3. Add live GitHub operations only when the validated plan requires repository truth.
4. Add bounded Teams and project-email observations/claims without record approval fields.
5. Fuse structured, knowledge, and live results into a cited `DeliveryResult` with completeness and conflict metadata.

### Slice E — Product Composition and Durable Operations

1. Implement deterministic two- or three-line composition for common delivery reports.
2. Add schema-constrained OpenRouter planning/synthesis only for questions not handled deterministically.
3. Wire the single delivery-assistant port into Teams after identity and boundary authorization.
4. Add durable `delivery ingest|reconcile|query|status|rebuild` commands with privacy-safe summaries.
5. Remove evidence-led product copy and obsolete delivery-activity module/runtime configuration.

### Slice F — Governed Integration and Production Acceptance

1. Run focused tests after each slice and full `bun run check` plus runtime smoke on the exact final branch revision.
2. Update the existing Jira issue, self-review, open the governed PR, merge through GitHub, synchronize canonical main, and clean the worktree.
3. Verify OpenRouter-only secret configuration without printing the key.
4. Confirm backup/restore and application rollback, apply the additive migration, deploy the merged revision, and synchronize bounded Jira/Vault data.
5. Verify real Teams answers for project status, ownership/dependencies, blockers, previous sprint/current week, top risks, recurring issues, daily activity, and a GitHub implementation question.

## 6. Data and Migration Strategy

Drizzle schema definitions are authoritative for new tables. Because delivery migrations `0002` and `0003` have not been deployed and exist only on this feature branch, regenerate them into one coherent migration rather than carrying an abandoned intermediate design into production. The deployed knowledge migration and existing audit tables remain immutable sentinels.

Delivery projections reference their source and source version. Reconciliation writes the knowledge version, passages, delivery rows, ACLs, tombstones, and checkpoint in one transaction. A delivery rebuild truncates or deactivates only the rebuildable delivery projection inside a bounded workspace/source scope; it never deletes source documents, audit history, or GitHub content.

Finance uses separate confidential storage and repository operations. General delivery rows must reject finance-like attribute keys and finance metrics.

## 7. Query and Answer Strategy

A question becomes a validated plan. Deterministic classifiers cover high-frequency questions; a schema-constrained model planner may propose the same plan vocabulary for broader language. The executor authorizes the plan, runs independent reads concurrently, caps traversal depth and result volume, materializes content only after policy checks, then fuses results by stable identity and citation.

Time boundaries are optional predicates resolved from workspace configuration or Jira sprint metadata. They are used for daily, weekly, sprint, historical, and trend questions but do not affect ownership, scope, requirement, or dependency modeling when no time boundary is requested.

## 8. Test Strategy

- Domain: plan validation, relation direction, conflict grouping, dedupe keys, finance classification, time-boundary semantics, citation eligibility.
- Application: query planning, authorization ordering, completeness, partial sources, conflict disclosure, deterministic composition, model-envelope limits.
- Persistence: generated migration, existing-table preservation, constraints, transaction/checkpoint ordering, replay, edits, deletion, scope removal, rebuild.
- Sources: full configured Jira projection, Vault heading/metadata projection, live GitHub guards, Teams/email connected-scope guards, no connector call before authorization.
- Capability: equivalent wording produces equivalent plans; all Delivery Manager question families use the shared model; unsupported operators fail closed.
- Production: exact SHA, migration journal, safe counts/checksums, real citations, response latency, log scan, app rollback, and database recovery evidence.

## 9. Stop Conditions

Stop on migration drift, backup failure, unresolved architecture violation, incorrect source scope, arbitrary-plan execution, finance leakage, cross-workspace exposure, message/email body logging, missing citation resolution, provider-secret exposure, or real-answer latency/relevance regression.

## 10. Dependency and Completion Gates

`spec/ADR -> domain and architecture fitness -> coherent migration -> projection reconciliation -> safe query execution -> product composition/CLI -> focused tests -> exact-branch CI -> governed merge -> backup -> migration/deploy -> bounded sync -> real Teams answers -> rollback proof`.

Schema creation, mocked queries, readiness HTTP 200, deployment, ingestion counts, or one daily report do not independently complete the capability.

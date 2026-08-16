# Tasks: AI Delivery Assistant Intelligence

**Input**: [spec.md](./spec.md) and [plan.md](./plan.md)
**Execution Bead**: the private capability task

## Phase 1 — Specification and Migration Foundation

- [x] KLG-001 Bind the child capability to the existing private delivery tracker; create this scoped Spec Kit package and ADR 0006.
- [x] KLG-002 Add `drizzle.config.ts`, PostgreSQL schema modules, generated/versioned migration artifacts, and migration runner under `src/infrastructure/postgres/`.
- [x] KLG-003 Add the pgvector extension migration and canonical source/item/version/passage/ACL/projection/checkpoint tables without altering or replacing existing audit tables.
- [x] KLG-004 Add migration plan/status/apply verification and rollback-safe tests against the current production-table baseline.

## Phase 2 — Canonical Ingestion and Reconciliation

- [x] KLG-101 Define canonical evidence, version, passage, ACL, checkpoint, embedding, and ingestion contracts under `src/modules/knowledge-layer/`.
- [x] KLG-102 Implement transactionally safe ingestion, replay deduplication, edit versioning, deletion/tombstone reconciliation, and checkpoint advancement application services.
- [x] KLG-103 Implement connected Jira issue normalization in `src/infrastructure/jira/` using typed fields, description, and comments with provenance and resolvable citations.
- [x] KLG-104 Implement configured Vault Markdown normalization in `src/infrastructure/vault/` with heading-first passages, anchors, hashes, ACL, and deletion detection.
- [x] KLG-105 Implement the Vercel AI SDK embedding adapter plus deterministic test adapter and projection-model/dimension validation.

## Phase 3 — Retrieval, Fusion, and Answering

- [x] KLG-201 Implement metadata-first authorization filters and exact identifier lookup before passage body materialization.
- [x] KLG-202 Implement PostgreSQL full-text and pgvector search with independently inspectable ranks and filtered active versions.
- [x] KLG-203 Implement deterministic reciprocal-rank fusion, source authority/freshness ranking, and duplicate suppression.
- [x] KLG-204 Implement bounded GitHub live search/API retrieval in `src/infrastructure/github/` without storing repository bodies or embeddings.
- [x] KLG-205 Fuse connected Teams thread context, Jira/Vault indexed evidence, and GitHub live results into a single authorized envelope.
- [x] KLG-206 Implement AI SDK concise cited answer composition with normally two or three lines and resolvable citations for every material claim.

## Phase 4 — Durable Operations and Regression Coverage

- [x] KLG-301 Add `knowledge ingest|reconcile|query|status` to `src/cli/commands/knowledge-runtime.ts` and existing release CLI composition.
- [x] KLG-302 Add permanent migration, authorization, restricted/cross-workspace, dedupe, edit, deletion, checkpoint, citation, retrieval, fusion, provider, and log-redaction tests; update `tests/manifest.json` and `tests/TEST-INDEX.md`.
- [ ] KLG-303 Wire the capability into Teams mention composition/readiness and prove restart persistence plus same-thread response shape.
- [ ] KLG-304 Run focused tests after each slice, then final exact-branch `bun run check` and `bun run runtime:smoke`.

## Phase 5 — Governed Merge and Production Acceptance

- [ ] KLG-401 Resolve or create the correct Jira issue, inspect governance, self-review the complete diff, push, open the governed PR, merge through GitHub, and sync canonical `main`.
- [ ] KLG-402 Rotate the exposed OpenRouter key without printing it; confirm OpenRouter is the sole model and embedding provider.
- [ ] KLG-403 Confirm production backup/restore and rollback, apply the non-destructive migration, verify pgvector/journal/audit tables, and deploy the merged revision.
- [ ] KLG-404 Run bounded connected Jira/Vault ingestion and record only counts, checksums, checkpoints, source scope identifiers, and timing.
- [ ] KLG-405 Verify the Atlas Site Composer status question, delivery risks/next-action question, and one GitHub-required implementation question with concise resolvable citations.
- [ ] KLG-406 Prove duplicate suppression, pre-model permission filtering, restricted/cross-workspace exclusion, source edit/deletion reconciliation, privacy-safe logs, application rollback, and database recovery evidence.
- [ ] KLG-407 Update and close the private capability task only with merged PR/SHA, exact test evidence, live answer evidence, deployment/migration/rollback evidence; commit Dolt state and run `gt ready` after each completed task.

## Delivery Intelligence Redesign

- [x] KLG-501 Replace the recent-activity framing with the delivery-intelligence spec and ADR; record time as an optional record/query dimension.
- [x] KLG-502 Add the `delivery-intelligence` bounded context and architecture fitness rules; remove the obsolete `delivery-activity` boundary after parity tests pass.
- [x] KLG-503 Define delivery objects, relations, observations, claims, metrics, conflicts, results, and a whitelisted composable query plan.
- [x] KLG-504 Regenerate the unreleased intermediate delivery migrations into one coherent Drizzle migration while preserving deployed audit and knowledge tables.
- [x] KLG-505 Move delivery projection contracts out of `knowledge-layer` and reconcile source versions, knowledge, delivery rows, ACLs, tombstones, and checkpoints transactionally.
- [x] KLG-506 Project the configured Jira and Vault boundaries into reusable delivery objects, relations, observations, claims, and non-financial metrics.
- [x] KLG-507 Implement authorized repository queries for scope, requirements, ownership, dependencies, blockers, delivery, current work, risks, decisions, capacity, recurring patterns, claims, and conflicts.
- [x] KLG-508 Keep GitHub live and add connected Teams/project-email operations without per-record approval fields or unrelated mailbox access.
- [x] KLG-509 Add deterministic and schema-constrained question planning over one validated grammar; reject arbitrary query operators and unbounded traversal.
- [x] KLG-510 Fuse structured, knowledge, and live results with deduplication, completeness, conflict disclosure, citations, and finance isolation before model egress.
- [x] KLG-511 Wire a single delivery-assistant port into Teams and durable `delivery ingest|reconcile|query|status|rebuild` CLI operations.
- [x] KLG-512 Replace evidence-led user-facing identity with `AI Delivery Assistant` while retaining internal provenance controls.
- [x] KLG-513 Add permanent architecture, migration, authorization, deletion, deduplication, conflict, citation, query-family, log-redaction, and latency regression tests.
- [ ] KLG-514 Prove exact-branch CI, governed merge, backup, production migration/deployment, bounded synchronization, real Delivery Manager question coverage, sub-ten-second Teams reporting, and rollback.
- [x] KLG-515 Enforce source-role, entity-boundary, required-backend, answer-completeness, review-queue, conflict, and related-delegation rules derived from the 2026-07-22 ten-question live matrix.
- [x] KLG-516 Require explicit intent evidence, same-item claims from distinct sources for conflicts, capacity-specific signals, and cited next actions; disclose partial compound answers without generic recommendations.
- [x] KLG-517 Decouple the explicit Teams delivery-read allowlist from ingress mappings, support bounded declared standard/shared/private channels, and remove the ten-channel empty-result cliff without broadening actor or sensitivity authorization.
- [x] KLG-518 Add canonical Teams channel labels and bounded routing topics so terse channel-local updates retain project context and queries do not fan out to unrelated inaccessible scopes.
- [x] KLG-519 Render decision-ready compound delivery briefs with one bounded row per requested field and rank normalized active Jira lifecycle state ahead of terminal history.

## Continuous Project Intelligence Synchronization

- [x] KLG-520 Ratify the continuous synchronization sub-spec and ADR 0008; remove live-only and globally concise assumptions from the public contract.
- [x] KLG-521 Add framework-neutral event-delivery, subscription, lease, source cursor, freshness, lag, retry, and hourly reconciliation contracts to `knowledge-layer` ports and Drizzle schema.
- [x] KLG-522 Implement incremental Jira synchronization for project metadata, fields, board columns, sprints, issues, comments, changelog, relationships, and status wait intervals with bounded cursor overlap.
- [x] KLG-523 Implement immutable tree/blob delta synchronization for configured knowledge roots with rename/deletion reconciliation and unchanged-vector reuse.
- [x] KLG-524 Implement current default-branch repository bootstrap, symbol-aware code passages, activity history, verified push/merge changed-file indexing, deletion retirement, and live verification fallback.
- [x] KLG-525 Implement configured collaboration-history bootstrap, thread/reply passages, message version/edit/delete handling, change-notification renewal, and hourly repair reconciliation.
- [x] KLG-526 Add canonical entity/alias joins and comparable source/business timestamps across synchronized Jira, knowledge, repository, and collaboration projections.
- [x] KLG-527 Add explicit fast, structured-brief, and deep-dive response modes with independent completeness, citation, freshness, formatting, and latency acceptance.
- [x] KLG-528 Add permanent PostgreSQL connector tests for bootstrap, pagination, unchanged replay, changed-only embeddings, missed/duplicate/out-of-order events, expired subscriptions, deletion, scope removal, hourly convergence, and privacy-safe observability.
- [ ] KLG-529 Add durable `delivery sync backfill|events|reconcile|status` operations and production freshness acceptance without source bodies in logs.
- [ ] KLG-530 Evaluate an agent graph framework only after a production workflow satisfies ADR 0008's branching, durable pause/resume, human-intervention, replay, and measured-maintainability gate.
- [x] KLG-531 Add a privacy-safe batch evaluation runner over the production answer path with declared pass and human-usefulness thresholds; keep real project questions and ratings in the private overlay.

## Evidence-First Period Reporting

- [ ] KLG-532 Add permanent question-planning tests and implementation for arbitrary `last N days`, week, sprint, release, month, and quarter boundaries using workspace timezone and explicit inclusive/exclusive semantics.
- [ ] KLG-533 Propagate the selected response product and budget end to end; remove the fast-answer line and timeout constraints from structured briefs and leadership reports while preserving fast operational latency.
- [ ] KLG-534 Implement an exhaustive authorized `PeriodCensus` candidate operation with deterministic pagination, freshness, exclusions, duplicates, unmapped records, unavailable-source counts, coverage, and replay checksum; do not classify generic source updates as delivered.
- [ ] KLG-535 Implement PR-centered `ChangeCapsule` projection joining Jira intent, commits and changed paths/symbols, reviews/checks, releases/deployments/rollbacks/acceptance, contributors, citations, and missing stages.
- [ ] KLG-536 Collapse cross-source representations of one delivery change without losing provenance; add edit, deletion, rename, force-push, replay, and missed-event convergence tests for capsules.
- [ ] KLG-537 Add `CapabilityLedger` ports and projections for declared capabilities, initiatives, aliases, goals, ownership assertions, source mappings, inference candidates, confidence, and attributed corrections.
- [ ] KLG-538 Map Jira components/work hierarchy, GitHub repositories/modules/paths, Vault requirements/decisions, and Teams topics/claims into the capability ledger with reviewable unmapped and ambiguous queues.
- [ ] KLG-539 Reconstruct the independently cited planned-through-impact `DeliveryChain`; use its declared completion stage for period membership instead of generic source update time.
- [ ] KLG-540 Add `observedOutcome`, `claimedImpact`, `inferredImpact`, and `unknown` contracts and rendering rules; permanently test that inferred benefits cannot appear as observed outcomes.
- [ ] KLG-541 Implement `PeriodDeliveryReport` projection with executive summary, capability sections, delivery chains, outcomes, operational/compliance/maintenance work, risks/gaps/actions, source coverage, freshness, conflicts, inference labels, and material-claim citation map.
- [ ] KLG-542 Add a schema-constrained leadership-report composer and prompt distinct from fast operational composition; retain deterministic validation after model composition.
- [ ] KLG-543 Preserve authorized actor, surrounding Teams thread, referenced entities, workspace cadence, and declared goal context during deterministic and model-assisted planning.
- [ ] KLG-544 Extend the evaluation runner with theme recall, materially evidenced initiative recall, material-claim citation coverage, unsupported-outcome count, unlabelled-inference count, source-ablation comparison, and fingerprint-bound human usefulness.
- [ ] KLG-545 Pass the private human-authored report reconstruction target, real Teams period-report acceptance, exact-branch CI/runtime smoke, source-change convergence, authorization/privacy gates, and production rollback; attach evidence to the existing Bead and convoy without creating a replacement graph.
- [ ] KLG-546 Add an idempotent `DeclaredInitiativeSnapshot` import through the supported delivery CLI and hosted operator surface, backed by Strategy Kernel Postgres nodes, edges, origin records, stable reconciliation, and privacy-safe counts.
- [ ] KLG-547 Make goal-and-current-work planning require declared strategy intent plus Jira execution, prevent Teams messages from posing as goals, and render initiative-first alignment with every admitted activity assigned or explicitly unassigned.
- [ ] KLG-548 Import the private workspace's quarterly snapshot, verify the persisted register, and run the governed weekly-alignment question through the production Teams path.

## Delivery Execution Observability And Deadline Control

- [x] KLG-549 Extend Spec 005 and ratify ADR 0013 for the vendor-neutral observability boundary, one absolute deadline, cooperative cancellation, privacy allowlist, and bounded metric labels.
- [ ] KLG-550 Implement `delivery-execution-observability` domain/application/port contracts, architecture fitness rules, trace hierarchy, deadline context, and no-op/test adapters.
- [ ] KLG-551 Implement asynchronous structured-JSON and OTLP export with a bounded fail-open queue, explicit drop/export-failure measurements, and a stateless collector configuration.
- [ ] KLG-552 Instrument the complete report lifecycle, database/pool operations, provider operations, resource pressure, and separate scheduler/synchronization root traces.
- [ ] KLG-553 Add permanent privacy allowlist, cardinality, trace-parentage, remaining-budget, cancellation, provider-classification, database-starvation, bounded-expansion, and telemetry-failure tests.
- [ ] KLG-554 Deploy instrumentation only, reproduce the governed report category against the unchanged snapshot, and record a safe stage waterfall plus scheduler/resource correlation before changing execution behavior.
- [ ] KLG-555 Implement the smallest measured deadline, query, concurrency, pruning, expansion, retry, or envelope correction; record before/after latency, remaining budget, candidate counts, episodes, and estimated provider cost.
- [ ] KLG-556 Run controlled fault injection and both repositories' architecture, privacy, focused, and full CI-equivalent suites; record direct self-review and rollback evidence.
- [ ] KLG-557 Complete governed Jira/PR/merge and Railway deployment; provision Better Stack telemetry/errors/health/readiness/alerts/views; prove telemetry/error receipt and monitor operation.
- [ ] KLG-558 Re-run the production CLI against the frozen snapshot without Teams traffic; report implementation, tests, merge, deployment, telemetry, CLI, Teams routing, and human acceptance as separate gates.

## Dependency Order

KLG-002 through KLG-004 block ingestion. KLG-101 and KLG-102 block source adapters. Jira/Vault ingestion and embedding projections block PostgreSQL hybrid retrieval. Retrieval and GitHub live search block fusion and answer composition. KLG-532 and KLG-533 block period execution. KLG-534 blocks capsules and report composition. KLG-535 through KLG-540 block KLG-541 and KLG-542. KLG-544 blocks gold-report acceptance in KLG-545. KLG-550 through KLG-553 block the instrumentation-only deployment in KLG-554; its measured waterfall blocks remediation in KLG-555. KLG-555 blocks fault-injection/CI in KLG-556, which blocks governed merge/deploy in KLG-557 and production evaluation in KLG-558. All implementation and permanent tests block exact-branch CI and governed merge. Merge, key rotation, and verified backup block production migration/deployment. Historical bootstrap and continuous event/hourly convergence block final cadence, deep-dive, freshness, and leadership-report acceptance.

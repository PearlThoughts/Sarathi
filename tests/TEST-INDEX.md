# Test Index

## delivery-assistant

- Command: `bun run test`
- Location: `tests/delivery-assistant.test.ts`
- Scope: Skeleton role contract coverage for assistant responsibilities, PM/leadership scope, team maturity defaults, and policy-repo storage.
- Prerequisites: Bun dependencies installed with `bun install`.

## workspace-model

- Command: `bun run test`
- Location: `tests/workspace-model.test.ts`
- Scope: Unit coverage for source-system inference, YAML overlay tightening, and safety invariants.
- Prerequisites: Bun dependencies installed with `bun install`.

## platform-api

- Command: `bun run test`
- Location: `tests/platform-api.test.ts`
- Scope: Hono API coverage for health, foundation discovery, and workspace-model preview.
- Prerequisites: Bun dependencies installed with `bun install`.

## release-cli

- Command: `bun run test`
- Location: `tests/release-cli.test.ts`
- Scope: Runtime smoke command, Railway deploy guard coverage, explicit synthetic operator workflows, and fail-closed runtime selection.
- Prerequisites: Bun dependencies installed with `bun install`.

## release-cli-file-backed

- Command: `bun run test:bun-native`
- Location: `tests/release-cli-file-backed.bun.test.ts`
- Scope: File-backed workspace reconciliation, durable intent decisions, operator-supplied projection observations, sensitivity-scoped accountability counts, explicit report boundary context, denial handling, restart persistence, workspace isolation, local evidence import, watermarks, and private drift-review generation.
- Prerequisites: Bun dependencies installed with `bun install`.

## operator-runtime

- Command: `bun run test`
- Location: `tests/operator-runtime.test.ts`
- Scope: Explicit durable/synthetic selector parsing, missing selector rejection, and ambiguous selector rejection.
- Prerequisites: Bun dependencies installed with `bun install`.

## operator-runtime-sqlite

- Command: `bun run test:bun-native`
- Location: `tests/operator-runtime.bun.test.ts`
- Scope: SQLite repository composition plus exact workspace resolution by ID or key, including unknown and ambiguous fail-closed behavior.
- Prerequisites: Bun dependencies installed with `bun install`.

## boundary-policy

- Command: `bun run test`
- Location: `tests/boundary-policy.test.ts`
- Scope: Policy gate coverage for trust tier, delegation stage, approval, and model egress.
- Prerequisites: Bun dependencies installed with `bun install`.

## follow-up

- Command: `bun run test`
- Location: `tests/follow-up.test.ts`
- Scope: Generic due-item planning and exception digest coverage.
- Prerequisites: Bun dependencies installed with `bun install`.

## compliance-reminders

- Command: `bun run test:bun-native`
- Location: `tests/compliance-reminders.bun.test.ts`
- Scope: Workspace isolation, dry-run behavior, atomic idempotency reservation, durable outcome audit, retryable delivery failure, and audit-failure handling.
- Prerequisites: Bun dependencies installed with `bun install`.

## messaging

- Command: `bun run test`
- Location: `tests/messaging.test.ts`
- Scope: External-principal mapping and proactive message delivery contract coverage.
- Prerequisites: Bun dependencies installed with `bun install`.

## teams-mention

- Command: `bun run test`
- Location: `tests/teams-mention.test.ts`
- Scope: Direct mention normalization, idempotency, workspace/actor resolution, and policy-gated answer orchestration.
- Prerequisites: Bun dependencies installed with `bun install`.

## teams-ingress

- Command: `bun run test`
- Location: `tests/teams-ingress.test.ts`
- Scope: Official Agents SDK ingress configuration fails closed without Bot credentials.
- Prerequisites: Bun dependencies installed with `bun install`.

## strategy-kernel

- Command: `bun run test`
- Location: `tests/strategy-kernel.test.ts`
- Scope: Strategy kernel entity contracts, visibility inheritance, portable migration coverage, and workspace pack reconciliation rules.
- Prerequisites: Bun dependencies installed with `bun install`.

## evidence-import-contract

- Command: `bun run test`
- Location: `tests/evidence-import-contract.test.ts`
- Scope: Read-only source adapter surface, synthetic provider normalization, consent metadata, stable hashes, watermarks, and replay idempotence.
- Prerequisites: Bun dependencies installed with `bun install`.

## strategy-kernel-sqlite

- Command: `bun run test:bun-native`
- Location: `tests/strategy-kernel-sqlite.bun.test.ts`
- Scope: Bun SQLite migration application and repository persistence coverage.
- Prerequisites: Bun dependencies installed with `bun install`.

## workspace-packs

- Command: `bun run test`
- Location: `tests/workspace-packs.test.ts`
- Scope: Workspace pack loading, YAML fragment reconciliation, and conflict behavior.
- Prerequisites: Bun dependencies installed with `bun install`.

## intent-inbox

- Command: `bun run test`
- Location: `tests/intent-inbox.test.ts`
- Scope: Evidence ingestion, deterministic claim extraction, candidate inbox transitions, and audit events.
- Prerequisites: Bun dependencies installed with `bun install`.

## projections

- Command: `bun run test`
- Location: `tests/projections.test.ts`
- Scope: Intended projection creation, observation classification, operator-observation persistence semantics, and projection drift findings.
- Prerequisites: Bun dependencies installed with `bun install`.

## accountability-actions

- Command: `bun run test`
- Location: `tests/accountability-actions.test.ts`
- Scope: Non-live accountability action transitions, evidence-required completion, silence, escalation, and action-card feedback.
- Prerequisites: Bun dependencies installed with `bun install`.

## strategic-reports

- Command: `bun run test`
- Location: `tests/strategic-reports.test.ts`
- Scope: Workspace-scoped strategic report generation, derived drift findings, sensitivity ceilings, and leakage guards.
- Prerequisites: Bun dependencies installed with `bun install`.

## private-data-scan

- Command: `bun run test`
- Location: `tests/private-data-scan.test.ts`
- Scope: Tracked-file leakage detection, redacted failure output, stdin configuration, and ignored private values-file coverage.
- Prerequisites: Bun dependencies installed with `bun install`.

## local-ci

- Command: `bun run check`
- Scope: TypeScript, lint, architecture, static checks, test suite, and tracked-file private-data scan.
- Prerequisites: Bun dependencies installed with `bun install`.

## knowledge-layer

- Command: `bun run test`
- Location: `tests/knowledge-*.test.ts`, `tests/jira-knowledge-source.test.ts`, `tests/vault-knowledge-source.test.ts`, `tests/github-knowledge-search.test.ts`
- Scope: Canonical Jira/Vault ingestion and delivery projections; Jira overlap cursors, project/field/board/sprint catalog, changelog, and status-wait intervals; immutable Vault tree/blob deltas, rename/deletion retirement, and changed-only fetches; versioned attributed assertions with stable authors, aliases, confidence, effective dates, corrections, and supersession; continuous-sync control contracts; explicit exclusions; AI SDK and deterministic embeddings; ACL-first exact/full-text/vector retrieval; live GitHub search; RRF fusion; concise cited answer validation; Teams composition; CLI; and privacy-safe failures.
- Prerequisites: Bun dependencies installed with `bun install`.

## knowledge-postgres-integration

- Command: `SARATHI_KNOWLEDGE_TEST_DATABASE_URL=<pgvector-postgres-url> bun run test:knowledge-postgres`
- Location: `tests/knowledge-postgres.integration.test.ts`
- Scope: Real additive Drizzle migration, existing audit-table preservation, replay deduplication, edit versioning, full-vs-delta deletion safety, unchanged-vector reuse across Vault renames, authorization-safe attributed-claim supersession and correction deletion, ACL-first delivery projection queries, actor-deny/cross-workspace/sensitivity filtering, finance separation, exact/full-text/vector retrieval, checkpoint event/reconciliation freshness, and deletion tombstones.
- Prerequisites: Bun dependencies installed and an explicitly isolated PostgreSQL test database with pgvector available.

## delivery-intelligence-domain

- Command: `bunx vitest run tests/delivery-intelligence-domain.test.ts`
- Location: `tests/delivery-intelligence-domain.test.ts`
- Scope: Delivery objects, relations, observations, claims, metrics, goals, commitments, finance isolation, conflict derivation, safe generic query planning, independent time constraints, and workspace-local time resolution.
- Prerequisites: Bun dependencies installed with `bun install`.

## delivery-intelligence-application

- Command: `bunx vitest run tests/delivery-intelligence-application.test.ts`
- Location: `tests/delivery-intelligence-application.test.ts`
- Scope: Bounded planning, finance authorization before source calls, workspace and sensitivity filtering before model composition, deduplication, decision-ready compound briefs, active-over-terminal status ranking, conflict disclosure, citation validation, deterministic fallback, and partial-source behavior.
- Prerequisites: Bun dependencies installed with `bun install`.

## delivery-intelligence-live-sources

- Command: `bunx vitest run tests/delivery-query-sources.test.ts`
- Location: `tests/delivery-query-sources.test.ts`
- Scope: Pre-provider workspace/actor checks, live GitHub PR/commit retrieval, Jira query projection, Teams channel reads and catalog routing, project-email scoping, assistant-prompt exclusion, finance exclusion, and resolvable source citations.
- Prerequisites: Bun dependencies installed with `bun install`.

## teams-delivery-channel-projection

- Command: `bunx vitest run tests/teams-delivery-channel-projection.test.ts`
- Location: `tests/teams-delivery-channel-projection.test.ts`
- Scope: Explicit bounded Teams delivery-channel allowlists, current ingress-mapping fallback, canonical labels and routing topics, declared standard/shared/private scopes, and fail-closed ambiguity or size validation.
- Prerequisites: Bun dependencies installed with `bun install`.

## delivery-capability-matrix

- Command: `bunx vitest run tests/delivery-capability-matrix.test.ts tests/delivery-knowledge-query-source.test.ts`
- Location: `tests/delivery-capability-matrix.test.ts`, `tests/delivery-knowledge-query-source.test.ts`
- Scope: Reusable delivery-query coverage for PM question families plus actor/workspace/audience/sensitivity propagation into hybrid Jira/Vault retrieval.
- Prerequisites: Bun dependencies installed with `bun install`.

## delivery-cli

- Command: `bunx vitest run tests/delivery-cli.test.ts`
- Location: `tests/delivery-cli.test.ts`
- Scope: Durable status/query/reconcile/rebuild routing, bounded request parsing, non-destructive rebuild semantics, result metadata, and privacy-safe failures.
- Prerequisites: Bun dependencies installed with `bun install`.

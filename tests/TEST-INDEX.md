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

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
- Location: `tests/release-cli.test.ts`, `tests/release-cli-file-backed.bun.test.ts`
- Scope: Runtime smoke command, Railway deploy guard coverage, and file-backed workspace pack reconciliation into SQLite.
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

## strategy-kernel

- Command: `bun run test`
- Location: `tests/strategy-kernel.test.ts`
- Scope: Strategy kernel entity contracts, visibility inheritance, portable migration coverage, and workspace pack reconciliation rules.
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
- Scope: Intended projection creation, simulated verification states, and projection drift findings.
- Prerequisites: Bun dependencies installed with `bun install`.

## accountability-actions

- Command: `bun run test`
- Location: `tests/accountability-actions.test.ts`
- Scope: Non-live accountability action transitions, evidence-required completion, silence, escalation, and action-card feedback.
- Prerequisites: Bun dependencies installed with `bun install`.

## strategic-reports

- Command: `bun run test`
- Location: `tests/strategic-reports.test.ts`
- Scope: Workspace-scoped strategic report generation and leakage guards.
- Prerequisites: Bun dependencies installed with `bun install`.

## local-ci

- Command: `bun run check`
- Scope: TypeScript, lint, architecture, static checks, and test suite.
- Prerequisites: Bun dependencies installed with `bun install`.

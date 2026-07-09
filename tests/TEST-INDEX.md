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
- Scope: Runtime smoke command and Railway deploy guard coverage.
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

## local-ci

- Command: `bun run check`
- Scope: TypeScript, lint, architecture, static checks, and test suite.
- Prerequisites: Bun dependencies installed with `bun install`.

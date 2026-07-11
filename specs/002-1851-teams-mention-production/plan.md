# Implementation Plan: 1851 Teams Mention Production

**Branch**: `feat/teams-production-vertical-slice` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

## 1. Technical Context

- Runtime-neutral capability: TypeScript and Effect-facing module ports.
- Teams edge: Node 22, Express, `@microsoft/agents-hosting`, and
  `@microsoft/agents-hosting-express`.
- Application service: existing Hono composition surface.
- Storage: PostgreSQL in hosted environments; SQLite only local/private.
- Source edges: Graph, Jira Cloud, GitHub App, and private read-only Vault
  projection, all behind read-only ports.
- Verification: Vitest/Bun-native tests, architecture contract, public-data
  scan, Agents Toolkit manifest validation, real team acceptance.

## 2. Architecture Decisions

1. The official Agents SDK owns Bot Framework activity authentication and
   lifecycle handling; Sarathi must not reimplement request/JWT validation.
2. A Node 22 ingress is used because the SDK's Bun runtime compatibility is
   not proven. It is a thin anti-corruption adapter and carries no policy.
3. A single `teams-mention` capability owns normalized mention processing;
   Teams/Graph/Jira/GitHub/Vault/model implementations own their side effects.
4. Real mappings and aliases live in the private workspace pack/deployment
   projection. The repository documents schemas and synthetic fixtures only.

## 3. Delivery Phases

### Phase A — Contracts and Policy

Create `teams-mention` domain/application/ports, explicit actor aliases,
context-envelope contracts, redacted audit records, and tests for mention
classification, authorization ordering, injection resistance, and idempotency.

### Phase B — Runtime and Read Adapters

Implement Postgres Strategy Kernel parity/migrations; Graph thread, Jira,
GitHub App, and Vault projection readers behind bounded read-only ports. Add
timeouts, retries, freshness metadata, and source links.

### Phase C — Teams and Model Edges

Add Node 22 Agents SDK ingress, same-thread delivery, manifest/package assets,
approved-model port configuration, `/ready` probes, and production redaction.

### Phase D — Hosted Acceptance

Provision Railway Postgres/service, Azure Bot/Entra app, RSC consent, and the
Teams application. Install only in 1851 Delivery Team, run the real acceptance
matrix, document rollback/uninstall, and keep private evidence external.

## 4. File Ownership and Dependency Direction

`src/modules/teams-mention/**` owns all domain/application/ports.
`src/infrastructure/teams/**`, `jira/**`, `github/**`, `vault/**`,
`model/**`, and `postgres/**` implement ports. `src/platform/**` and the Node
ingress compose dependencies only. Domain/application code imports no SDK,
database, framework, environment, or filesystem package.

## 5. Verification

Write focused unit/integration tests before each adapter. Run `bun run check`
from the exact worktree; verify Node ingress with Node 22 container/runtime;
validate/package the app with `atk`; use live source and Teams evidence for the
final acceptance matrix. No live source write belongs in an adapter test.

## 6. Recovery

Read adapters resume from safe watermarks where applicable. Duplicate activity
events are stored before reply delivery. Railway rollback, bot endpoint disable,
Teams uninstall, and a Postgres restore point are required before production
promotion.

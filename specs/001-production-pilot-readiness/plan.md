# Implementation Plan: Production Pilot Readiness

**Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md) | **Execution Bead**: `sar-prod-spec`

## 1. Execution Goals

Deliver the internal single-tenant pilot through narrow, dependency-ordered slices that keep private artifacts outside the repository, preserve domain boundaries, and make every production claim verifiable through deterministic tests or status-only private operational evidence.

Secondary goals are to remove `src/cli/release.ts` and the SQLite repository as uncontrolled parallel-edit hotspots, keep source adapters read-only, and give each slice one exclusive file set plus an explicit shared-file edit window.

## 2. Technical Context

- **Language/runtime**: TypeScript 5.8 on Bun 1.2.
- **Service edge**: Hono; Better Auth owns identity/session/membership.
- **Domain policy**: Sarathi owns workspace, sensitivity, consent, trust, approval, tool, and model-egress decisions.
- **Persistence**: SQLite for the local/private pilot; the hosted durable-store decision must reuse Strategy Kernel ports.
- **Testing**: Vitest, Bun-native SQLite tests, ArchContract, dependency-cruiser, static analysis, and full `bun run check`.
- **Deployment**: hosted Bun/Hono service only after boundary, action, storage, auth, smoke, and rollback gates pass.
- **Constraint**: public artifacts contain invented data and safe status only.

## 3. Constitution And Architecture Check

- [x] Human-guided and evidence-gated: candidate claims require explicit ratification before action.
- [x] Identity/policy separation: Better Auth membership does not bypass Sarathi boundary policy.
- [x] YAML is intent, not enforcement: runtime gates enforce scope and sensitivity.
- [x] Authorization before retrieval/action/egress: specified as a blocking invariant and test matrix.
- [x] Repository boundary: implementation specs are public; private operating context remains external.
- [x] Domain-first dependency direction: modules own ports; infrastructure implements them; CLI/platform compose only.

No constitution exception or new ADR is required. ADR 0001 already ratifies the single-tenant, private-first runtime shape; implementation must update it only if the storage, deployment, or trust boundary changes.

## 4. Delivery Lanes

### Lane A — Baseline And Privacy Gates

Verify the existing private artifact round trip without printing identifiers, then implement sensitivity inheritance, workspace/audience enforcement, and the public-repository leakage scan. The private audit has no public file ownership and may run in parallel with public policy work.

### Lane B — Durable Operator Runtime

Replace implicit in-memory command behavior with explicit database/workspace selection. Make `src/cli/release.ts` a thin composition entry point and move command families into owned command modules so later report and deployment slices do not collide.

### Lane C — Read-Only Evidence Plane

Ratify the source-neutral import port first, then implement messaging, issue-tracker, and source-control adapters in parallel. Persist watermarks and normalized metadata through existing Strategy Kernel boundaries. Resolve actors only through explicit workspace-scoped aliases; unknowns and collisions remain first-class states.

### Lane D — Ratification And Reconciliation

Persist candidate decisions after runtime, policy, source adapters, and actor identity are available. Then implement report regeneration, projection verification, and accountability actions in independently owned modules.

### Lane E — Hosted Pilot And Operations

Wire the hosted runtime after policy and authenticated actions pass. Publish the private runbook outside the public repository only after report, projection, deployment, rollback, and smoke evidence exist. Keep public docs generic.

## 5. Phase Plan And Gates

### Phase 0 — Specification Gate

- Ratify this spec package and consistency analysis.
- Close `sar-prod-spec` only after docs lint, architecture check, full local CI, commit, push, and PR evidence.

### Phase 1 — Baseline, Boundary, And Runtime

- `sar-prod-audit`, `sar-prod-boundary`, and `sar-prod-runtime` start after this spec.
- Audit records safe counts/status only and creates scoped failure beads.
- Boundary work adds output/egress policy and leakage scanning without editing runtime command files.
- Runtime work owns CLI decomposition and durable-store wiring.

**Gate P1**: private baseline usable; policy tests and scan pass; real operator commands survive restart and reject missing selectors.

### Phase 2 — Ingestion Contract And Source Adapters

- `sar-prod-ingest-contract` starts only after boundary and runtime.
- Messaging, issue-tracker, and source-control adapters start after the contract and use separate infrastructure/test files.
- `sar-prod-actors` starts after the contract; schema/repository edits use the serialized storage window.

**Gate P2**: every adapter is read-only, idempotent, watermark-aware, synthetic-testable, and workspace-scoped; unknown/colliding actors are explicit.

### Phase 3 — Ratification

- `sar-prod-ratify` starts after runtime, boundary, all three source adapters, and actor identity.
- Decisions persist as auditable events with origin evidence and human-edit protection.

**Gate P3**: accept/edit/reject/merge/renegotiate/drop survive restart; no unratified claim is treated as truth.

### Phase 4 — Reports, Projections, And Actions

- `sar-prod-report` starts after private audit and ratification.
- `sar-prod-projections` starts after ratification.
- `sar-prod-teams-actions` starts after boundary and ratification.
- These slices may proceed in parallel only after runtime has split shared CLI entry points and each owns separate test and command files.

**Gate P4**: report filtering, real read verification, dry-run write defaults, authenticated interactions, silence, escalation, and cross-workspace tests pass.

### Phase 5 — Hosted Runtime And Runbook

- `sar-prod-railway` starts after boundary and authenticated actions.
- `sar-prod-runbook` starts after projections, hosted runtime, and report regeneration.

**Gate P5**: fail-closed hosted startup, durable storage, HTTPS callback, health/smoke, rollback evidence, and private operating/stop procedures are verified.

## 6. File Ownership Strategy

The normative ownership matrix is in [tasks.md](./tasks.md). Its rules are:

1. one active owner per file;
2. module owners use public surfaces and do not deep-import another lane;
3. shared registries (`package.json`, `tests/manifest.json`, `tests/TEST-INDEX.md`, `.agents/manifest.json`, architecture docs/config, migrations, CLI root, and platform composition) have serialized edit windows;
4. source-adapter lanes receive distinct directories and fixtures;
5. downstream lanes rebase after their dependency PRs merge before claiming a shared-file window;
6. a lane that discovers an unlisted shared file stops and updates the ownership contract before editing.

## 7. Test And Evidence Strategy

Each slice writes the failing deterministic test first, then implements the smallest capability behind the existing public module boundary. Tests use invented fixtures, fixed time/IDs, isolated databases, and separate processes for restart claims.

Required per-PR evidence:

- targeted unit/contract/integration tests for the slice;
- `bun run arch:check:json` with zero violations;
- `bun run static:architecture`;
- `bun run check` from the exact branch;
- public-repository leakage scan once available;
- `git diff --check` and a diff review confirming only assigned files changed;
- private operational work records safe status/counts only.

The final pilot gate additionally requires runtime smoke, rollback or restore evidence, disabled-by-default writes, and the private runbook checklist.

## 8. Recovery Defaults

- Import failures resume from the last committed source watermark.
- Persistence failures roll back the transaction and restore the last verified database backup when necessary.
- Projection or messaging failures return to dry-run/disabled callback state.
- Hosted release failures use the provider rollback plus disabled inbound callbacks.
- Leakage suspicion stops publication and requires private incident handling plus a clean scan before resumption.
- Any dependency contract mismatch returns the slice to the owning upstream bead instead of adding a local compatibility path.

## 9. Milestones

- **M1 — Safe durable core**: baseline, boundary, leakage scan, and operator persistence.
- **M2 — Trusted evidence**: source-neutral contract, three read adapters, and actor resolution.
- **M3 — Human-controlled loop**: persisted ratification, report, projection verification, and accountability actions.
- **M4 — Operable pilot**: hosted runtime, smoke/rollback evidence, private runbook, and regenerated private review.

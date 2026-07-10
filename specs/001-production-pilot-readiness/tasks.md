# Tasks And Ownership Contract: Production Pilot Readiness

- **Input**: [spec.md](./spec.md) and [plan.md](./plan.md)
- **Live execution state**: Beads owns claims, blockers, handoffs, and completion evidence. This file owns stable dependency and file intent.

## 1. Mandatory Ownership Rules

- A task may edit only its exclusive files plus shared files during its declared serialized window.
- `[P]` means the task may run in parallel because its exclusive files do not overlap.
- No two active tasks edit `src/cli/release.ts`, `src/infrastructure/sqlite/strategy-kernel-schema.ts`, `src/infrastructure/sqlite/strategy-kernel-sqlite.ts`, `src/platform/**`, `package.json`, `tests/manifest.json`, `tests/TEST-INDEX.md`, `.agents/manifest.json`, architecture docs/config, or migration registries at the same time.
- Before editing a shared file, the owner rebases onto merged dependencies and records the window in its Beads notes.
- Shared-file changes must be mechanical composition/registration. Domain behavior stays in the owning module.
- A needed file outside the matrix is a stop condition until ownership is added to this contract or the task is split.
- Every implementation task ends with targeted tests, `bun run arch:check:json`, `bun run static:architecture`, `bun run check`, leakage scan when available, diff review, commit, push, and PR evidence.

## 2. Dependency Graph

```text
sar-prod-spec
  +-- sar-prod-audit -------------------------------+
  +-- sar-prod-boundary --+                         |
  +-- sar-prod-runtime ---+                         |
                          v                         |
                sar-prod-ingest-contract            |
                  +-------+--------+--------+        |
                  v       v        v        v        |
              messaging  issues  source   actors     |
                  +-------+--------+--------+        |
                          v                         |
                     sar-prod-ratify                 |
                  +-------+--------+-----------------+
                  v       v        v
               report  projections  teams-actions
                                      |
                                      v
                                   railway
                  +-------------------+----+
                  | projections + report   |
                  +-----------+------------+
                              v
                           runbook
```

## 3. Stable Task Map

### Specification And Baseline

- [x] `sar-prod-spec` Ratify `specs/001-production-pilot-readiness/{spec,plan,tasks,analysis}.md` and update `specs/README.md`; production code is forbidden in this slice.
- [ ] `sar-prod-audit` [P] Verify the external private pack, database, approved exports, reconcile, and report regeneration without printing identifiers. Public repo ownership: none. Beads evidence: safe counts/status and scoped follow-up IDs only.

### Boundary Policy Lane

- [ ] `sar-prod-boundary` Extend `src/modules/boundary-policy/**` and its public surface for workspace, audience, sensitivity, consent, action, and model-egress decisions.
- [ ] `sar-prod-boundary` Add strictest-input inheritance integration at the owning domain boundary without moving persistence or rendering into boundary policy.
- [ ] `sar-prod-boundary` Add an isolated scan CLI under `src/cli/commands/private-data-scan.ts` (or the closest existing command-module convention) and `tests/private-data-scan.test.ts`; private forbidden values enter through ignored/process input and are never echoed.
- [ ] `sar-prod-boundary` Extend `tests/boundary-policy.test.ts` and `tests/strategic-reports.test.ts` for cross-workspace and lower-sensitivity denial.
- [ ] `sar-prod-boundary` Serialized registry window: update `package.json`, `tests/manifest.json`, and `tests/TEST-INDEX.md` for the scan and tests. Do not edit `src/cli/release.ts`.

### Durable Operator Runtime Lane

- [ ] `sar-prod-runtime` Replace implicit memory selection in `src/cli/release.ts` with explicit durable-store/workspace parsing and make the file a thin composition root.
- [ ] `sar-prod-runtime` Create owned command modules under `src/cli/commands/` for operator runtime, reports, and deployment so later slices do not share one implementation file.
- [ ] `sar-prod-runtime` Extend `src/infrastructure/sqlite/strategy-kernel-sqlite.ts` only where existing Strategy Kernel ports lack required durable operations; keep domain contracts in `src/modules/strategy-kernel/**`.
- [ ] `sar-prod-runtime` Add restart and cross-workspace CLI coverage in `tests/release-cli-file-backed.bun.test.ts` and focused command tests under `tests/`.
- [ ] `sar-prod-runtime` Serialized registry window: update test manifests only after rebasing on boundary changes.

### Evidence Contract And Adapter Lanes

- [ ] `sar-prod-ingest-contract` Define read-only source-neutral ports, normalized evidence metadata, consent, stable hashes, watermarks, and idempotent upsert behavior in `src/modules/evidence-import/**`; update `src/modules/evidence-import/index.ts` as the public surface.
- [ ] `sar-prod-ingest-contract` Add provider-neutral contract fixtures/tests in `tests/evidence-import-contract.test.ts`; the public port must contain no source-write method.
- [ ] `sar-prod-ingest-contract` Serialized persistence window: update Strategy Kernel repository/schema/migration files only if the existing evidence and watermark records cannot satisfy the ratified contract.
- [ ] `sar-prod-ingest-teams` [P] Implement the approved messaging/meeting export adapter under `src/infrastructure/evidence-import/messaging/**` with invented fixtures under `tests/fixtures/evidence-import/messaging/` and `tests/evidence-import-messaging.test.ts`.
- [ ] `sar-prod-ingest-jira` [P] Implement the approved issue-tracker export adapter under `src/infrastructure/evidence-import/issue-tracker/**` with invented fixtures under `tests/fixtures/evidence-import/issue-tracker/` and `tests/evidence-import-issue-tracker.test.ts`.
- [ ] `sar-prod-ingest-github` [P] Implement the approved source-control export adapter under `src/infrastructure/evidence-import/source-control/**` with invented fixtures under `tests/fixtures/evidence-import/source-control/` and `tests/evidence-import-source-control.test.ts`.
- [ ] Each adapter task proves replay idempotence, watermark progression, normalized metadata, safe URL handling, and absence of source writes; adapters do not edit shared schema or CLI roots.

### Actor Identity Lane

- [ ] `sar-prod-actors` Create or extend the workspace-scoped actor-identity capability under `src/modules/actor-identity/**` with explicit alias provenance, confidence, unknown, and collision states.
- [ ] `sar-prod-actors` Serialized persistence window: add the minimal actor-alias schema/repository operations and migration after the ingestion contract merges and while no other persistence window is active.
- [ ] `sar-prod-actors` Serialized architecture window: register the capability in `.agents/manifest.json` and `docs/architecture/module-boundaries.md` after the public surface exists and its architecture tests pass.
- [ ] `sar-prod-actors` Add invented cross-source alias and collision coverage in `tests/actor-identity.test.ts` and Bun-native persistence tests.

### Ratification Lane

- [ ] `sar-prod-ratify` Extend `src/modules/intent-inbox/**` for accept, edit, reject, merge, renegotiate, and drop transitions through Strategy Kernel ports.
- [ ] `sar-prod-ratify` Persist origin evidence, human edits, rejected decisions, and audit events using the serialized SQLite repository window.
- [ ] `sar-prod-ratify` Add restart, provenance, no-overwrite, and workspace-isolation coverage in `tests/intent-inbox.test.ts` plus Bun-native persistence tests.
- [ ] `sar-prod-ratify` Add an owned command module under `src/cli/commands/intent-ratification.ts`; the CLI root receives composition-only changes in the serialized window.

### Parallel Reconciliation Lanes After Ratification

- [ ] `sar-prod-report` [P] Extend `src/modules/strategic-reports/**`, `src/cli/commands/report.ts`, and `tests/strategic-reports.test.ts` for database-generated, evidence-linked, policy-filtered drift reviews. Private output requires an explicit external path and stdout remains status-only.
- [ ] `sar-prod-projections` [P] Extend `src/modules/projections/**` and `tests/projections.test.ts` for real read observations and `in_sync`, `missing`, `stale`, `conflicting`, or `unauthorized`; provider write adapters remain separate and dry-run by default.
- [ ] `sar-prod-teams-actions` [P] Extend `src/modules/accountability-actions/**`, `src/modules/messaging/**`, dedicated messaging infrastructure, and `tests/accountability-actions.test.ts` for accepted-commitment-only cards, authenticated interactions, silence, and escalation.
- [ ] `sar-prod-teams-actions` Serialized persistence/platform window: interaction storage, callback route composition, and app manifest wiring occur after report/projection lanes have relinquished shared files.

### Hosted Runtime And Operations

- [ ] `sar-prod-railway` Extend `src/cli/commands/deployment.ts`, `src/platform/**`, deployment configuration, and runtime smoke tests only after boundary and action-card PRs merge.
- [ ] `sar-prod-railway` Prove fail-closed production auth/secrets, durable hosted storage, HTTPS callback reachability, health/smoke, and rollback without committing deployment identifiers or secrets.
- [ ] `sar-prod-runbook` Publish the real operator runbook outside the public repository; public ownership is limited to generic self-hosting guidance under `docs/operations/` if needed. Cover setup, consent, retention, daily/weekly work, rollback, manual override, audience restrictions, ratification ownership, and stop conditions.

## 4. Shared-File Window Order

1. `sar-prod-boundary`: scan/test registration only.
2. `sar-prod-runtime`: CLI decomposition and durable runtime registration.
3. `sar-prod-ingest-contract`: evidence schema/port registration, if required.
4. `sar-prod-actors`: actor schema/migration and architecture-context registration.
5. `sar-prod-ratify`: ratification persistence and command registration.
6. `sar-prod-teams-actions`: interaction persistence and callback composition.
7. `sar-prod-railway`: final platform/deployment composition.
8. `sar-prod-runbook`: docs index registration only.

Report and projection tasks must not edit shared registries while the action-card window is active. When a registry update is unavoidable, the task waits, rebases, records the window in Beads, makes a composition-only change, and relinquishes it before the next lane starts.

## 5. Handoff Contract

Every task handoff records:

```text
context_id: production-pilot-readiness
bead_id: sar-prod-...
owned_files: [paths]
shared_window: [none or named window]
input_commit: [sha]
output_commit: [sha]
checks_run: [targeted tests, arch check, static architecture, full check, scan]
privacy_evidence: [synthetic-only or safe status/counts]
findings: [summary]
blockers: []
next_beads: [ids]
```

A handoff missing ownership, verification, or privacy evidence is incomplete.

# Consistency Analysis: Production Pilot Readiness

This document records the architecture, requirement, task, privacy, and verification consistency review for the production-pilot specification package.

## Result

**PASS** — the specification, plan, and task map are internally consistent with Sarathi's constitution, ADR 0001, module-boundary contract, public/private boundary, Beads dependency graph, and local verification commands.

## Traceability

| Concern | Specification | Plan | Task/Owner | Deterministic Evidence |
| --- | --- | --- | --- | --- |
| Durable operator state | FR-001 to FR-003 | Phase 1 / Lane B | `sar-prod-runtime` | separate-process restart and cross-workspace SQLite tests |
| Sensitivity and workspace isolation | FR-004 to FR-005 | Phase 1 / Lane A | `sar-prod-boundary` | lower-ceiling denial, strictest-input inheritance, cross-workspace rejection |
| Public/private leakage | FR-014, FR-016 | Phase 1 and all release gates | `sar-prod-boundary`, every slice | invented forbidden-value scan plus diff review; private status/counts only |
| Read-only imports | FR-006 to FR-008 | Phase 2 / Lane C | ingest contract and three adapter beads | contract API inspection, fixture replay, watermarks, no write operation |
| Actor resolution | FR-003, FR-006 | Phase 2 / Lane C | `sar-prod-actors` | unknown/collision/provenance and workspace-isolation tests |
| Human ratification | FR-009 to FR-010 | Phase 3 / Lane D | `sar-prod-ratify` | decision matrix, origin evidence, restart, no-overwrite tests |
| Projection safety | FR-011 | Phase 4 / Lane D | `sar-prod-projections` | real read-state matrix, dry-run default, dual authorization |
| Authenticated actions | FR-012 | Phase 4 / Lane D | `sar-prod-teams-actions` | accepted-only cards, callback denial, persistence, silence/escalation |
| Evidence-linked reports | FR-013 | Phase 4 / Lane D | `sar-prod-report` | deterministic findings, citations, ceiling filtering, stdout privacy |
| Hosted fail-closed runtime | FR-015 | Phase 5 / Lane E | `sar-prod-railway` | environment validation, HTTPS callback, health/smoke, rollback |
| Pilot operations | Success criteria and stop conditions | Phase 5 / Lane E | `sar-prod-runbook` | private checklist with public status-only evidence |

## Architecture Checks

- Capabilities are named in Sarathi's domain vocabulary rather than by frameworks.
- Domain/application code depends inward; infrastructure adapters implement ports.
- CLI and platform are composition boundaries, not owners of policy or persistence semantics.
- Better Auth membership remains separate from Sarathi sensitivity, consent, action, and egress policy.
- YAML and workspace packs express intent; runtime boundary policy enforces it.
- SQLite and hosted persistence reuse Strategy Kernel contracts.
- Source-provider schemas remain behind anti-corruption adapters.
- The plan introduces no placeholder module or second domain model.

## Dependency Checks

- The three direct successors of `sar-prod-spec` are represented: audit, boundary, and runtime.
- The ingestion contract waits for boundary and runtime.
- Source adapters and actor resolution wait for the ingestion contract.
- Ratification waits for runtime, boundary, all three source adapters, and actor resolution.
- Reports wait for audit and ratification; projections wait for ratification; action cards wait for boundary and ratification.
- Hosted runtime waits for boundary and action cards.
- The runbook waits for projections, hosted runtime, and report regeneration.
- Shared-file windows further serialize hotspots that the Beads dependency graph alone does not protect.

## Privacy Checks

- No real organization, customer, workspace, actor, channel, ticket, repository, deployment, credential, URL, database, export, report, or local private path is embedded in the package.
- Provider and capability names describe public product integration categories, not private identifiers.
- Private audit and runbook work explicitly remain outside the public repository.
- Public evidence is limited to invented fixtures and safe aggregate status.
- Leakage configuration is external and values are not echoed.

## Verification Checks

- Every implementation slice has a permanent deterministic test class.
- Process-restart evidence is required for durability claims.
- Adapter replay is required for idempotence claims.
- Cross-workspace and sensitivity-ceiling cases are required, not inferred from generic unit coverage.
- `bun run arch:check:json`, `bun run static:architecture`, and `bun run check` are explicit per-PR gates.
- Private operational checks supplement but never replace public reusable tests.

## Findings

No blocking contradiction, uncovered acceptance criterion, private-data dependency, or unowned implementation hotspot remains in the plan. The principal delivery risk is shared-file contention in CLI composition, SQLite persistence, platform routes, package scripts, and test manifests; [tasks.md](./tasks.md) mitigates it with a mandatory serialized edit-window order.

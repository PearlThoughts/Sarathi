# Feature Specification: Production Pilot Readiness

- **Created**: 2026-07-10
- **Status**: Ratified for implementation planning
- **Execution Bead**: `sar-prod-spec`

## 1. Purpose

This specification defines the community-safe capability boundary for taking Sarathi from a private file-backed evidence proof to an internal, single-tenant production pilot. It establishes what must be durable, policy-gated, testable, and operable while keeping private workspace packs, source exports, databases, reports, identifiers, paths, and credentials outside the public repository and its collaboration surfaces.

The specification is designed for multi-agent execution. [plan.md](./plan.md) defines the implementation lanes, [tasks.md](./tasks.md) is the dependency and file-ownership contract, and [analysis.md](./analysis.md) records the cross-artifact architecture consistency result.

## 2. Problem And Objective

Sarathi can reconcile a file-backed workspace pack, import approved local evidence, persist Strategy Kernel state, and generate a private drift review. The remaining pilot work crosses persistence, boundary policy, source ingestion, identity resolution, ratification, projections, accountability actions, reporting, deployment, and operations. Without one capability plan, parallel slices could duplicate contracts, edit the same hotspots, weaken privacy boundaries, or report synthetic behavior as production-ready.

Objectives:

- make every operator workflow durable and workspace-scoped;
- enforce authorization and sensitivity before retrieval, action, rendering, and model egress;
- ingest approved evidence through read-only, source-neutral ports and anti-corruption adapters;
- preserve human ratification, provenance, audit events, and derived sensitivity;
- verify the pilot with deterministic synthetic tests and private, status-only operational evidence;
- assign dependencies and files so concurrent implementation slices do not collide.

## 3. Principles

1. **Private data never becomes public test data.** Public code, fixtures, docs, commits, PRs, logs, and Beads notes contain synthetic examples or safe counts/status only.
2. **Authorization precedes exposure.** Workspace, audience, sensitivity, consent, and action checks run before retrieval, projection, card creation, report rendering, or model egress.
3. **Human decisions are durable truth.** Source evidence may propose claims; only an authorized human ratification event may accept or edit intent. Later inference cannot overwrite human-authored state.
4. **Read first, write explicitly.** Source adapters expose read-only contracts. Projection writes remain dry-run unless both deployment configuration and workspace policy explicitly permit them.
5. **One domain model, multiple adapters.** SQLite and the future hosted store implement Strategy Kernel ports; they do not introduce a second intent or evidence model.
6. **Production claims require restart evidence.** A workflow is durable only when a new process can observe the prior process's committed state.

## 4. Capability Architecture

```text
approved source/export surfaces
        |
        v
read-only anti-corruption adapters
        |
        v
evidence-import port -> workspace + consent + sensitivity gate
        |
        v
Strategy Kernel repository -> candidate intent -> human ratification
        |                              |
        v                              v
projection verification       accountability actions
        \                              /
         +---- policy-gated reports --+
                         |
                         v
              operator CLI / hosted API
```

Capability ownership:

- `strategy-kernel` owns workspace-scoped intent, evidence, projections, accountability records, events, and repository ports.
- `boundary-policy` owns authorization decisions for workspace, audience, action, sensitivity, approval, and model egress.
- `evidence-import` owns source-neutral read contracts, normalized metadata, watermarks, and idempotent import behavior.
- `intent-inbox` owns candidate extraction and ratification transitions; evidence is not truth on ingestion.
- `projections` owns desired-versus-observed reconciliation and dry-run write requests.
- `accountability-actions` owns accepted-commitment actions, interactions, silence, and escalation state.
- `strategic-reports` owns workspace-scoped findings and rendering after policy filtering.
- `messaging`, source adapters, SQLite, hosted storage, and deployment code are edge adapters.
- `src/cli` and `src/platform` compose capabilities; they do not own domain policy.

Dependency direction remains the repository contract: domain and application code do not import infrastructure or framework packages; infrastructure implements capability-owned ports; external callers use each module's public `index.ts` or `contracts.ts` surface.

## 5. User Scenarios And Acceptance

### Story 1 — Resume A Durable Operator Workflow (P1)

An authorized operator selects an explicit database and workspace, records an inbox decision or projection/accountability action, exits, and observes the same state from a new process.

**Independent test**: execute a write command against a temporary SQLite database, start a separate process for the read command, and assert workspace-scoped state and audit events.

1. **Given** no database or workspace selector, **when** a real operator command runs, **then** it fails closed without creating synthetic state.
2. **Given** a committed decision, **when** the process restarts, **then** the decision, provenance, and audit event remain available only in the selected workspace.

### Story 2 — Produce A Boundary-Safe Artifact (P1)

An authorized operator requests a report, card, or model-visible context for a target audience and receives only records permitted for that workspace and sensitivity ceiling.

**Independent test**: combine synthetic evidence across workspaces and visibility levels, derive a claim, and assert the result inherits the strictest input and cannot enter a lower-sensitivity output.

1. **Given** restricted evidence, **when** a lower-sensitivity output is requested, **then** the record is excluded or the request is rejected with a non-sensitive reason.
2. **Given** evidence from another workspace, **when** a report or action is assembled, **then** cross-workspace data is rejected before rendering or egress.

### Story 3 — Import Approved Source Evidence Read-Only (P1)

An operator imports approved messages, work items, and source-control events through adapters that cannot write to source systems.

**Independent test**: replay invented export fixtures twice and assert normalized metadata, stable hashes, actor references, watermarks, and idempotent repository state.

1. **Given** the same source record and watermark, **when** import is replayed, **then** no duplicate evidence is created.
2. **Given** an import port, **when** its public API is inspected and exercised, **then** no source-write operation exists.

### Story 4 — Ratify Intent Before Acting (P1)

An authorized human accepts, edits, rejects, merges, renegotiates, or drops a candidate claim with complete provenance and audit history.

**Independent test**: import invented evidence, decide a candidate, restart, and prove the decision and origin evidence persist while rejected and edited states remain auditable.

1. **Given** an unratified claim, **when** reporting, projection, or accountability action evaluates it, **then** it is not treated as accepted intent.
2. **Given** human-edited intent, **when** later evidence is imported, **then** the human-authored value is not silently overwritten.

### Story 5 — Operate And Recover The Pilot (P2)

An operator can verify private artifacts, generate a drift review, exercise the approved action path, check the hosted runtime, and follow retention, rollback, and stop procedures without exposing private identifiers.

**Independent test**: run public synthetic smoke checks plus a private operator checklist whose public evidence records only pass/fail, counts, hashes where safe, and timestamps.

## 6. Functional Requirements

- **FR-001**: Real operator commands MUST require explicit durable-store and workspace selectors.
- **FR-002**: Synthetic mode MUST be explicit, deterministic, and test-only.
- **FR-003**: All persisted reads and writes MUST include workspace scope.
- **FR-004**: Boundary evaluation MUST precede retrieval, tool invocation, rendering, card creation, projection, and model egress.
- **FR-005**: Derived artifacts MUST inherit the strictest sensitivity of every contributing input.
- **FR-006**: Source-neutral import ports MUST preserve source type, external reference, actor reference, occurred-at timestamp, content hash, sensitivity, consent metadata, and ingestion watermark.
- **FR-007**: Read-only import ports MUST expose no source mutation operation.
- **FR-008**: Import replay MUST be idempotent within a workspace and source scope.
- **FR-009**: Candidate claims MUST remain non-authoritative until an authorized ratification event.
- **FR-010**: Human-edited intent and rejected decisions MUST remain durable and auditable.
- **FR-011**: Projection writes MUST default to dry-run and require both environment and workspace-policy authorization.
- **FR-012**: Accountability cards MUST be created only for accepted commitments and authenticated interactions MUST persist as events.
- **FR-013**: Reports MUST cite persisted evidence, apply a sensitivity ceiling, and avoid private content on standard output.
- **FR-014**: The public repository scan MUST accept private forbidden values through an untracked file or process input without printing or committing them.
- **FR-015**: Hosted runtime startup MUST fail closed when production auth, secrets, storage, or callback verification are missing.
- **FR-016**: Public execution evidence MUST contain synthetic examples or non-identifying counts/status only.

## 7. Privacy And Community-Safe Contract

The public repository may contain generic product code, synthetic fixtures, schemas, migrations, tests, specs, and self-hosting guidance. It MUST NOT contain real workspace packs, source exports, databases, reports, organization or customer identifiers, account/channel/project/repository mappings, private URLs, credentials, secret references, local private paths, or copied private wording.

Private verification follows these rules:

- private inputs remain outside the checkout;
- commands print operation status and safe aggregate counts, never private content or identifiers;
- the leakage scan consumes forbidden values from an ignored path or process input and redacts matches from its own output;
- Beads, commits, PRs, CI logs, and public runbooks record only safe status and remediation references;
- any suspected exposure is a stop condition: halt publication, preserve evidence privately, remove the exposure through the approved incident path, and re-run the scan before continuing.

Public synthetic fixtures use invented workspaces, actors, URLs, tickets, repositories, and messages. They preserve structure, edge cases, and sensitivity relationships without copying private values.

## 8. Deterministic Test Strategy

All tests use fixed clocks, stable IDs, invented fixtures, isolated temporary databases, and deterministic ordering.

- **Policy tests**: audience ceiling, strictest-input inheritance, workspace isolation, consent denial, action denial, and model-egress denial.
- **Persistence tests**: separate-process restart, transaction rollback, idempotent migrations, workspace-scoped reads/writes, and durable audit events.
- **Adapter contract tests**: normalized metadata, watermarks, replay idempotence, unknown actor handling, collision handling, and proof that source writes are absent.
- **Ratification tests**: accept, edit, reject, merge, renegotiate, drop, provenance retention, and no overwrite of human edits.
- **Projection/action tests**: dry-run default, authenticated callback failure, accepted-commitment-only cards, silence, escalation, and evidence-required completion.
- **Reporting tests**: evidence links, deterministic finding order, sensitivity filtering, cross-workspace rejection, and stdout privacy.
- **Leakage-scan tests**: invented forbidden values are detected in staged fixtures, values are not echoed, ignored private configuration stays untracked, and a clean tree passes.
- **Architecture tests**: `bun run arch:check:json` and `bun run static:architecture` enforce module direction.
- **Release gate**: every implementation PR runs `bun run check`; pilot operations additionally run the documented runtime smoke check.

## 9. Success Criteria

- Every real operator workflow survives process restart against an explicit workspace and durable store.
- Restricted or cross-workspace evidence cannot reach a lower-sensitivity artifact, action, or model context.
- Each approved source adapter imports the same invented fixture twice without duplicate evidence and exposes no write method.
- Human ratification and provenance survive restart and cannot be overwritten by later inference.
- The public repository and PR diff pass the private-data scan without using committed private values.
- The private pilot can regenerate a drift review and exercise an authenticated action and recovery path while public records contain safe status only.
- Every slice passes the architecture fitness gate and the full local CI equivalent before merge.

## 10. Explicit Non-Goals

- No production code, deployment, private artifact inspection, or source-system mutation is part of this specification slice.
- No multi-tenant SaaS control plane or cross-customer aggregation.
- No autonomous acceptance of inferred intent or autonomous external posting.
- No broad enterprise search, full raw-source retention by default, hidden people scoring, or client-facing account voice.
- No new provider SDK client before the approved CLI/export read path is proven insufficient.
- No private operator runbook, credentials, deployment identifiers, or real source mappings in the public repository.
- No claim that a hosted bot is production-ready until callback authentication, persistence, audit, rollback, and policy tests pass.

## 11. Stop And Rollback Conditions

Stop the affected slice when a private value enters a public surface, a workspace scope is missing, a lower-sensitivity output receives restricted evidence, a source adapter can mutate its source, a human decision can be overwritten, a real command silently selects synthetic state, or deterministic tests cannot reproduce the result.

Recovery uses the last verified database backup or source watermark, additive migrations, disabled inbound callbacks, dry-run projection mode, and a reviewed operator action. Git rollback alone is not sufficient for persisted or externally delivered state.

## 12. References

- [Production Readiness Runtime ADR](../../docs/adr/0001-production-readiness-runtime.md)
- [Architecture Overview](../../docs/architecture/overview.md)
- [Module Boundaries](../../docs/architecture/module-boundaries.md)
- [Public And Private Boundary](../../docs/implementation/public-private-boundary.md)
- [Test Index](../../tests/TEST-INDEX.md)
- [Sarathi Constitution](../_governance/constitution.md)

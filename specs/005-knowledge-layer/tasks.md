# Tasks: example Knowledge Layer

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
- [x] KLG-103 Implement approved Jira issue normalization in `src/infrastructure/jira/` using typed fields, description, and comments with provenance and resolvable citations.
- [x] KLG-104 Implement approved Vault Markdown normalization in `src/infrastructure/vault/` with heading-first passages, anchors, hashes, ACL, and deletion detection.
- [x] KLG-105 Implement the Vercel AI SDK embedding adapter plus deterministic test adapter and projection-model/dimension validation.

## Phase 3 — Retrieval, Fusion, and Answering

- [x] KLG-201 Implement metadata-first authorization filters and exact identifier lookup before passage body materialization.
- [x] KLG-202 Implement PostgreSQL full-text and pgvector search with independently inspectable ranks and filtered active versions.
- [x] KLG-203 Implement deterministic reciprocal-rank fusion, source authority/freshness ranking, and duplicate suppression.
- [x] KLG-204 Implement bounded GitHub live search/API retrieval in `src/infrastructure/github/` without storing repository bodies or embeddings.
- [x] KLG-205 Fuse approved Teams thread context, Jira/Vault indexed evidence, and GitHub live results into a single authorized envelope.
- [x] KLG-206 Implement AI SDK concise cited answer composition with normally two or three lines and resolvable citations for every material claim.

## Phase 4 — Durable Operations and Regression Coverage

- [x] KLG-301 Add `knowledge ingest|reconcile|query|status` to `src/cli/commands/knowledge-runtime.ts` and existing release CLI composition.
- [x] KLG-302 Add permanent migration, authorization, restricted/cross-workspace, dedupe, edit, deletion, checkpoint, citation, retrieval, fusion, provider, and log-redaction tests; update `tests/manifest.json` and `tests/TEST-INDEX.md`.
- [ ] KLG-303 Wire the capability into Teams mention composition/readiness and prove restart persistence plus same-thread response shape.
- [ ] KLG-304 Run focused tests after each slice, then final exact-branch `bun run check` and `bun run runtime:smoke`.

## Phase 5 — Governed Merge and Production Acceptance

- [ ] KLG-401 Resolve or create the correct Jira issue, inspect governance, self-review the complete diff, push, open the governed PR, merge through GitHub, and sync canonical `main`.
- [ ] KLG-402 Rotate the exposed OpenRouter key without printing either provider key; confirm Z.AI remains primary and OpenRouter fallback.
- [ ] KLG-403 Confirm production backup/restore and rollback, apply the non-destructive migration, verify pgvector/journal/audit tables, and deploy the merged revision.
- [ ] KLG-404 Run bounded approved Jira/Vault ingestion and record only counts, checksums, checkpoints, source scope identifiers, and timing.
- [ ] KLG-405 Verify the Example Delivery Portal status question, approved risks/next-action question, and one GitHub-required implementation question with concise resolvable citations.
- [ ] KLG-406 Prove duplicate suppression, pre-model permission filtering, restricted/cross-workspace exclusion, source edit/deletion reconciliation, privacy-safe logs, application rollback, and database recovery evidence.
- [ ] KLG-407 Update and close the private capability task only with merged PR/SHA, exact test evidence, live answer evidence, deployment/migration/rollback evidence; commit Dolt state and run `gt ready` after each completed task.

## Dependency Order

KLG-002 through KLG-004 block ingestion. KLG-101 and KLG-102 block source adapters. Jira/Vault ingestion and embedding projections block PostgreSQL hybrid retrieval. Retrieval and GitHub live search block fusion and answer composition. All implementation and permanent tests block exact-branch CI and governed merge. Merge, key rotation, and verified backup block production migration/deployment. Live ingestion blocks real-answer and reconciliation acceptance.

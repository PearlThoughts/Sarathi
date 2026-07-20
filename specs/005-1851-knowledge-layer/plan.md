# Implementation Plan: 1851 Knowledge Layer

**Branch**: `feat/1851-knowledge-layer` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

## 1. Execution Goal

Deliver the `sar-2du.11` child capability from schema through observed production answers. The implementation ends only after live Jira/Vault ingestion, GitHub-backed retrieval, concise cited Teams answers, security boundaries, and rollback have been verified.

## 2. Technical Context

- Language/runtime: strict TypeScript on Bun for CLI/application and the existing Node 22 Teams edge.
- Domain/application composition: Effect and capability-owned ports.
- Storage: existing Railway PostgreSQL with pgvector; Drizzle ORM, Drizzle Kit schema generation, and Drizzle migration journal.
- Model and embeddings: Vercel AI SDK provider abstractions; Z.AI primary and OpenRouter fallback for answer generation; deterministic embedding adapter for tests.
- Retrieval: exact identifiers, PostgreSQL full-text search, pgvector similarity, GitHub live search, reciprocal-rank fusion, source authority, and freshness.
- Verification: Vitest, Bun-native integration tests, architecture fitness gates, privacy scan, `bun run check`, runtime smoke, and bounded production acceptance.

## 3. Constitution and Architecture Check

- Human-guided and evidence-gated: pass; source writes and autonomous actions are excluded.
- Better Auth and Sarathi policy separation: pass; the new capability consumes resolved workspace/audience authorization and does not own identity.
- YAML is intent, not enforcement: pass; PostgreSQL queries and application policies enforce workspace, ACL, sensitivity, active version, and deletion state.
- Authorization before retrieval and model egress: pass; metadata-first filtering precedes body materialization, with a second egress check before composition.
- Domain-first boundaries: pass; `src/modules/knowledge-layer` owns rules and ports, while adapters remain in `src/infrastructure`.

## 4. Project Structure and Ownership

```text
src/modules/knowledge-layer/
  domain/                 canonical evidence, ACL, ranking, citation contracts
  application/            ingestion, reconciliation, retrieval, fusion, answering
  ports/                  repository, source, embedding, live search, answer ports
  index.ts                sole public module surface
src/infrastructure/
  postgres/               Drizzle schema, migration runner, repository/search adapter
  jira/                   approved Jira ingestion adapter
  vault/                  approved Vault ingestion adapter
  github/                 live search adapter
  model/                  AI SDK embedding and answer adapters
src/cli/commands/
  knowledge-runtime.ts    durable operator command surface
drizzle/                  generated/versioned PostgreSQL migrations and journal
tests/                    permanent unit, integration, authorization, retrieval tests
```

The existing Teams mention assembler receives a `KnowledgeAnswerPort` or authorized retrieval port through composition. It does not import infrastructure or provider types.

## 5. Delivery Slices

### Slice A — Spec, Schema, and Migration Safety

1. Add Drizzle Kit configuration and PostgreSQL schema definitions.
2. Establish the incremental Drizzle migration journal without claiming existing audit tables.
3. Add the pgvector extension migration and canonical source/item/version/passage/ACL/projection/checkpoint tables.
4. Add migration planning/status/rollback-safe CLI behavior and integration tests that prove existing audit tables remain intact.

### Slice B — Canonical Ingestion

1. Implement source-neutral ingestion and reconciliation application services.
2. Implement Jira normalization for typed fields, description, and comments.
3. Implement Vault Markdown heading normalization and citation anchors.
4. Add deterministic embedding and transactional checkpoint/projection persistence.
5. Prove replay dedupe, edit versioning, deletion/tombstone behavior, ACL change behavior, and redacted summaries.

### Slice C — Authorized Hybrid Retrieval

1. Implement metadata-first policy filtering, exact-ID lookup, PostgreSQL FTS, and vector search.
2. Implement independent rank lists and deterministic RRF with authority/freshness adjustment.
3. Implement GitHub live search with bounded repository scopes and no body persistence.
4. Fuse Teams thread evidence with indexed and live results while suppressing duplicates.

### Slice D — Concise Cited Answers and Operations

1. Extend the AI SDK edge for embedding and concise answer composition.
2. Add `knowledge ingest|reconcile|query|status` durable CLI commands.
3. Wire the knowledge capability into the existing Teams mention path and readiness surface.
4. Enforce two- or three-line normal responses and resolvable citations.

### Slice E — Governed Integration and Production Acceptance

1. Run focused tests after every slice, then `bun run check` and `bun run runtime:smoke` on the final branch revision.
2. Resolve the correct Jira issue, self-review, open the governed PR, merge through GitHub, and synchronize canonical `main`.
3. Rotate the previously exposed OpenRouter key without printing either provider key.
4. Confirm backup/restore and rollback, apply the additive production migration, deploy the merged revision, and ingest bounded approved Jira/Vault scopes.
5. Verify the three real questions and the security/deletion/deduplication acceptance matrix.

## 6. Data and Migration Strategy

Drizzle schema definitions are the source of truth for new tables and constraints. Generated migrations and the Drizzle journal replace further table-by-table runtime SQL migration logic for this capability. The database-native `vector` extension enablement is isolated in the versioned migration package; application/runtime code does not issue DDL.

The migration is additive and separately observable: plan, backup marker, apply, schema/extension verification, and rollback evidence. Existing `compliance_reminder_audit`, `compliance_reminder_dry_run_evidence`, and `teams_mention_audit` tables are verification sentinels and must survive with counts and definitions intact.

## 7. Retrieval Design

Each backend emits a ranked list of authorized candidates with stable identity and resolvable citation metadata. Exact identifier matches, keyword matches, vector matches, and GitHub live matches retain their component ranks. RRF combines them using default `k=60`; authority and freshness can adjust ordering within bounded weights but cannot introduce or reveal an unauthorized candidate. Default output is the top 10 candidates before bounded answer selection.

## 8. Test and Evidence Strategy

- Domain tests: ACL precedence, sensitivity ceilings, stable identity, hashes, chunking, exact matching, RRF, authority/freshness, citation eligibility, answer length.
- Application tests: transaction/checkpoint ordering, dedupe, edits, deletion, scope removal, cross-workspace exclusion, pre-egress filtering, partial-source behavior.
- Adapter tests: Jira typed payloads, Vault Markdown headings, GitHub live result normalization, AI SDK provider selection, deterministic embeddings, Drizzle migration and pgvector queries.
- Integration tests: real PostgreSQL/pgvector container or repository-owned test service, migration upgrade from current baseline, restart persistence, existing audit-table preservation.
- Production evidence: deployment ID/SHA, migration journal IDs, extension version, safe counts/checksums, query source mix, citation URLs, concise answer shape, privacy-safe logs, and rollback commands/results.

## 9. Risks and Recovery

- Migration drift or extension privilege failure: stop before application promotion; preserve backup and current deployment.
- Embedding dimension/model change: reject writes before transaction; version projection model/dimension and rebuild only approved source scope.
- Permission leakage from post-retrieval filtering: prohibited; query candidate metadata first and materialize bodies only after policy pass.
- Jira/Vault deletion lag: checkpoint reconciliation tombstones missing authorized items and excludes them in the same committed transaction.
- Provider or GitHub outage: state partial availability; do not silently substitute unapproved sources or stale GitHub copies.
- Credential exposure: rotate affected credential, stop deployment, scan logs and artifacts, and record only redacted incident evidence.

## 10. Dependency and Completion Gates

`Schema -> ingestion -> embeddings -> hybrid retrieval -> GitHub fusion -> answer composition -> CLI/runtime wiring -> exact-branch CI -> governed merge -> key rotation/backup -> migration/deploy -> bounded ingestion -> real answers/security proof`.

No gate is satisfied by schema creation, mock queries, HTTP readiness, deployment alone, or ingestion counts alone. Completion requires observed real 1851 answers and rollback evidence.

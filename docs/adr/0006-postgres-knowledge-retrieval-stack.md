# ADR 0006: PostgreSQL Knowledge Retrieval Stack

## Status

Accepted

## Context

The accepted 1851 Teams mention workflow currently assembles narrow source exemplars at request time. Production knowledge coverage requires canonical Jira and Vault synchronization, versioning, passage-level policy, semantic retrieval, deterministic deletion reconciliation, live GitHub evidence, concise citations, and recovery on the existing Railway deployment.

The decision affects domain contracts, ingestion, authorization, storage, search, provider composition, CLI operations, deployment, and rollback. The production service already owns PostgreSQL, while existing migration code contains hand-written runtime DDL and the live database contains audit tables that must not be replaced.

## Decision

Use the existing Railway PostgreSQL service as the sole durable knowledge store and enable pgvector through a versioned Drizzle migration. Drizzle schema definitions, generated migrations, the Drizzle journal, and Drizzle repositories own new tables and queries. Existing audit tables remain untouched; legacy unapplied Strategy Kernel table definitions are not treated as live baseline.

Represent indexed evidence as `source -> item -> immutable version -> passage -> retrieval projection`, with separate ACL bindings and synchronization checkpoints. Jira and approved Vault content are stored as canonical metadata, versions, passages, provenance, and search projections. GitHub stays a bounded live search/API backend; repository bodies and embeddings are not persisted.

Expose embeddings and answer generation through Vercel AI SDK-backed infrastructure ports. Combine exact identifiers, PostgreSQL full-text search, vector similarity, live GitHub ranks, source authority, and freshness through inspectable reciprocal-rank fusion. Enforce workspace, audience, ACL, sensitivity, active-version, and deletion constraints before body materialization and again before model egress.

## Consequences

### Positive

- One production datastore provides transactional versions, ACLs, checkpoints, full-text search, vectors, auditability, backup, and recovery.
- Drizzle replaces further table-by-table runtime migration infrastructure and keeps provider/database types outside the domain.
- Jira/Vault edit and deletion reconciliation becomes deterministic and restart-safe.
- GitHub remains current without duplicating or retaining the codebase.
- Component ranks and citation provenance remain explainable.

### Negative

- PostgreSQL extension availability, index tuning, vacuuming, embedding dimension changes, and migration recovery become operational responsibilities.
- Hybrid search and ACL filtering require database integration tests; in-memory mocks alone are insufficient.
- GitHub availability affects implementation-question completeness because there is intentionally no stored code fallback.
- Changing embedding model or dimension requires a bounded projection rebuild.

## Alternatives Considered

- **External vector database**: Pinecone, Weaviate, LanceDB, Azure AI Search, or a similar service could separate vector operations, but would add another security, synchronization, deletion, backup, cost, and operational boundary without a demonstrated need.
- **Code and evidence graph store**: Neo4j could model relations explicitly, but would duplicate transactional authority and introduce a second query/storage model before graph-specific requirements exist.
- **Live retrieval for every source**: avoids indexed copies but cannot provide consistent versions, deletions, checkpoints, hybrid ranking, or predictable latency across Jira and Vault.
- **Index GitHub with Jira and Vault**: improves offline availability but duplicates code, creates deletion and ACL obligations, and weakens GitHub's live authority.
- **Custom SQL and provider clients**: minimizes dependency changes but continues the current migration debt and binds application code to vendor protocols.

## References

- [1851 Knowledge Layer Spec](../../specs/005-1851-knowledge-layer/spec.md)
- [1851 Knowledge Layer Plan](../../specs/005-1851-knowledge-layer/plan.md)
- [ADR 0004: Vault Allowlist Runtime Retrieval](./0004-vault-allowlist-runtime-retrieval.md)
- [ADR 0005: Single Runtime With Private Organization Overlays](./0005-single-runtime-private-overlays.md)

# Continuous Project Intelligence Synchronization

## Purpose

Extend the existing knowledge and delivery-intelligence capabilities from bounded
manual synchronization and request-time source reads into a continuously current,
rebuildable project knowledge projection. Jira, version-controlled knowledge
roots, source-code repositories, and configured collaboration channels use one
canonical ingestion lifecycle while retaining source-specific normalization.

This sub-spec extends the existing feature. It does not create another product,
datastore, graph database, vector service, scheduler service, or agent runtime.

## Scope

- Bootstrap a configurable historical window for activity-oriented sources.
- Continuously synchronize created, updated, renamed, and deleted source records.
- Prefer verified source events for low latency and run an hourly reconciliation
  cycle to repair missed, delayed, duplicated, or out-of-order events.
- Preserve immutable versions, active projections, ACLs, sensitivity, provenance,
  embeddings, citations, checkpoints, and tombstones in PostgreSQL.
- Retain live source reads for exact current-state verification or when a query
  requires data newer than the latest successful checkpoint.
- Model source and business time without making one reporting period the system
  boundary.
- Support fast operational answers and explicitly requested deep-dive reports.

## Source Contracts

### Jira

- Synchronize the complete configured project query, not exemplar issues.
- Normalize project metadata, issue types, fields, board columns, sprint identity
  and dates, hierarchy, links, assignee, reporter, status, priority, versions,
  components, estimates, time tracking, descriptions, comments, and changelog.
- Derive status-entry and status-exit observations from changelog history so wait
  duration is calculated from source timestamps rather than model inference.
- Use an incremental cursor based on source update identity and timestamp, with a
  bounded overlap to tolerate equal timestamps and delayed indexing.
- Run hourly reconciliation even when a source event mechanism is configured.

### Version-Controlled Knowledge Roots

- Bootstrap every configured root at its current repository revision.
- Compare immutable tree/blob identity and fetch, chunk, and embed only added or
  changed Markdown documents.
- Retire renamed, deleted, or out-of-scope documents transactionally.
- Preserve heading paths, anchors, repository revision, effective metadata, ACL,
  sensitivity, and attributed human assertions.
- Use repository push events where available and hourly tree reconciliation as
  the correctness path.

### Source-Code Repositories

- Bootstrap the configured repositories at their current default-branch commit.
- Persist repository, revision, path, language, symbol, snippet, and line-range
  metadata with commit-pinned citations and symbol-aware passages.
- Exclude binaries, generated output, vendored dependencies, build artifacts,
  credentials, and configured private paths before persistence or embedding.
- On a verified default-branch push or merge, diff the previous checkpoint against
  the new commit and re-index only added, changed, renamed, or deleted files.
- Normalize pull requests, reviews, commits, checks, releases, deployments, and
  linked work-item identifiers as delivery observations and relations.
- Retain live repository API/search reads to verify current code or recover when
  the index checkpoint is stale, incomplete, or unavailable.

### Collaboration Messages

- Bootstrap a configurable historical window from every configured channel that
  the workspace policy authorizes.
- Preserve team, channel, thread, parent/reply identity, author, mentions,
  created/edited/deleted timestamps, native permalink, and attachment metadata.
- Version edited messages and tombstone deleted messages; do not silently retain a
  deleted version as active evidence.
- Chunk by thread and coherent reply spans rather than embedding isolated short
  acknowledgements as independent project knowledge.
- Trust that a message occurred; represent its content as an attributed claim,
  commitment, question, decision, risk, or observation only when supported by the
  normalized message role and content.
- Exclude assistant prompts, bot replies, tests, finance-classified content, and
  unmapped channels before passage materialization and embedding.
- Consume supported source change notifications and renew their subscriptions;
  hourly reconciliation repairs notification gaps and pagination drift.

## Canonical Synchronization Lifecycle

```text
source event or hourly trigger
  -> authorize source scope
  -> load current checkpoint
  -> enumerate bounded changes with overlap
  -> normalize source items and immutable versions
  -> chunk and embed changed passages only
  -> project entities, aliases, relations, observations, claims, and metrics
  -> validate ACL, sensitivity, citations, version and deletion boundaries
  -> atomically commit projections, tombstones and checkpoint
  -> publish privacy-safe freshness and reconciliation metrics
```

Every delivery is idempotent by source, external identity, version identity, and
event/delivery identity. Events accelerate synchronization; they do not advance a
checkpoint until authoritative source data has been fetched and committed.

## Temporal and Freshness Contract

Each source record may carry `sourceCreatedAt`, `sourceUpdatedAt`, `observedAt`,
`assertedAt`, `effectiveFrom`, `effectiveTo`, `indexedAt`, and `deletedAt`.
Connector cursors are operational metadata, not business time.

The runtime MUST expose, per source:

- last successful event delivery and reconciliation;
- source cursor and indexed source revision;
- newest source update observed;
- document, passage, embedding, version, and tombstone counts;
- lag, failure class, retry count, and next scheduled reconciliation;
- configuration/scope hash without printing private scope values.

A query result MUST report a source as stale or unavailable when its freshness
contract is not met. The model may not conceal stale coverage.

## Response Depth Contract

Response length and latency follow requested intent, not one global concise limit.

- **Fast operational answer**: status, ownership, today, yesterday, blocker, or
  next-action questions target a same-thread response within ten seconds and use
  the smallest format that preserves requested fields and citations.
- **Structured brief**: weekly, sprint, release, risk, or comparison questions may
  use sections, bullets, numbered actions, and compact tables where supported.
- **Deep-dive report**: an explicit investigation, history, trend, root-cause, or
  comprehensive report may exceed ten seconds and the normal concise shape. It
  must disclose scope, time window, sources, freshness, conflicts, gaps, and the
  distinction between observed facts and inference.

The application selects a declared response mode before retrieval. It must not
silently truncate a deep-dive request to satisfy the fast-answer budget.

## Orchestration Decision

Continuous synchronization uses explicit application workflows, typed states,
PostgreSQL checkpoints, idempotent inbox records, leases, and Effect retries.
The query path uses the existing validated delivery plan. No general agent graph
framework is required for these deterministic workflows.

A stateful agent-orchestration framework may be reconsidered only when a measured
workflow requires all of the following beyond the existing application model:

1. model-selected branching over multiple tools;
2. durable pause/resume across process restarts;
3. human inspection or modification of intermediate reasoning state;
4. replay or fork of a long-running decision trajectory; and
5. evidence that the existing typed workflow has become materially harder to
   operate or verify.

Any future framework remains behind an application orchestration port and may not
own source truth, authorization, checkpoints, delivery entities, or model-egress
policy.

## Verification and Exit Criteria

- Bootstrap, unchanged replay, edit, rename, deletion, scope removal, missed
  event, duplicate event, out-of-order event, expired subscription, and hourly
  repair tests pass for every connector.
- Changed-only embedding tests prove unchanged passage vectors are reused.
- Connector integration tests exercise pagination and production PostgreSQL
  constraints, not only in-memory fixtures.
- Freshness and lag are observable without source bodies or credentials.
- A source edit or deletion appears in authorized query results within the
  configured freshness objective or is explicitly reported stale.
- Fast, structured, and deep-dive response modes satisfy their independent
  completeness, citation, latency, and formatting contracts.
- Live source verification never bypasses workspace, audience, sensitivity,
  finance, version, or deletion enforcement.

## Non-Goals

- No new vector database, graph database, queue product, crawler, or workflow
  framework in this capability.
- No unrestricted tenant-wide collaboration or mailbox archive.
- No persistence of secrets, binary attachments, build output, dependency trees,
  or unconfigured source scopes.
- No assumption that an event webhook is complete or exactly once.


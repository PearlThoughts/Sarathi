# Sub-Spec: Code-Derived Delivery Intelligence

## Purpose

Use source control as delivery evidence: identify which capabilities changed, why they changed, who can maintain or approve them, whether work converged to a deployed outcome, where rework recurs, and how observed execution relates to declared leadership goals.

This is not a generic code-assistant index. It extends Sarathi's existing delivery-intelligence and knowledge-layer boundaries without adding a graph database, separate vector service, repository warehouse, or orchestration platform.

## Questions This Capability Must Answer

- Which capabilities changed in the last 30 days, why, and with what delivery outcome?
- Where is repeated work, churn, rework, review delay, or recurring failure concentrated?
- Who is the declared owner, practical maintainer, recent contributor, and usual reviewer for a capability?
- What work was estimated, what elapsed and wait intervals were observed, and what remains unknown?
- Did a claimed deliverable progress from issue to change, review, merge, checks, release, deployment, and acceptance?
- Which leadership goals have supporting implementation activity, which have none, and which code changes lack a declared goal?
- What high-level history explains the current shape of a capability without requiring a reader to traverse every old commit?

Sarathi must answer with evidence and confidence, not infer a developer's private mental state from code.

## Evidence Model

The primary unit of delivered intent is a merged pull request, enriched with:

1. linked Jira work items and leadership goals;
2. pull-request title, description, review discussion, approval, and merge state;
3. commits, changed paths, diff hunks, and symbol impact;
4. tests, checks, releases, deployments, and acceptance evidence;
5. repository manifests, package boundaries, API schemas, catalogs, and `CODEOWNERS`;
6. attributed Teams and Vault decisions that explain or qualify the change.

Commit messages and source bodies are supporting evidence. Commit count, line count, and authorship alone are not measures of effort, value, or individual performance.

## Multi-Resolution Delivery Artifacts

Sarathi derives versioned artifacts at several resolutions rather than embedding every raw revision:

- **Code artifact capsule**: a file or symbol's stable identity, purpose, public contract, owning module, dependencies, current commit, and citation range.
- **Change capsule**: one merged change's declared intent, linked work, affected capabilities and symbols, review/check outcome, deployment state, contributors, and citations.
- **Capability capsule**: a human-meaningful business or platform capability, its modules, interfaces, ownership evidence, dependencies, recent changes, recurring concerns, and confidence.
- **Decision capsule**: a cited architectural or delivery choice reconstructed from a pull request, issue, review, Vault record, or Teams discussion, including alternatives only when explicitly evidenced.
- **Delivery-verification capsule**: the observed chain from planned work through merge, checks, release, deployment, and acceptance, preserving missing stages as gaps.
- **Time capsule**: an evidence-backed 30-day digest and coarser historical summaries of capability activity, outcomes, rework, risks, and ownership change.
- **Goal-alignment capsule**: a leadership goal connected to supporting, enabling, maintenance, risk-reduction, contradictory, unplanned, or unknown implementation evidence.

Each capsule separates source facts, deterministic derivations, and model-assisted inferences. It stores provenance, source revision, effective time, projection version, confidence, ACL, and tombstone state.

## Capability and Module Discovery

Declared boundaries take precedence:

- Backstage or repository catalogs;
- workspace, package, build, deployment, and infrastructure manifests;
- directory and package ownership;
- APIs, routes, schemas, commands, and domain vocabulary;
- `CODEOWNERS` and documented architecture.

Sarathi may propose an inferred capability only when at least two of these signals agree:

- **semantic cohesion**: names, documentation, contracts, and behavior describe the same concern;
- **structural cohesion**: symbols call, import, contain, implement, test, or deploy together;
- **temporal cohesion**: files and symbols repeatedly change together across independent merged work.

An inferred boundary remains a candidate with evidence and confidence until ratified. A rename or move preserves identity when Git history, content similarity, and structural context support it; otherwise the previous record is tombstoned and the new record is linked as a possible successor.

## Ownership Without Surveillance

Ownership is multi-valued and time-qualified:

- **declared owner** from catalog, team mapping, or `CODEOWNERS`;
- **maintainer** from sustained, reviewed changes across the capability;
- **recent contributor** from the requested time window;
- **reviewer or approver** from accepted review history;
- **knowledge contact** from attributed decisions and accepted corrections.

Sarathi reports conflicts, concentration risk, stale ownership, and unsupported areas. It does not produce individual productivity scores or equate frequent edits with ownership. Access-filtered evidence must not create hidden cross-boundary ownership links.

## Estimates, Effort, and Delivery Truth

Jira estimates and plans remain declared values. Source control contributes observed milestones:

- first linked commit;
- pull-request open, ready-for-review, approval, and merge times;
- review cycles and requested-change intervals;
- check failures and recoveries;
- release, deployment, rollback, and acceptance times.

Where the sources permit it, Sarathi separates active intervals from queue or wait intervals. It never converts commits, diff size, or lines changed into hours. Estimate-versus-observation answers disclose link coverage, missing stages, out-of-band work, and confidence.

Delivery truth is a chain, not a binary score. “Merged,” “checks passed,” “released,” “deployed,” and “accepted” are distinct cited states.

## Indexing and Retrieval

### Repository scope

- Index the configured default branch at an exact commit.
- Track configured pull-request base and head revisions for active delivery work.
- Retain selected releases or historical snapshots according to policy.
- Do not continuously embed every repository, branch, blob revision, binary, generated file, or vendored dependency.
- Map a merged diff to symbols using the symbol table for that revision. Degrade explicitly to file or module evidence when symbol mapping is unsafe.

### Parse and projection

Use language-aware parsing where supported and a safe file-level fallback otherwise. Extract symbols, definitions, documentation, imports, calls, inheritance, tests, routes, configuration, ownership declarations, and deployment relationships. Persist these as ordinary PostgreSQL delivery objects and relations; a graph database is unnecessary for bounded traversal.

Content hashes and source identities drive incremental parsing and embedding. Events accelerate refresh, while hourly overlapping reconciliation remains authoritative for edits, force-pushes, renames, deletions, missed events, and scope changes.

### Hybrid retrieval

Retrieval proceeds in this order:

1. structured delivery queries for work, ownership, time, status, checks, releases, deployments, and declared goals;
2. exact and full-text search for identifiers, paths, symbols, errors, and vocabulary;
3. bounded relation traversal for capability, dependency, ownership, test, and delivery chains;
4. vector retrieval over authorized derived capsules and selected source passages;
5. live GitHub verification when the checkpoint, requested revision, or answer exactness requires it.

PostgreSQL full-text search, pgvector, Drizzle, the existing model provider, and reciprocal-rank or equivalent deterministic fusion remain the platform. Embeddings complement exact and structural retrieval; they do not replace it.

## What Sarathi Learns From CodeCompass

CodeCompass provides useful implementation patterns:

- Tree-sitter-aware chunks aligned to symbols rather than arbitrary token windows;
- file hashes and Git change detection for incremental re-indexing;
- hybrid BM25 and vector retrieval with reciprocal-rank fusion;
- optional structural relationships alongside semantic search.

Sarathi should reuse those patterns or compatible libraries where practical, but not copy CodeCompass's storage or product boundary. CodeCompass uses SQLite full-text search, LanceDB vectors, and local embeddings for code navigation. Sarathi retains PostgreSQL/pgvector and projects code into delivery artifacts joined with Jira, Teams, Vault, reviews, checks, releases, and deployments. Structural extraction must also be measured: a sparse code graph cannot, by itself, support capability ownership or delivery conclusions.

## Recent and Historical Synthesis

The default operational view emphasizes the last 30 days:

1. normalize merged change capsules;
2. group them by ratified or inferred capability;
3. join planned work, ownership, reviews, checks, releases, deployments, incidents, and attributed decisions;
4. identify rework only across distinct changes with structural or issue evidence, not lexical similarity alone;
5. create a cited capability digest with outcomes, incomplete chains, risks, and unknowns.

Older activity is compacted into versioned monthly or release-aligned time capsules. A historical summary must link back to the contributing change capsules and exact source revisions. Corrections create superseding versions instead of silently rewriting prior evidence.

## Leadership Alignment

Sarathi maps delivery evidence to declared goals using explicit links first and evidence-backed inference second. Each change may be classified as:

- directly aligned;
- enabling;
- maintenance or risk reduction;
- unplanned but justified;
- potentially contradictory;
- unknown.

Alignment is a vector, not a single opaque score:

- goal coverage;
- implementation progress;
- verified outcome coverage;
- unplanned-work share;
- divergence or contradiction;
- evidence completeness and confidence.

Reports show the supporting changes, goals with no observed implementation, work with no declared goal, and weak links requiring human confirmation. A numeric roll-up is optional and must retain its component values and citations.

## Authorization and Governance

- Apply repository, workspace, sensitivity, and actor authorization before traversal, retrieval, capsule composition, embedding, or model egress.
- Build summaries within an ACL-equivalent audience or materialize them at query time; never leak a restricted source through a broader derived capsule.
- Keep source bodies and diffs out of logs.
- Treat authorship and review data as delivery provenance, not employee evaluation.
- Preserve resolvable commit, pull-request, issue, release, and deployment citations.
- Purge or tombstone derived bodies when their source is deleted or leaves scope, according to workspace retention policy.

## Projection Into the Existing Delivery Model

This capability extends the existing model instead of creating a parallel “code intelligence” store:

- `DeliveryObject`: repository, capability, module, file, symbol, pull request, release, deployment, goal;
- `DeliveryRelation`: contains, imports, calls, tests, owns, contributes-to, implements, changes, verifies, deploys, supersedes;
- `DeliveryObservation`: commit, review, merge, check result, release, deployment, rollback, acceptance;
- `DeliveryClaim`: pull-request intent, goal mapping, ownership assertion, decision, correction;
- `DeliveryMetric`: capability-level change frequency, lead and wait intervals, review cycles, rework, failure recovery, and delivery-chain coverage;
- `KnowledgeRecord`: authorized source and derived passages used for hybrid retrieval.

## Current Implementation Boundary

Sarathi currently implements:

- current default-branch repository bootstrap at an exact commit;
- incremental changed-file reconciliation with content reuse;
- file and lightweight symbol/snippet projections;
- commits, pull requests, reviews, checks, releases, deployments, changed paths, work-item keys, and commit-pinned citations;
- live verification paths and the shared synchronization checkpoint model.

It does not yet implement the full design in this sub-spec. Known gaps include:

- language-aware AST symbol identity across supported languages;
- diff-hunk-to-symbol mapping across historical revisions;
- finer capability discovery below the repository/module level;
- co-change, hotspot, recurring-rework, and ownership projections;
- delivery-chain and estimate-versus-observation analytics;
- 30-day and historical time capsules;
- goal-alignment inference and evaluation.

These gaps require explicit tasks and acceptance evidence. They are not implied complete by repository ingestion counts or embeddings.

## Evaluation

A representative evaluation set must include:

- 30-day capability change and outcome summaries;
- declared versus practical ownership and concentration risk;
- repeated work and recurring failure with distinct supporting occurrences;
- estimate, elapsed, wait, review, merge, deployment, and acceptance coverage;
- goal coverage, unplanned work, contradictions, and unknown alignment;
- implementation questions requiring exact symbol or revision evidence;
- rename, deletion, force-push, missed-event, stale-checkpoint, and ACL-change convergence;
- restricted-repository and mixed-ACL non-disclosure.

Measure structured retrieval correctness, completeness, grounding, citation resolution, freshness, authorization, latency, confidence calibration, and human usefulness. Production acceptance requires real source changes, exact-branch CI, useful Teams answers, and rollback proof; schema shape or ingestion counts alone are insufficient.

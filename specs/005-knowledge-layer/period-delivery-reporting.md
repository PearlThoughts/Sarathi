# Sub-Spec: Evidence-First Period Delivery Reporting

## Purpose

Reconstruct a human-useful weekly, monthly, sprint, or quarterly delivery report from authorized project evidence before composing prose. The report must explain business capabilities and outcomes, not merely list the newest work items or semantically similar passages.

This capability extends the existing delivery-intelligence and knowledge-layer boundaries. It does not add a graph database, vector service, connector platform, orchestration framework, or parallel reporting datastore.

## Product Outcome

A delivery leader can ask what was delivered during an explicit period and receive a source-supported account comparable in coverage, organization, and usefulness to a strong report written by a knowledgeable Delivery Manager. The answer:

- covers the material initiatives found across the authorized scope rather than returning only the first few matches;
- groups implementation activity into recognizable product, platform, operational, compliance, and maintenance capabilities;
- separates declared intent, observed delivery state, claimed business impact, inferred impact, and unknowns;
- explains incomplete delivery chains, missing evidence, source freshness, and scope coverage;
- retains resolvable citations for every material claim; and
- adapts presentation depth without changing the underlying evidence census.

## Failure Being Corrected

An indexed corpus is necessary but not sufficient. A retrieval path that ranks a small number of Jira issues, pull requests, commits, or passages can be fully cited and still omit most of a team's work. Embeddings can find semantic similarity, but they cannot prove period completeness, deduplicate one change represented in several sources, determine whether work was deployed or accepted, or translate technical changes into business outcomes.

Period reporting therefore uses retrieval for enrichment after a structured census. It never treats top-k similarity results as the population of work completed in the requested period.

## Reporting Pipeline

```text
authorized source records
  -> canonical identities and facts
  -> PR-centered change capsules
  -> capability and initiative mapping
  -> delivery-chain reconstruction
  -> outcome and impact assertions
  -> exhaustive period census
  -> capability rollup and coverage evaluation
  -> report composition
  -> citation and completeness validation
```

Each stage is independently inspectable. Composition cannot convert a partial census into a complete report.

## Core Contracts

### `ChangeCapsule`

The primary unit of implementation intent is a merged pull request or, when no pull request exists, another explicitly typed delivery change. It contains:

- stable change identity plus observed and completion timestamps;
- declared intent from linked work, pull-request metadata, and attributed decisions;
- commits, changed paths, affected symbols, repositories, and contributors;
- linked Jira work, requirements, reviews, checks, releases, deployments, rollbacks, and acceptance;
- capability and initiative candidates with evidence and confidence;
- completion timestamp selected from the strongest available delivery-chain stage;
- resolvable source citations; and
- missing links, conflicts, ACL, projection version, and tombstone state.

Commits and file changes enrich a capsule; they are not independent delivered outcomes when they belong to the same change.

### `CapabilityLedger`

A workspace-scoped, private-configurable catalog of business and platform capabilities, initiatives, aliases, ownership assertions, goals, and source mappings. Declared mappings take precedence. Inferred mappings require multiple independent signals and remain confidence-labelled until corrected or ratified.

The ledger must support a many-to-many mapping: one change may enable several capabilities, and one capability may span several repositories, modules, Jira components, Vault topics, and Teams channels.

### `DeclaredInitiativeSnapshot`

A workspace-scoped, period-bounded import of the operating owner's accepted plan.
The snapshot preserves the source revision, source URL, original row identity,
module/initiative hierarchy, plan status, horizon, and optional notes. Import is
idempotent by workspace, period, and stable row key.

The Strategy Kernel stores the accepted hierarchy as one period goal, module goals,
and initiative commitments connected by `part_of` edges. A later snapshot updates
the same nodes and archives removed rows instead of creating duplicates. The private
workspace overlay owns real snapshot content; the public runtime owns validation,
reconciliation, persistence, and query behavior.

For an alignment question, connected Jira, GitHub, Vault, and Teams results are
classified against these declared initiatives. An exact declared mapping wins.
Otherwise deterministic title and alias matching may assign one best initiative.
Items that cannot be classified remain explicitly unassigned; raw channel messages
must never be rendered as goals merely because the question asks about goals.

### `DeliveryChain`

Delivery is represented as ordered, independently cited stages:

```text
planned -> implemented -> reviewed -> merged -> checks passed
        -> released -> deployed -> accepted -> impact observed
```

Missing stages remain visible. “Merged,” “deployed,” “accepted,” and “business impact observed” are not synonyms.

### `OutcomeAssertion`

Every outcome or impact statement has one of four evidence classes:

- `observedOutcome`: directly supported by a source event or authoritative record;
- `claimedImpact`: attributed to a named, authorized human or source;
- `inferredImpact`: model-assisted interpretation with supporting evidence and confidence; and
- `unknown`: a requested outcome dimension for which the authorized corpus has no sufficient evidence.

An inferred impact must be visibly labelled. It may not be rendered as an observed result. A plausible benefit such as reduced developer dependency remains a claimed or inferred impact until usage, acceptance, operational, or other outcome evidence supports it.

### `PeriodCensus`

The complete authorized candidate population for one explicit interval and workspace scope. It records:

- interval, timezone, boundary semantics, and completion-stage rule;
- source checkpoints and freshness;
- candidates examined, capsules formed, duplicates collapsed, and exclusions by reason;
- unmapped, ambiguous, incomplete-chain, and unavailable-source counts;
- capability, initiative, repository, work-item, and contributor coverage; and
- a deterministic checksum for replay comparison.

The census is exhaustive within declared bounds before ranking or prose generation. Pagination or source failure makes the report partial.

### `PeriodDeliveryReport`

A report is a projection over one accepted census. It contains:

- executive summary;
- capability or initiative sections;
- delivered and incomplete delivery chains;
- business outcomes and impact assertions by evidence class;
- operational, compliance, reliability, maintenance, and launch work when material;
- risks, gaps, ownership changes, and next actions only when cited;
- scope, coverage, freshness, conflicts, inference labels, and omissions; and
- material-claim-to-citation mappings.

## Time Semantics

The requested interval must be parsed even when the wording is open-ended, such as “last 30 days,” “this week,” “previous sprint,” or “Q2.” Workspace timezone and explicit source timestamps determine inclusive and exclusive boundaries.

For delivered-period reports, the strongest available completion stage determines period membership according to a declared rule. Generic record update time or ingestion time must not substitute for delivery completion. Work without a qualifying completion stage may appear as active or incomplete, but not as delivered.

An indexed Jira status-transition observation from a non-terminal state to `Done`, `Closed`, or `Completed` is `accepted` evidence at the transition timestamp. It is not release or deployment evidence. A later current-state refresh such as “is Done” does not establish period membership.

## Source Roles

- **Jira** supplies declared scope, work hierarchy, plan, estimates, status transitions, ownership, components, and acceptance records.
- **GitHub** supplies implementation intent, code change, review, check, release, deployment, rollback, repository, module, and contributor evidence.
- **Vault** supplies durable goals, requirements, decisions, capability definitions, rationale, reports, and attributed corrections.
- **Teams** supplies thread context, attributed claims, decisions, operational coordination, acceptance, and tacit delivery context within authorized channels.
- **Human corrections** supersede or qualify derived mappings and claims without deleting the underlying observations.

No source is assumed complete for every semantic role. Source precedence is field-specific and conflicts are disclosed.

## Retrieval and Composition

Structured queries build the census and delivery chains. Exact/full-text/vector retrieval then enriches capsules with rationale, terminology, decisions, and contextual evidence. Model composition receives an authorized report envelope, not arbitrary source bodies and not an unconstrained top-k retrieval result.

Response products are explicit:

- `operational_answer`: a concise decision-ready response;
- `period_delivery_brief`: a bounded but coverage-aware weekly, sprint, or monthly rollup;
- `leadership_report`: a completeness-first multi-section report;
- `implementation_investigation`: a code- and revision-specific explanation.

A short Teams answer may summarize a larger accepted report envelope. It must link or offer the fuller report when the question asks for breadth that cannot be represented safely in a few lines.

## Thread and Request Context

The planner may use authorized surrounding thread context, actor identity, workspace defaults, declared weekly or quarterly goals, and prior referenced entities to resolve ambiguity. Context affects query interpretation; it does not bypass authorization or replace explicit evidence.

A top-level delivery question must not discard relevant surrounding thread context merely because its intent is recognized deterministically.

## Evaluation

A private human-authored delivery report may be used as a gold reconstruction target only in the evaluator. The production answer path must reconstruct the report from the declared source corpus without retrieving the gold report itself.

For a representative report:

- capability-theme recall is at least 85%;
- materially evidenced initiative recall is at least 80%;
- every material claim has at least one resolvable authorized citation;
- unsupported `observedOutcome` count is zero;
- unlabelled `inferredImpact` count is zero;
- authorization pass rate is 100%;
- coverage, freshness, source failure, and inference are disclosed; and
- human usefulness is at least 4 out of 5 for the exact answer fingerprint.

Evaluation compares source ablations:

1. Jira plus GitHub;
2. Jira, GitHub, and Vault;
3. Jira, GitHub, Vault, Teams, and attributed human corrections.

The comparison identifies whether a missing section is caused by source coverage, entity mapping, delivery-chain reconstruction, outcome interpretation, retrieval, or composition.

## First-Value Milestone

Given an already synchronized project and a fixed 30-day interval, reconstruct a cited report from Jira, approved GitHub repositories, and configured Vault roots before expanding historical depth. The result must:

- enumerate the complete bounded candidate population;
- group work into ratified or reviewable capabilities;
- include implementation and non-feature delivery work;
- separate observed outcomes, attributed impact, inferred impact, and unknowns;
- disclose missing Teams or human context rather than invent it; and
- receive a human usefulness score of at least 4 out of 5.

This milestone proves product value without claiming the final historical-bootstrap or continuous-convergence acceptance is complete.

For the first private-workspace milestone, an authorized quarterly planning snapshot
is the declared-intent source. A supported operator command imports it into production
Postgres through the hosted Sarathi surface. The weekly alignment answer uses the
persisted plan as its setpoint, groups planned and observed work by named initiative,
and puts source links after the feature summary.

## Exit Criteria

- Arbitrary calendar and sprint intervals compile to tested boundaries and propagate the selected report mode and timeout budget end to end.
- Period membership uses delivery-chain completion semantics rather than generic update time.
- The complete candidate census is built before ranking and exposes coverage and source-failure metadata.
- Cross-source duplicates collapse into one change capsule without losing contributing citations.
- Capability and initiative mapping supports private declarations, evidence-backed candidates, corrections, and confidence.
- Outcome assertions preserve observed, claimed, and inferred evidence classes.
- Structured and leadership report composition use distinct schemas and prompts from fast operational answers.
- The private gold reconstruction meets all declared automated and human thresholds.
- Real Teams reports are source-supported, useful, authorization-safe, and linked to exact evaluation evidence.

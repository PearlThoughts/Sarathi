# ADR 0009: Evidence-First Period Reporting

## Status

Accepted for implementation in the existing production-pilot child capability.

## Context

Sarathi can synchronize and retrieve authorized Jira, Vault, GitHub, and Teams evidence, but a cited retrieval result is not necessarily a complete delivery report. Top-k structured or semantic retrieval favors the newest or most similar records and can omit initiatives, contributors, operational work, compliance changes, launches, maintenance, and cross-repository delivery.

The same change may appear as a Jira issue, pull request, commits, reviews, checks, deployment, and Teams discussion. Counting or summarizing these records independently duplicates work. Conversely, a merged change is not proof that it was released, deployed, accepted, or produced a business impact.

A strong human Delivery Manager first forms a population of relevant work, reconciles it into initiatives and capabilities, distinguishes delivery stages and business outcomes, identifies missing context, and then writes the narrative. Sarathi must reproduce that reasoning boundary without inferring a person's private mental state or adding another data platform.

This decision affects query planning, persistence, projection, retrieval, model composition, response modes, evaluation, private workspace configuration, and production acceptance.

## Decision

Build every weekly, sprint, monthly, quarterly, or explicit-period report from an authorized structured census before relevance ranking or prose generation.

### Census before ranking

Create a deterministic `PeriodCensus` over the complete declared source, workspace, and time boundary. The census paginates to exhaustion within configured safety bounds and records candidates, exclusions, duplicates, unmapped records, unavailable sources, freshness, coverage, and a replay checksum.

Any incomplete pagination or required-source failure makes the report partial. A model or top-k retriever cannot upgrade partial coverage to complete.

### Cross-source change identity

Normalize delivery evidence into versioned `ChangeCapsule` records centered on a merged pull request when one exists, with explicit fallbacks for changes delivered outside a pull request. Join declared intent, work items, commits, changed paths and symbols, reviews, checks, releases, deployments, rollbacks, acceptance, contributors, and citations.

Commits and source records enrich the change; they are not separate delivered outcomes when they represent the same work.

### Capability and initiative organization

Maintain a private-configurable `CapabilityLedger` that maps business and platform capabilities, initiatives, aliases, goals, ownership assertions, repositories, modules, work items, requirements, and corrections. Declared mappings outrank inferred mappings. Inferred mappings require multiple signals, retain confidence, and remain reviewable.

### Delivery and outcome truth

Represent planned, implemented, reviewed, merged, checked, released, deployed, accepted, and impact-observed stages independently. Period membership uses a declared completion-stage rule rather than ingestion time or generic source update time.

Classify outcome statements as:

- directly observed outcomes;
- attributed impact claims;
- labelled model-assisted inferences; or
- explicit unknowns.

Do not render inferred benefits as observed outcomes.

### Retrieval and model role

Use structured delivery queries to build the census and delivery chains. Use exact, full-text, vector, and bounded relation retrieval afterward to enrich capsules with rationale, terminology, decisions, and context.

Model composition receives an authorized `PeriodDeliveryReport` envelope. It may organize and compress the evidence, but it cannot add census members, hide coverage failures, promote inferences, or remove material citation requirements.

The envelope may derive a Sprint Review and Outlook projection from Jira membership history and the same cross-source capsules. This projection distinguishes planned-at-start, added, completed, rolled-over and dropped work, then aligns current-sprint episodes to exact Strategy Kernel initiative identities with explainable Green, Amber, Red or Unknown health.

There is no deterministic report publication fallback. Composition is retried within the report budget, but any terminal provider, timeout, structural, citation, or quality failure yields only a privacy-safe `SARATHI-REPORT-COMPOSITION-FAILED` notice and a failed operation. Jira `Done` is development-ready, not stakeholder acceptance.

### Response products

Keep distinct response products:

- a concise operational answer;
- a coverage-aware period brief;
- a completeness-first leadership report; and
- a revision-specific implementation investigation.

The selected product and its timeout budget propagate from Teams ingress through planning, execution, validation, and composition. A broad question is not silently forced into the fast-answer line or timeout budget.

### Evaluation

Use a private human-authored report as an evaluator-only reconstruction target. The production answer path cannot retrieve the gold report.

Measure capability-theme recall, materially evidenced initiative recall, material-claim citation coverage, unsupported observed outcomes, unlabelled inferences, source/period coverage, freshness, authorization, latency, and fingerprint-bound human usefulness. Use source ablations to distinguish missing evidence from mapping, reconstruction, retrieval, or composition failures.

## Consequences

### Positive

- Period completeness becomes measurable rather than implied by citation count.
- Cross-source representations collapse into one delivery change without losing provenance.
- Business-capability reporting can span repositories and work systems.
- Merged, deployed, accepted, and impact-observed states remain honest and independently cited.
- Embeddings and model synthesis remain valuable for interpretation without owning delivery truth.
- Human corrections improve mappings and claims without rewriting source observations.
- Sparse but well-cited answers can no longer pass leadership-report acceptance.

### Negative

- Exhaustive bounded census and cross-source joins cost more than a small top-k query.
- Capability mappings and ambiguous changes require a private review and correction workflow.
- Report schemas, response budgets, and evaluation are more complex than one generic answer composer.
- Some plausible business impacts remain unknown or visibly inferred until human or operational evidence exists.
- Historical reconstruction quality depends on source link coverage and may expose gaps that require attributed human context.

## Alternatives Considered

- **Top-k structured and vector retrieval followed by summarization**: rejected because relevance ranking cannot prove population completeness or deduplicate one delivery change across sources.
- **Embed every repository revision and ask a model to infer the report**: rejected because embeddings do not establish delivery stage, time membership, authorization, or observed business impact and would expand cost and deletion obligations.
- **Use only Jira as the delivery ledger**: rejected because implementation, review, deployment, operational, and tacit evidence is distributed across GitHub, Vault, and Teams.
- **Use only pull requests as delivered work**: rejected because launches, compliance, operations, configuration, maintenance, and acceptance may not map one-to-one to pull requests.
- **Let a model generate capability taxonomy and impact without review**: rejected because inferred boundaries and benefits would be presented with unjustified authority.
- **Add a graph database or reporting warehouse**: rejected because PostgreSQL relations, projections, full-text search, and pgvector can support the bounded model without another consistency and authorization boundary.
- **Continue human-only report preparation**: retained as the quality oracle but rejected as the product path because it does not provide continuous, repeatable, source-supported delivery answers.

## Rollback

Deploy the prior application revision and disable the new period-report projections and composer. Leave additive tables unused. Existing synchronized evidence, delivery projections, knowledge passages, citations, and checkpoints remain intact. Restore PostgreSQL only through the verified backup path.

## References

- [AI Delivery Assistant Intelligence](../../specs/005-knowledge-layer/spec.md)
- [Evidence-First Period Delivery Reporting](../../specs/005-knowledge-layer/period-delivery-reporting.md)
- [Code-Derived Delivery Intelligence](../../specs/005-knowledge-layer/code-delivery-intelligence.md)
- [ADR 0007: Delivery Intelligence as the Primary Project Model](./0007-delivery-intelligence-projection.md)
- [ADR 0008: Continuous Project Intelligence Synchronization](./0008-continuous-project-intelligence-synchronization.md)

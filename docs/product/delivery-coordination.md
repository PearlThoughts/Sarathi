# Delivery Coordination

This document defines Sarathi's capability-first product experience for understanding what a team delivered, what is moving, and what needs intervention across periods of 30 days or less.

## Product Outcome

Sarathi should let an authorized team member ask ordinary delivery questions without knowing which source contains the answer:

- What did we deliver yesterday, last week, or in the last 30 days?
- What is planned or in progress this week?
- Which product or business capabilities changed?
- What reached QA, production, or stakeholder acceptance?
- Who is waiting for whom, and what action will unblock the work?
- Which work is not connected to a governed initiative?
- Where does the intended execution plan disagree with current activity?

The answer should read like an experienced delivery manager's operating update, not a search result, chat transcript, or ticket export.

## Product Model

### Initiatives provide direction

Each workspace supplies a governed set of goals, initiatives, commitments, and capability names. These establish the language used to organize recent work. They may originate in a strategy kernel, a workspace pack, a planning artifact, or a synchronized source, but they must become typed workspace intent before they control reporting.

### Delivery episodes provide meaning

A delivery episode consolidates related activity into one meaningful change or coordination thread. Examples include a feature rollout, migration, defect resolution, reporting cutover, client-feedback iteration, or cross-repository release.

An episode may span several messages, Jira changes, commits, pull requests, documents, meetings, deployments, and validations. The product presents the episode once at the capability level and retains the underlying references for inspection.

### Lifecycle provides current state

Recent work is reconstructed through a shared delivery lifecycle:

`scoped → implementing → development-ready → QA → production → accepted`

Workspaces may refine labels, but they must preserve the distinction between implementation completion, deployment, validation, and acceptance. A source's word “done” does not automatically select the terminal state.

### Dependencies explain motion

Human and operational dependencies are first-class:

- waiting actor;
- awaited actor, team, system, or approval;
- wait start;
- requested action;
- affected episode or initiative;
- latest status.

This supports questions about bandwidth, handoffs, approvals, QA queues, access, and cross-repository release order without reducing people to productivity scores.

## Source Roles

Sarathi does not assume one canonical delivery source. It assigns each connected source a role:

- planning artifacts and the strategy kernel express broad intent and commitments;
- Jira or another tracker expresses the intended executable plan;
- Teams channels, meeting chats, and bounded email express live decisions, handoffs, clarifications, approvals, and waiting states;
- repositories and CI express implementation and integration activity;
- Vault or project documentation expresses architecture, requirements, QA plans, demos, and durable context;
- deployment systems express environment changes and release activity.

Source records remain attributed and correctable. The user-facing report should not force the reader to reconcile them manually.

## Recent-Period Answer Contract

For 24-hour, 7-day, and 30-day questions, the default response has four sections:

1. **Delivered** — capability-level changes that reached the completion level relevant to the question.
2. **In progress** — current work and its latest meaningful lifecycle state.
3. **Waiting or blocked** — active human, approval, access, QA, deployment, or technical dependencies.
4. **Decisions needed** — conflicts, unaccounted work, stale execution records, or choices requiring an operating owner.

The response should:

- group related changes under enterprise or product capabilities;
- merge repeated progress messages into the latest state;
- include named brands, launches, clients, or outcomes when the workspace permits them;
- keep uncertainty only when it changes an operational decision;
- put Jira, pull-request, repository, document, email, and message references in a compact footer or behind capability items;
- use Teams-compatible headings, bold labels, bullets, and numbered actions;
- avoid source-count boilerplate, repeated provenance language, raw chat fragments, and generic “impact unknown” sentences.

Fast questions may use a short acknowledgement. Deep synthesis is governed by completeness and operational usefulness, not an artificial ten-second or line-count limit.

Weekly, sprint, recent-period, and leadership reports use model composition over the accepted structured delivery envelope. A recent-period report may take roughly 40–60 seconds. Provider, timeout, structure, citation, source-completeness, or quality failure publishes only the short safe failure notice; Sarathi does not substitute deterministic capsules, raw source rows, or partial report prose.

## Sprint Review And Outlook

A Sprint Review and Outlook is the sprint-shaped projection of the same delivery episodes. It covers:

- exact previous- and current-sprint identity and dates;
- work planned at the previous sprint boundary;
- work added during the sprint;
- completed, rolled-over, and dropped or superseded work;
- current ownership, lifecycle state, meaningful movement, and explainable health;
- alignment to the governed initiative set, including gaps and initiatives with no current-sprint activity;
- active waits and decisions; and
- advisory Jira hygiene corrections.

The report consolidates authorized Jira, Teams, Vault, strategy, and code activity by capability. It does not present those systems as independent activity inventories.

## Jira And Execution-Plan Hygiene

Sarathi treats Jira-like systems as the intended execution plan and a target for improvement, not as infallible reality.

The product should identify:

- material activity without a corresponding work item;
- active tickets contradicted by newer delivery state;
- missing owners, acceptance criteria, sprint placement, or validation;
- work discussed and implemented before ticket creation;
- stale or duplicate items that need an owner decision;
- initiative work that exists only in conversation.

Sarathi should initially propose corrections for human confirmation. Approved action capabilities may later create or update records through explicit workspace policy.

## User Surfaces

Microsoft Teams is the primary conversational surface, but it is not the product boundary. The same delivery episode and dependency models support or are intended to support:

- on-demand questions;
- daily delivery briefs;
- weekly operating reviews;
- leadership summaries;
- drift and source-hygiene reviews;
- future approved action cards.

These products reuse the same project model and differ by period, audience, detail, and actionability.

Current inbound availability is limited to explicitly mapped standard channels and actors. Meeting/group-chat source ingestion is broader than answering support, and private/shared-channel answering is not production-ready.

## Product Boundary

Sarathi is not:

- a raw meeting or chat summarizer;
- a ticket, commit, or pull-request reporter;
- a generic enterprise search product;
- a hidden people-scoring system;
- an autonomous delivery manager;
- a replacement for the team's planning and execution systems.

Sarathi turns fragmented work signals into a coherent and correctable operating picture. Humans continue to own commitment, priority, trade-offs, client communication, and final acceptance.

## Success Criteria

This capability succeeds when:

- a 24-hour, 7-day, or 30-day answer covers the material capability changes with little delivery-manager editing;
- repeated source activity is consolidated rather than listed;
- implementation, QA, production, and acceptance are not conflated;
- active waiting states have an owner and next action;
- unaccounted work and execution-plan drift become visible early;
- the operating owner spends materially less time reconstructing status and routing people.

## Related Architecture

Read [Delivery Synthesis Architecture](../architecture/delivery-synthesis.md) for the implementation boundaries that support this product contract.

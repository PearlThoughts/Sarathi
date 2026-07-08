# Intent And Evidence Graph

This document defines Sarathi's core data model: a typed graph that links strategic intent, execution evidence, human ratification, projections, and accountability actions.

## Design Goals

The data model must:

- work locally on SQLite and promote to Postgres for hosted environments,
- keep source-system records separate from Sarathi-owned intent,
- preserve provenance for every inferred claim,
- support graph-style traceability without requiring a graph database in v1,
- make private workspace data separable from public product code,
- support human ratification before inferred intent becomes policy.

## Storage Approach

Use relational tables with explicit edge records:

- SQLite for local development and single-user/local operation.
- Postgres for Railway-hosted development and production.
- Conservative SQL and migrations that run against both until portability becomes a burden.
- Vector indexes only for semantic retrieval; never as canonical truth.

If SQLite/Postgres compatibility starts constraining the domain model, prefer Postgres everywhere rather than weakening the architecture.

## Core Entities

```text
organization
workspace
workspace_relation
actor
workspace_actor_role
external_system
external_resource_mapping

intent_node
intent_edge
evidence_item
extracted_claim
projection
accountability_action
kernel_event
drift_finding
```

Derived records inherit visibility from their sources. An extracted claim, candidate intent node, projection, accountability action, or review item must default to the most restrictive visibility of the evidence and intent it references unless an authorized human explicitly downgrades sensitivity through the workspace policy process.

## Intent Nodes

`intent_node` stores Sarathi-owned intent:

```text
id
workspace_id
kind                 goal | commitment | bet | decision | assumption | risk | kpi | capacity_reservation | policy
title
body
owner_actor_id
state                candidate | ratified | active | at_risk | kept | broken | dropped | superseded | archived
horizon_start
horizon_end
due_at
success_signal
visibility           private | leadership | team | stakeholder | public
origin_evidence_id
created_by           human | sarathi | import
created_at
updated_at
```

Intent nodes are not Jira issues. They may be projected into Jira when execution work needs to become team-visible.

## Intent Edges

`intent_edge` stores typed graph relationships:

```text
from_node_id
to_node_id
type                 supports | blocks | supersedes | part_of | threatens | evidences | implements | depends_on | owns
confidence
created_at
created_by
```

Edges allow Sarathi to answer:

- which commitments support a goal,
- which risks threaten a commitment,
- which Jira issues implement a commitment,
- which decisions superseded an earlier strategy,
- which evidence supports or contradicts an intent node.

## Evidence Items

`evidence_item` stores observed source artifacts:

```text
id
workspace_id
source_system        teams | email | meeting | jira | github | ci | vault | manual
source_type          message | thread | issue | pull_request | commit | transcript | note | event
external_id
external_url
actor_id
occurred_at
title
body_excerpt
content_hash
visibility
ingested_at
```

Evidence is not automatically true. It is material Sarathi can cite, summarize, and use to propose extracted claims.

Evidence storage should prefer durable references, excerpts, hashes, and metadata over unnecessary full-content copies. Workspaces that need full-content retention must define retention, redaction, and deletion policy before ingestion is enabled.

## Extracted Claims

`extracted_claim` stores candidate interpretations:

```text
id
evidence_item_id
workspace_id
claim_type           possible_goal | possible_commitment | possible_decision | blocker | risk | status_update | ownership_signal
text
suggested_owner_id
suggested_due_at
confidence
state                pending | accepted | edited | rejected | merged
ratified_node_id
created_at
```

Claims become intent nodes only after acceptance or edit by an authorized human.

## Projections

`projection` maps Sarathi state to external systems:

```text
id
workspace_id
intent_node_id
target_system        jira | teams | github | vault | email
target_type          issue | epic | card | note | pull_request | message
target_id
target_url
last_published_hash
last_verified_at
drift_status         in_sync | missing | stale | conflicting | unauthorized
```

Projection drift is a first-class finding. If Sarathi says a commitment exists and Jira does not, Sarathi should ask the workspace owner to correct the gap.

## Accountability Actions

`accountability_action` tracks human follow-through:

```text
id
workspace_id
intent_node_id
actor_id
channel              teams_dm | teams_channel | email | manual
state                pending | sent | acknowledged | blocked | done | silent | escalated | cancelled
due_at
last_nudged_at
escalation_level
evidence_required
completion_evidence_id
```

The bot should chase accepted commitments, not arbitrary messages. A person can reject, edit, reassign, block, or complete with evidence.

## Kernel Events

`kernel_event` is the append-only audit stream:

```text
id
workspace_id
actor_id
entity_type
entity_id
action               harvested | ratified | edited | rejected | published | verified | drift_detected | nudged | escalated | superseded
payload_json
occurred_at
```

Current-state tables can be rebuilt or audited against this event stream.

## Data Ownership Rule

Sarathi owns intent and accountability state. Source systems own their native records:

- Jira owns execution collaboration and task workflow.
- Teams owns conversation and bot interaction.
- GitHub owns code and review evidence.
- Vault or policy repositories own human-readable governance records.

Sarathi reconciles these systems instead of replacing them.

# Workspace Operating Model

This document defines how Sarathi models a single-tenant organization with multiple workspaces, where each workspace can represent a project, product, client account, initiative, or operating unit.

## Deployment Model

Sarathi is single-tenant per deployment:

```text
Sarathi deployment
└── Organization
    ├── Workspace
    ├── Workspace
    └── Workspace
```

A deployment serves one organization. It does not need SaaS-style customer tenancy fields for v1. It does need workspace boundaries because each project or operating unit can have different systems, roles, goals, maturity, and accountability policy.

## Workspace Definition

A workspace is the boundary where Sarathi reasons about delivery alignment. A workspace can map to any combination of:

- Teams team, channel, group chat, or meeting chat,
- Jira project, board, sprint, version, epic, initiative, or JQL filter,
- GitHub organization, repository set, PR labels, or code owner scopes,
- vault folder, policy repository, or documentation packet,
- meeting transcript source,
- external stakeholder or client account context,
- staffing or capacity source.

The organization chooses the boundary. Sarathi should not force all teams into the same project hierarchy.

## Workspace Topology

Workspaces are isolated by default. A new workspace starts as its own reasoning, evidence, policy, projection, and reporting boundary. Sarathi should not assume that every organization has one clean tree of projects.

When a workspace needs to collaborate with or roll up into another workspace, Sarathi records that explicitly as a `workspace_relation`. Relations can represent containment, dependency, peer collaboration, shared policy, or approved synthesis into a portfolio/leadership workspace. This gives Sarathi a graph-shaped operating model without forcing every deployment to use graph semantics on day one.

Tree-shaped systems such as nested project trackers can be imported as `contains` relations, but Sarathi should not treat nesting as the only relationship available. A workspace can depend on another workspace, share a policy with one workspace, and synthesize approved summary fields into a third workspace without merging their raw evidence.

Cross-workspace collaboration is therefore an explicit opening of a boundary, not the default. The first implementation should support disconnected workspaces, then add controlled synthesis paths that prove visibility and source authorization before any context crosses a workspace boundary.

## Workspace Roles

Common workspace roles include:

- **Operating Owner:** accountable for workspace health and course correction.
- **Delivery Manager / PM:** manages the daily operating loop and ratifies delivery intent.
- **Technical Lead:** owns technical feasibility, delivery risk, and engineering evidence.
- **Contributor:** accepts work commitments and provides evidence.
- **Stakeholder:** supplies goals, feedback, acceptance signals, or external constraints.
- **Sarathi:** observes, proposes, reconciles, reminds, and reports. Sarathi does not own decisions.

Role names can be customized per workspace, but the responsibility boundaries should remain explicit.

## Database Workspaces And Workspace Packs

Sarathi stores workspaces as database entities for runtime state. A workspace pack is a versioned configuration bundle that declares how a workspace should be connected, projected, and governed.

Database state is live operational truth:

- workspace records,
- actors and roles,
- intent nodes and edges,
- evidence items,
- ratification events,
- projections,
- accountability actions,
- drift findings.

Workspace packs are desired configuration:

- source mappings,
- role mappings,
- policy overrides,
- visibility rules,
- projection templates,
- seed goals and commitments,
- report templates.

This split keeps runtime state queryable while making boundary choices reviewable in git.

Pack loading is reconciliation, not blind overwrite. A workspace pack may create missing configuration, propose seed intent, and tighten policy. It must not silently overwrite ratified runtime intent, completed accountability actions, or human-edited decisions. When pack state and database state conflict, Sarathi should create a drift finding or review item for an authorized human to resolve.

Messages, channel mappings, emails, vault notes, Jira issues, GitHub PRs, and meeting transcripts enter Sarathi as `evidence_item` records or external resource mappings. The canonical record should store source metadata, durable external IDs or URLs, excerpts, hashes, sensitivity labels, and retention policy signals before storing full content. Embeddings and vector indexes may support semantic retrieval, but they are derived indexes only. The Strategy Kernel, evidence records, events, and projections remain canonical truth.

Action-card clicks, acknowledgement choices, blockers, completion evidence, silence, and escalations are recorded as `kernel_event` entries and folded into `accountability_action` state. This lets Sarathi learn which prompts are useful without turning raw chat into unratified truth.

## Public And Private Workspace Packs

The public repository may include synthetic workspace packs. Real organization packs should live in private repositories or private vaults when they contain sensitive names, client details, source-system IDs, or internal rationale.

Example private pack shape:

```text
workspaces/
└── example-workspace/
    ├── workspace.yaml
    ├── actors.yaml
    ├── mappings/
    │   ├── jira.yaml
    │   ├── teams.yaml
    │   ├── github.yaml
    │   └── vault.yaml
    ├── policies/
    │   ├── accountability.yaml
    │   ├── deploy-readiness.yaml
    │   ├── qa-evidence.yaml
    │   └── visibility.yaml
    ├── seeds/
    │   ├── goals.yaml
    │   ├── commitments.yaml
    │   └── bets.yaml
    └── templates/
        ├── daily-delivery-brief.md
        ├── drift-review.md
        └── client-update.md
```

## Workspace Lifecycle

1. **Discover:** ingest available source-system topology.
2. **Draft:** generate a proposed workspace map.
3. **Ratify:** authorized humans approve or correct boundaries.
4. **Publish:** create or update projections in team-visible systems.
5. **Verify:** compare Sarathi state with Jira, Teams, GitHub, and vault records.
6. **Review:** surface drift and ask the operating owner to keep, renegotiate, drop, or escalate.

The ratified workspace definition becomes the baseline for future drift detection.

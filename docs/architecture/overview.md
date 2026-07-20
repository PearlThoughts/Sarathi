# Architecture Overview

This document explains Sarathi's first implementation slice: a policy-bounded AI Delivery Assistant platform that compiles team context before any agent sees or acts on work data.

## Runtime Shape

Sarathi follows a domain-first hexagonal structure:

- `src/domain`: shared policy primitives such as sensitivity and trust tiers.
- `src/modules/*`: bounded contexts with a public `index.ts`, then `domain`, `application`, `ports`, and `api` layers only when needed.
- `src/modules/boundary-policy`: the policy gate for trust tier, sensitivity, delegation stage, approval, and model egress.
- `src/modules/delivery-intelligence`: canonical project objects, relationships, observations, claims, metrics, conflicts, query grammar, product profile, and answer orchestration for the AI Delivery Assistant.
- `src/modules/knowledge-layer`: versioned documents, passages, provenance, deletion reconciliation, full-text/vector retrieval, and citations supporting delivery intelligence.
- `src/modules/follow-up`: generic due-item planning and exception digest primitives.
- `src/modules/messaging`: Teams-ready message contracts and delivery ports.
- `src/modules/workspace-model`: source-system and YAML overlay compilation.
- `src/modules/identity-access`: auth and authorization contracts.
- `src/infrastructure`: Better Auth, YAML, and policy adapters.
- `src/platform`: Hono runtime, configuration, source fixtures, and route registration.

See [Module Boundaries](./module-boundaries.md) for the capability layout and import rules.

The first production-critical invariant is:

> Authorization must happen before retrieval, before tool invocation, and before model egress.

Connector and context-assembly work must call the boundary-policy capability before retrieving source context, invoking tools, or sending model-visible output.

## Source Systems

Sarathi should infer what it can from the systems a team already uses:

- Microsoft Teams: communication topology, channel purpose, discussion/incident signals.
- Linear or Jira: execution ownership, project workflow, triage state.
- GitHub: code ownership, review surfaces, repository boundaries.

Inferences are not enough. YAML overlays provide explicit corrections, boundary declarations, and sensitivity overrides.

## Current Implementation Boundary

The repository includes hosted Microsoft Teams ingress, Microsoft Graph, Jira, GitHub, Vault projection, model, Postgres audit, workspace-resolution, compliance-reminder, and context-assembly adapters. Their presence does not make every deployment ready: each capability still requires authorized private configuration, runtime composition, capability-specific readiness, and real acceptance evidence.

The delivery-intelligence contracts and Strategy Kernel define a broader product than the currently proven production paths. Delivery intelligence organizes project operating data so Sarathi can answer the ordinary questions directed to a PM or Delivery Manager. Internal workspace reports are automatic; external publication and mutating actions remain human-governed.

## Strategic Execution Relationship

The existing Strategy Kernel remains the command-side model for Sarathi-owned intent and follow-through. It does not sit above delivery intelligence as a second reporting graph. Its relevant records project into the same delivery object/relation/claim model used for Jira, Vault, Teams, email, and GitHub:

- workspaces define project, product, client, initiative, or operating-unit boundaries inside one installed organization,
- intent nodes provide goals, commitments, decisions, risks, assumptions, policies, and capacity declarations,
- connected source records provide observed Teams, email, meeting, Jira, GitHub, CI, and Vault activity,
- delivery relationships connect goals and commitments to risks, decisions, ownership, dependencies, and execution work,
- projections reconcile Sarathi-owned intent with systems such as Jira, Teams, GitHub, and vault notes,
- accountability actions project as owned delivery actions and follow-through state.

Reporting never requires ratification of every connected record. Source events are trusted as occurrences, statements remain attributed claims, conflicting claims stay visible, and only external publication or mutating actions require human review.

This extension is documented in [Workspace Operating Model](./workspace-operating-model.md), [Intent And Evidence Graph](./intent-evidence-graph.md), and [Strategic Execution Loop](../implementation/strategic-execution-loop.md).

The relationship between one deployment, multiple isolated workspaces, and reusable capability profiles is documented in [Workspace And Capability Model](./workspace-capability-model.md).

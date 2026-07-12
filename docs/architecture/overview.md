# Architecture Overview

This document explains Sarathi's first implementation slice: a policy-bounded AI Delivery Assistant platform that compiles team context before any agent sees or acts on work data.

## Runtime Shape

Sarathi follows a domain-first hexagonal structure:

- `src/domain`: shared policy primitives such as sensitivity and trust tiers.
- `src/modules/*`: bounded contexts with a public `index.ts`, then `domain`, `application`, `ports`, and `api` layers only when needed.
- `src/modules/boundary-policy`: the policy gate for trust tier, sensitivity, delegation stage, approval, and model egress.
- `src/modules/delivery-assistant`: public role, team-profile, audience-scope, and policy-artifact contracts for the AI Delivery Assistant product.
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

The delivery-assistant contracts and Strategy Kernel define a broader product than the currently proven production paths. Sarathi assists the PM or operating owner; it does not replace them.

## Strategic Execution Extension

The long-term product architecture adds a Strategy Kernel above the existing evidence and policy boundaries:

- workspaces define project, product, client, initiative, or operating-unit boundaries inside one installed organization,
- intent nodes store ratified goals, commitments, bets, decisions, risks, assumptions, KPIs, and capacity reservations,
- evidence items store observed Teams, email, meeting, Jira, GitHub, CI, and vault artifacts,
- intent edges connect goals to commitments, risks, decisions, and execution evidence,
- projections reconcile Sarathi-owned intent with systems such as Jira, Teams, GitHub, and vault notes,
- accountability actions track accepted owner follow-through and escalation state.

This extension is documented in [Workspace Operating Model](./workspace-operating-model.md), [Intent And Evidence Graph](./intent-evidence-graph.md), and [Strategic Execution Loop](../implementation/strategic-execution-loop.md).

The relationship between one deployment, multiple isolated workspaces, and reusable capability profiles is documented in [Workspace And Capability Model](./workspace-capability-model.md).

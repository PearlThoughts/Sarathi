# Sarathi Documentation

Sarathi documentation has two audiences:

- product reviewers who need the why/what/how before implementation is complete,
- contributors who need the current architecture and module boundaries.

## Product Docs

- [Operating Thesis](product/operating-thesis.md) captures the durable product identity, control loop, authority model, and guardrails.
- [Why Sarathi](product/why.md) explains the delivery coordination problem.
- [What Sarathi Is](product/what.md) defines the AI Delivery Assistant role and visible coordination surfaces.
- [Strategic Execution Advisor](product/strategic-execution-advisor.md) defines the long-term intent/evidence/accountability control plane.
- [How Sarathi Works](product/how.md) describes workspaces, policy repo, evidence plane, and learning.
- [Roles And Boundaries](product/roles-and-boundaries.md) separates team-visible, PM/leadership, and agent scopes.
- [Market Positioning](product/market-positioning.md) compares Sarathi with Claude Tag, enterprise AI assistants, AI SRE, delivery analytics, standup bots, and coding agents.
- [Open Source Release Model](product/open-source-release.md) explains Apache-2.0, release readiness, and commercial/open-core options.
- [Roadmap](product/roadmap.md) shows the WIP sequence and first wedge.

## Implementation Docs

- [Architecture Overview](architecture/overview.md) describes the system shape.
- [Workspace And Capability Model](architecture/workspace-capability-model.md) defines one runtime, isolated workspaces, capability profiles, and controlled synthesis.
- [Module Boundaries](architecture/module-boundaries.md) defines capability boundaries and import rules.
- [Identity And Boundaries](architecture/identity-and-boundaries.md) explains the Better Auth/Sarathi policy split.
- [Workspace Operating Model](architecture/workspace-operating-model.md) defines single-tenant organization and multi-workspace boundaries.
- [Intent And Evidence Graph](architecture/intent-evidence-graph.md) defines the core relational graph model.
- [Workspace Overlay](implementation/workspace-overlay.md) documents the Teams/Linear/GitHub model.
- [Strategic Execution Loop](implementation/strategic-execution-loop.md) specifies observe, infer, ratify, publish, verify, chase, and review.
- [Public And Private Boundary](implementation/public-private-boundary.md) defines what belongs in the open repo versus private workspace packs and vaults.
- [Production Readiness Standard](standards/production-readiness.md) defines implemented, composed, configured, deployed, healthy, ready, and accepted states.
- [ADR 0005](adr/0005-single-runtime-private-overlays.md) records the single-runtime and private-overlay decision.
- [Test Index](../tests/TEST-INDEX.md) lists verification commands and test scope.

## Current Capabilities

- Compile a workspace model from observed source systems and explicit YAML overlays.
- Keep identity membership separate from sensitivity and model-egress policy.
- Expose a Hono API for health, foundation discovery, and workspace-model preview.
- Declare the AI Delivery Assistant role, team maturity dials, policy artifacts, and storage split as public domain contracts.
- Define strategic execution control-plane requirements, workspace packs, intent/evidence graph, and ratified accountability loops.

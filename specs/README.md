# Sarathi Specs

Sarathi keeps implementation specs in this repository when they describe buildable behavior, architecture contracts, and local verification.

Product strategy, launch positioning, naming, and commercial notes belong in SenG-Vault.

## Active Specifications

Specifications preserve the governed intent and acceptance contract at the time they were approved. They are not evergreen availability claims. Current deployed, channel, and evaluation status belongs in the linked architecture, readiness, and evaluation documentation.

- [Production Pilot Readiness](./001-production-pilot-readiness/spec.md) defines the community-safe capability, dependency, privacy, ownership, and verification contract for the internal production pilot.
- [Teams Mention Production](./002-teams-mention-production/spec.md) defines the sole team-facing production slice: a policy-bounded, grounded, same-thread answer to a direct Teams mention.
- [AI Delivery Assistant Intelligence](./005-knowledge-layer/spec.md) extends that accepted production slice with authorized continuous project synchronization, delivery projections, hybrid retrieval, adaptive cited answers, and optional live source verification. Its [Code-Derived Delivery Intelligence](./005-knowledge-layer/code-delivery-intelligence.md) sub-spec defines how repository evidence supports capability, ownership, rework, delivery-truth, and leadership-alignment analysis.
- [Bounded Teams Collaboration Scopes](./006-teams-collaboration-scopes/spec.md) defines workspace-neutral conversation identity, audience authorization, corpus boundaries, reply semantics, and fail-closed rollout for admitted standard channels, meeting or group chats, and private channels.
- [Product Capability Registry And Product Studio](./007-product-capability-registry/spec.md) defines Sarathi-owned business product identity, hierarchy, typed relations, variants, historical evolution, governed commands, and a Payload-based human editing surface.
- [Response-Level Human Feedback](./008-answer-feedback/spec.md) defines fingerprint-bound three-state product feedback, revision history, PostgreSQL persistence, Teams actions, privacy-safe aggregates, and the reviewed-training boundary without changing governed acceptance or source truth.
- [Product Capability Graph Exploration](./009-product-capability-graph-exploration/spec.md) defines the bounded, audience-safe 3D exploration, relationship, dossier, lens, history, delivery-projection, and accessible-view experience over that registry.

Current status: structured capability-first delivery reporting, the governed Product Capability Registry, and the initial Product Studio graph are implemented. Collaboration-scope availability remains governed by specification 006 and ADR 0010. Specification 009 governs the richer graph exploration implementation; deployed availability remains an operational claim that requires live evidence.

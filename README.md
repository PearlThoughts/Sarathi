# Sarathi

Sarathi is a work-in-progress, open-source **AI Delivery Assistant** and delivery-coordination platform for software teams.

It helps a PM, delivery manager, or operating owner keep goals, commitments, conversations, delivery work, and engineering evidence connected across Microsoft Teams, Jira, GitHub, email, meetings, and documentation. Sarathi answers grounded questions, prepares delivery reviews, follows up on accepted actions, surfaces drift, and preserves ratified delivery memory so humans can correct course earlier.

Sarathi is self-hosted and single-tenant per deployment. One installation can serve multiple isolated workspaces and capability profiles without turning every project or workflow into another bot.

## Project Status

Sarathi is no longer only a domain-model skeleton. This repository contains real hosted runtime paths, Microsoft Teams ingress, source adapters, persisted coordination state, and a proactive compliance-reminder capability.

It is not yet a turn-key production product. Code being implemented or deployed does not prove that a capability is configured, ready, or accepted in a particular organization. A real installation still needs private workspace mappings, renewable credentials, provider consent, deployment configuration, and capability-specific acceptance testing. See the [Production Readiness Standard](docs/standards/production-readiness.md) for the terminology used in this repository.

## Why

Delivery truth is commonly scattered:

- Teams has decisions, confusion, blockers, and informal status.
- Jira has planned work and team commitments, but only when it stays current.
- GitHub and CI contain engineering evidence.
- Documents and meetings contain goals, policies, and decisions.
- PMs and delivery managers carry the real operating model in their heads.

The result is not only expensive coordination work. It is silent drift: accepted priorities, client commitments, day-to-day conversations, Jira tickets, pull requests, QA evidence, and follow-up loops stop matching before anyone sees the gap.

Sarathi exists to make that gap visible early and route it through human-supervised course correction.

## Product Model

Sarathi runs one recurring control loop:

1. **Sense:** read authorized evidence from the systems where work already happens.
2. **Compare:** compare observed activity with ratified goals, commitments, decisions, policy, and expected cadence.
3. **Decide:** ask an authorized human to ratify, correct, renegotiate, reject, reassign, or escalate.
4. **Act:** answer, publish, remind, follow up, or report through policy-approved surfaces.

Sarathi proposes and remembers; humans ratify; source systems record. It assists the delivery owner rather than replacing one.

## Implemented Capabilities

### Grounded Microsoft Teams Mentions

The hosted Teams path includes:

- authenticated Microsoft Agents SDK ingress at `/api/messages`;
- direct-mention detection and same-thread replies;
- private workspace, channel, actor, trust-tier, and sensitivity resolution;
- bounded Microsoft Graph thread retrieval with renewable Entra credentials;
- read-only Jira, GitHub, and allowlisted Vault evidence readers;
- authorization before retrieval and before model egress;
- workspace-scoped evidence assembly with source links;
- an OpenAI-compatible grounded-answer adapter;
- Postgres-backed audit leases and duplicate suppression;
- a team-scoped Teams app manifest with resource-specific consent.

The composition fails closed when required private mappings or credentials are missing.

### Compliance And Operational Reminders

The proactive reminder path includes:

- workspace-scoped Jira selection for planning and exception digests;
- scheduled and operator-triggered dry-run workflows;
- proactive Microsoft Teams delivery with renewable Graph tokens;
- Postgres-backed idempotency, audit, retry eligibility, and delivery outcomes;
- explicit `disabled`, `shadow`, and `live` promotion modes;
- readiness that distinguishes a disabled capability from invalid configuration.

This is a reusable coordination capability, not a separate Finance product or runtime.

### Strategy And Delivery Coordination

The Strategy Kernel and operator workflows include:

- isolated workspaces plus typed workspace relations;
- goals, commitments, decisions, risks, bets, KPIs, policies, and capacity reservations;
- evidence and intent graphs with provenance and sensitivity inheritance;
- file-backed private workspace packs reconciled into durable state;
- SQLite persistence for local operation and Postgres repositories for hosted paths;
- read-only evidence-import contracts, hashes, consent metadata, and watermarks;
- inferred-intent inbox transitions and ratification audit events;
- projection verification and drift findings;
- accountability-action state, including evidence-required completion, silence, and escalation;
- workspace-scoped delivery briefs and drift reviews with leakage guards.

Interactive accountability cards, broader live ingestion, and organization-specific operating policies remain capability work rather than completed universal product behavior.

### Platform And Safety

The repository also provides:

- a Bun and Hono platform API;
- Better Auth-backed production identity for the platform surface;
- health and dependency-aware readiness endpoints for hosted Teams composition;
- Railway deployment and runtime verification commands;
- architecture boundary checks, dependency analysis, linting, type coverage, deterministic tests, and a tracked-file privacy scan;
- synthetic examples that exercise the product without publishing private organizational data.

## Architecture

One Sarathi deployment serves one organization. Workspaces are independently governed boundaries for intent, evidence, identities, actions, and reporting. Cross-workspace collaboration must be opened explicitly through typed relations and approved projections; it never implies unrestricted evidence access.

Reusable code, schemas, adapters, tests, and synthetic examples belong in this public repository. Real workspace identifiers, source mappings, schedules, recipients, allowlists, templates, and confidential policy belong in an organization-owned private overlay. Credentials remain in an approved secret manager, while evidence and transactional state remain in runtime storage.

Start with:

- [Operating Thesis](docs/product/operating-thesis.md)
- [What Sarathi Is](docs/product/what.md)
- [Workspace And Capability Model](docs/architecture/workspace-capability-model.md)
- [Architecture Overview](docs/architecture/overview.md)
- [Intent And Evidence Graph](docs/architecture/intent-evidence-graph.md)
- [Public And Private Boundary](docs/implementation/public-private-boundary.md)
- [Documentation Index](docs/README.md)

## Local Development

Install dependencies and run the full local CI-equivalent gate:

```bash
bun install
bun run check
```

Run the local Hono platform API:

```bash
bun run dev
```

The local API defaults to `http://localhost:3000`. Static identity is allowed only for local development. The production platform API requires Better Auth with Postgres-backed configuration.

Run the separately composed Microsoft Teams ingress after supplying its required private configuration and credentials:

```bash
bun run teams:ingress
```

The Teams ingress defaults to port `3978` and exposes `/api/messages`, `/health`, `/ready`, and an authenticated internal Finance dry-run endpoint. Validate the Teams package with:

```bash
bun run teams:manifest:validate
```

Runtime and Railway verification commands are exposed through the release CLI:

```bash
bun run runtime:health
bun run runtime:smoke
bun run deploy:railway:ci
```

Private deployment configuration is intentionally not included in this public repository.

## Feedback Wanted

Useful feedback includes:

- Which delivery-coordination loops are painful enough to self-host for?
- Which sources and evidence links make a delivery answer trustworthy?
- What should be team-visible versus PM- or leadership-only?
- Which interventions should happen in DM, a thread, an action card, or a private review?
- How should organizations express workspace intent when they use Jira epics, spreadsheets, docs, or informal Teams threads?
- Which production-readiness and privacy controls would you require before installing Sarathi?

## License

Sarathi is licensed under the [Apache License 2.0](LICENSE).

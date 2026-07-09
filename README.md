# Sarathi

Sarathi is a work-in-progress, open-source **AI Delivery Assistant** for software teams.

It helps a PM, delivery manager, or operating owner coordinate software delivery across Teams, Jira, GitHub, email, and docs. Sarathi answers routine questions, chases missing updates, drafts status, surfaces drift, preserves delivery memory, and compares ratified intent with observed execution evidence so humans can correct course earlier.

Sarathi is not production-ready yet. This repository is being opened early so delivery managers, software services teams, and AI-agent builders can critique the product shape before the implementation hardens.

## Why

In small software teams, delivery truth is scattered:

- Teams has decisions, confusion, blockers, and informal status.
- Jira has planned work, but only if people update it.
- GitHub and CI have the engineering evidence.
- PMs and delivery managers carry the real operating model in their heads.

The result is not only expensive coordination work. It is silent drift: accepted priorities, client commitments, day-to-day conversations, Jira tickets, PRs, QA evidence, and follow-up loops stop matching each other before anyone sees the gap.

Sarathi exists to make that gap visible early and route it through human-supervised course correction.

## What

Sarathi is one visible bot/app, usually used as `@Sarathi` in Teams or in DM, backed by a workspace-scoped delivery operating record.

It assists the delivery manager; it does not replace one. The human PM still owns client trust, prioritization, morale, trade-offs, and accountability. Sarathi handles the repeatable delivery coordination work around that human:

- initial delivery reviews over existing work systems,
- process FAQ for engineers and interns,
- weekly plan and status drafts,
- evidence-shaped chase loops,
- blocker and risk escalation,
- delivery drift detection,
- retrospective/pulse packs,
- ratified delivery memory,
- future MCP context for coding agents.

## How

Sarathi combines four layers:

1. **Workspace bindings** map Teams channels, Jira projects, GitHub repos, docs, and policy files into a delivery workspace.
2. **Strategy Kernel** stores ratified goals, commitments, decisions, risks, bets, KPIs, policies, and accountability state.
3. **Evidence plane** stores observed Teams/Jira/GitHub/CI events and source links in a queryable runtime store.
4. **Delivery loops** use that context to review delivery state, answer, chase, report, flag drift, and ask the PM to ratify changes.

Public docs start here:

- **Why should this exist?** Start with [Why Sarathi](docs/product/why.md).
- **What is Sarathi responsible for?** Read [What Sarathi Is](docs/product/what.md).
- **How does it work?** See [How Sarathi Works](docs/product/how.md).
- **What are the boundaries?** Review [Roles And Boundaries](docs/product/roles-and-boundaries.md).
- **How does it compare to other AI work products?** Read [Market Positioning](docs/product/market-positioning.md).
- **How is the open-source release framed?** See [Open Source Release Model](docs/product/open-source-release.md).
- **What is planned first?** Follow the [Roadmap](docs/product/roadmap.md).

## Current Implementation Slice

The code currently contains foundations, not the full product:

- Bun + Hono API service.
- Better Auth-facing identity boundary.
- Boundary-policy gate for sensitivity, trust tier, delegation stage, approval, and model egress.
- Generic follow-up digest primitives.
- Messaging contracts for Teams-ready messages and proactive delivery.
- YAML workspace overlay support for explicit boundaries over Teams, Linear, GitHub, and Jira-derived structure.
- Strategic kernel, intent projection, accountability action, and SQLite runtime foundations.
- Skeleton delivery assistant role and team-profile contracts.

## Commands

```bash
bun install
bun run check
bun run dev
```

Local development uses static no-session auth unless Better Auth env is configured. Production auth is still under active design; do not deploy this as a trusted production delivery assistant yet.

## License

Sarathi is licensed under the [Apache License 2.0](LICENSE).

## Feedback Wanted

This repo is intentionally early. Useful feedback:

- Which delivery loops are painful enough to self-host for?
- How should Sarathi model a client/project/team workspace?
- What should be team-visible versus PM/leadership-only?
- Which routines should happen in DM, a thread, or a private PM report?
- How should Sarathi capture project intent when teams use Jira epics, spreadsheets, docs, or informal Teams threads?
- What is the minimum useful skeleton before implementation catches up?

## Architecture Rule

Better Auth is used for identity, sessions, organization membership, team membership, and coarse app roles. Sarathi does not store sensitivity, source authorization, model egress, or tool approval solely as Better Auth roles. Those decisions are compiled from source systems plus policy files and enforced before retrieval, tool invocation, and model egress.

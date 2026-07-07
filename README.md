# Sarathi

Sarathi is a work-in-progress, open-source **AI Delivery Assistant** for software teams.

It is designed to help a PM or delivery manager keep delivery moving across Teams, Jira, and GitHub: answer routine team questions, chase missing updates, draft weekly status, surface drift, preserve delivery memory, and align work to PM-approved intent.

Sarathi is not production-ready yet. This repository is being opened early so delivery managers, software services teams, and AI-agent builders can critique the product shape before the implementation hardens.

## Why

In small software teams, delivery truth is scattered:

- Teams has decisions, confusion, blockers, and informal status.
- Jira has planned work, but only if people update it.
- GitHub and CI have the engineering evidence.
- PMs and delivery managers carry the real operating model in their heads.

The result is expensive coordination work: the PM chases updates, answers repeated intern questions, checks whether "done" is actually done, and prepares leadership or client status by stitching systems together manually.

Sarathi exists to reduce that coordination load under human supervision.

## What

Sarathi is one visible bot/app, usually used as `@Sarathi` in Teams or in DM.

It assists the delivery manager; it does not replace one. The human PM still owns client trust, prioritization, morale, trade-offs, and accountability. Sarathi handles the repeatable coordination work around that human:

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
2. **Policy repo** stores ratified intent, team profile, process FAQ, escalation rules, and learned preferences as Markdown/YAML in git.
3. **Evidence plane** stores observed Teams/Jira/GitHub/CI events and source links in a queryable runtime store.
4. **Delivery loops** use that context to answer, chase, report, flag drift, and ask the PM to ratify changes.

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
- Skeleton AI Delivery Assistant role and team-profile contracts.

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

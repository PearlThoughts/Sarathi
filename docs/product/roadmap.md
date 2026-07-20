# Roadmap

Sarathi is currently a work in progress. The roadmap is intentionally wedge-first.

## Now: Docs And Skeleton

- Make the product idea public and reviewable.
- Publish why/what/how docs.
- Publish example workspace and policy artifacts.
- Keep skeleton code honest about what exists.
- Ask delivery managers and software teams for feedback.

## Wedge: PM-Reviewed Delivery Review

First useful product loop:

- ingest one Teams/Jira/GitHub workspace,
- load a versioned workspace pack for source mappings and policies,
- maintain a small Strategy Kernel of ratified goals, commitments, decisions, risks, and bets,
- generate an initial delivery review over existing work signals,
- identify goals without work, work without goals, stale commitments, missing validation, and projection drift,
- draft a weekly status report,
- produce a daily delivery brief when the workspace needs active chasing,
- answer process FAQ from policy,
- chase missing updates/verification in DM,
- surface blockers, stale work, and missing QA,
- post internal delivery reports automatically within workspace policy; require review for external publication or mutating actions.

Kill metric:

> The PM can use the delivery review with minimal edits to correct Jira/Vault/Teams and spend materially less time chasing updates.

## Next: Delivery Alignment Loops

- project intent capture,
- inferred intent inbox,
- human ratification workflow,
- Jira/vault/Teams projection and verification,
- milestone and release tracking,
- RAID/risk register,
- incident follow-up,
- intern process navigator,
- maturity dials,
- retro/pulse pack and initial delivery-review pack.

## Next: Strategic Execution Advisor

- goals, commitments, bets, risks, decisions, KPIs, and capacity reservations as typed intent nodes,
- graph edges from intent to Jira, Teams, GitHub, CI, meeting, and vault verification,
- drift detection for goals without work, work without goals, stale commitments, missing validation, and projection conflicts,
- weekly drift review with keep, renegotiate, drop, escalate, and publish decisions,
- optional engineering telemetry import inspired by Apache DevLake-style SDLC models without making DevLake a v1 runtime dependency.

## Later: Agent Bridge

- remote MCP endpoint for Claude Code, Codex, OpenCode, and similar tools,
- human-authenticated context access,
- delivery-aware tools such as `get_work_context`, `current_intent`, and `report_work_event`,
- optional coding-session instrumentation for work-state signals such as repeated test failures, missing credentials, blocked dependencies, and drift from milestone intent,
- support for cloud coding agents only after service identity, disclosure, audit, source boundaries, and prompt-injection defenses are stronger,
- prompt-injection defenses for untrusted Teams/Jira/docs content.

## Not V1

- autonomous delivery management,
- client-facing account voice,
- hidden people scoring,
- multi-tenant SaaS control plane,
- Postgres/mem0/Glean dependency,
- broad generic enterprise search.

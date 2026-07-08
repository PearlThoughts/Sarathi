# Strategic Execution Advisor

This document defines Sarathi's long-term product requirement: a strategic execution advisor that helps one organization keep delivery work aligned with declared intent, verified evidence, and accountable follow-through.

## Product Thesis

Delivery teams rarely fail because one more task tracker is missing. They fail when stated priorities, client commitments, daily conversations, Jira work, code changes, and accountability loops drift apart without anyone seeing it early enough to intervene.

Sarathi is not another project management system. It is an intent and accountability control plane that works above the team's existing collaboration systems.

Sarathi should answer questions such as:

- What goals and commitments are active for this workspace?
- Which execution work supports those goals?
- Which goals have no visible work?
- Which Jira issues, PRs, or chat decisions are not linked to an accepted goal or commitment?
- Which commitments are aging without evidence?
- Which people or teams have accepted actions that are now silent, blocked, or overdue?
- Which strategy changes were made in conversation but never ratified in the durable record?
- What should the PM or operating owner correct, renegotiate, drop, or escalate?

## Non-Goals

Sarathi must not become:

- a replacement for Jira, Linear, Redmine, Plane, or OpenProject,
- a generic OKR ceremony tool,
- a hidden people-scoring system,
- an autonomous delivery manager,
- a client/account voice,
- a broad enterprise search product,
- a private tracker that diverges from team-visible systems.

Existing systems continue to own their natural responsibilities. Sarathi reconciles them.

## Declared Intent And Revealed Intent

Sarathi models two complementary forms of intent:

- **Declared intent:** goals, commitments, bets, KPIs, risks, decisions, capacity reservations, and policies that have been ratified by an authorized human.
- **Revealed intent:** promises, decisions, work patterns, Jira changes, pull requests, meeting notes, and message threads observed in the flow of work.

Declared intent is the setpoint. Revealed intent is the sensor. Sarathi's job is to detect the gap, propose corrections, and drive an accountable operating cadence.

## Capability Requirements

Sarathi should provide these long-term capabilities:

1. **Strategy Kernel**
   - Store active goals, commitments, KPIs, decisions, assumptions, risks, bets, and capacity reservations.
   - Support lifecycle states such as pending, ratified, active, at-risk, kept, broken, dropped, superseded, and archived.
   - Version changes through explicit events and, where configured, human-readable policy snapshots.

2. **Evidence Graph**
   - Ingest or reference Teams messages, emails, meeting transcripts, Jira issues, GitHub PRs, commits, CI results, and vault notes.
   - Preserve provenance for every extracted claim.
   - Treat inferred claims as candidates, not truth.

3. **Ratification Loop**
   - Ask the PM, operating owner, or authorized lead to accept, edit, reject, reassign, or scope inferred intent.
   - Keep rejected and edited candidates as audit evidence.
   - Avoid requiring teams to author goals from scratch when the work stream already contains intent signals.

4. **Projection And Reconciliation**
   - Publish accepted execution commitments into systems such as Jira, Vault, Teams, or GitHub.
   - Verify that projections stay present, current, and consistent.
   - Report drift when source systems contradict the Strategy Kernel.

5. **Accountability Loop**
   - Use interactive Teams cards or equivalent surfaces to confirm ownership, due dates, blockers, and evidence.
   - Record silence as a signal instead of retrying indefinitely.
   - Escalate according to explicit workspace policy.

6. **Advisor Layer**
   - Recommend keep, renegotiate, drop, escalate, reallocate, or clarify actions.
   - Produce daily delivery briefs, weekly drift reviews, client-safe update drafts, and leadership reviews from the same evidence graph.

## Product Success Criteria

Sarathi succeeds when:

- PMs spend less time manually chasing status.
- Accepted commitments have visible evidence or an explicit blocker.
- Goals without execution and execution without goals are surfaced automatically.
- Jira and team systems become more trustworthy because Sarathi asks owners to correct them.
- Strategy pivots become explicit decisions rather than silent drift.
- The same generic kernel works across multiple workspaces without leaking private project data into the public product.


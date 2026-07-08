# Strategic Execution Loop

This document defines the implementation workflow for turning observed delivery activity into ratified intent, team-visible execution records, accountability actions, and drift reports.

## Loop Summary

```text
Observe
  -> Infer
  -> Ratify
  -> Publish
  -> Verify
  -> Chase
  -> Review
```

The loop keeps human authority at the decision point and uses automation for the repetitive evidence and accountability work around it.

## Observe

Sarathi ingests or references source events:

- Teams channel messages, DMs, meeting chats, and bot interactions,
- email threads,
- meeting transcripts,
- Jira issues, comments, transitions, and links,
- GitHub PRs, commits, reviews, and CI checks,
- vault notes and policy files.

Each source event becomes an `evidence_item` with provenance and visibility.

## Infer

Sarathi extracts candidate claims:

- possible goal,
- possible commitment,
- possible decision,
- blocker,
- risk,
- status update,
- ownership signal,
- evidence-of-done signal.

Inference creates candidates. It does not silently update the Strategy Kernel.

## Ratify

Sarathi asks the authorized human to accept, edit, reject, or merge candidates.

Common ratification surfaces:

- Teams adaptive card,
- command-line inbox,
- web review queue,
- generated report with accept/edit/reject actions.

The ratifier can classify a candidate as:

- goal,
- client or stakeholder commitment,
- internal commitment,
- bet,
- decision,
- risk,
- assumption,
- task-only execution item.

## Publish

Accepted intent is projected to the right systems:

- Jira epic/story/task for execution collaboration,
- vault note for durable governance,
- Teams card or channel update for accountability,
- GitHub PR requirement or status check for code traceability,
- email/client-safe draft where the workspace policy allows it.

Publishing must follow visibility rules. Leadership-only or sensitive records must not project into team or stakeholder surfaces.

## Verify

Sarathi checks external systems for consistency:

- Does the Jira issue exist?
- Does the PR reference the Jira key?
- Does the vault note match the ratified decision?
- Did the Teams card receive acknowledgement?
- Does a claimed completion have evidence?
- Did a commitment age past its due date without blocker or completion evidence?

Verification creates `projection` status and `drift_finding` records.

## Chase

Sarathi chases accepted commitments through explicit accountability policy.

Default escalation shape:

1. DM owner with evidence and action choices.
2. DM again if silent after policy-defined interval.
3. Notify PM or operating owner.
4. Mark silent or at-risk in the drift review.
5. Escalate to a team-visible scoreboard only if workspace policy allows it.

The bot should not beg. Silence is recorded as a signal.

## Review

Sarathi produces operating reviews:

- **Daily Delivery Brief:** what changed, pending asks, blockers, deploy readiness, silent actions.
- **Weekly Drift Review:** goals without work, work without goals, stale commitments, attention mismatch, projection drift.
- **Stakeholder Update Draft:** client-safe progress, pending decisions, risks, and next steps.
- **Leadership Review:** sensitive patterns, capacity conflicts, repeated accountability failures, and recommended interventions.

Each review asks humans to make explicit decisions:

- keep,
- renegotiate,
- drop,
- escalate,
- reassign,
- publish,
- correct source system.

## First Implementation Slice

The first production slice should implement:

1. Workspace pack loading.
2. Core intent/evidence schema.
3. Manual and fixture-based evidence import.
4. Inferred intent inbox.
5. Ratification commands.
6. Jira and vault projection records.
7. Teams accountability card contracts.
8. Drift review report generation.
9. Workspace-scoped context assembly tests that prove one workspace's evidence cannot leak into another workspace's brief, projection, bot card, or model-visible context.

Live Teams/Jira/GitHub adapters can land incrementally after the kernel and workflow are stable.

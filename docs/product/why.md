# Why Sarathi

Sarathi exists because delivery coordination in software teams is still mostly human glue work.

Teams do not fail only because they cannot find information. They fail because declared intent and revealed work drift apart across chat, Jira, GitHub, CI, docs, spreadsheets, and people's heads. A PM or delivery manager spends the day asking for updates, answering repeated process questions, checking whether "done" is actually done, and turning scattered signals into decisions, follow-up, and status.

## The Problem

Common symptoms:

- Engineers or interns ask the PM the same routine process questions.
- Jira says work is in progress, but nobody knows whether it is blocked.
- A Teams thread contains the real decision, but the ticket is stale.
- A PR says a feature is done, but QA evidence is missing.
- A project direction changes in conversation, but the durable goal or client-facing commitment is never updated.
- Leadership sees delivery drift only in weekly or monthly review.
- The PM has to chase people manually because trusting people to post timely updates has not worked.

Sarathi targets that coordination gap, including the alignment gaps hidden inside it.

## The Wedge

The first useful wedge is:

> Turn existing work signals into a PM-reviewed delivery coordination review.

That means Sarathi should produce drafts the PM can approve:

- inferred goals, commitments, decisions, risks, and bets,
- gaps between intent and visible work,
- weekly status,
- open blockers,
- missing evidence,
- stale items,
- risks,
- proposed next actions.

The PM should spend less time extracting status and more time making decisions: keep, renegotiate, drop, reassign, escalate, publish, or correct the source system.

## Why Open Source

Sarathi touches work systems and delivery memory. Teams should be able to inspect the agent layer, self-host it, edit its policy, and understand what it stores.

Open source is also the right way to develop the product: delivery management varies by org, so the model needs feedback from real teams before the implementation becomes rigid.

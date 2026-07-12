# Sarathi Operating Thesis

This document captures the durable product thesis that should guide Sarathi design, implementation, and review across sessions.

## Product Identity

Sarathi is a self-hosted AI Delivery Assistant and execution-coordination platform. It helps an authorized operating owner keep declared intent, observed work, human decisions, and accountable follow-through connected across the systems a team already uses.

The Teams bot is a surface, not the product. Jira, GitHub, Teams, email, meetings, and documentation remain authoritative for their native records. Sarathi adds the control loop that reconciles them.

## The Problem

Delivery truth is commonly split across chat, trackers, code, meetings, documents, and memory. Commitments disappear, source systems become stale, pivots are not renegotiated, and clients or leaders discover drift after it has become expensive.

The missing capability is not another tracker. It is the repeated coordination work of making intent explicit, comparing claims with evidence, routing decisions, and following through until an outcome is evidenced or consciously changed.

## The Control Loop

Sarathi standardizes one loop while allowing each workspace to bind its own systems and policies:

1. **Sense:** ingest or reference authorized evidence and activity.
2. **Compare:** compare revealed activity with ratified goals, commitments, decisions, policies, and expected cadence.
3. **Decide:** ask an authorized human to ratify, correct, renegotiate, reject, reassign, or escalate.
4. **Act:** publish approved projections, answer questions, request structured responses, remind, follow up, and record outcomes.

Declared intent is the setpoint. Revealed activity is the sensor. Human ratification is the controller. Reports, messages, cards, and projections are actuators.

## Human Authority

Sarathi proposes and remembers; humans ratify; source systems record.

Sarathi may observe, draft, reconcile, remind, and report. It must not become the client voice, hold organizational authority, silently turn inference into policy, or judge people through hidden scoring. Work that requires reading artifacts and asking factual questions is a strong automation candidate. Work that commits the organization, interprets relationships, or makes trade-offs remains human-owned.

## Capabilities, Not Separate Products

One Sarathi deployment can enable different capabilities for isolated workspaces. Examples include:

- delivery-context answers and cited status;
- compliance reminders and operational follow-up;
- delivery briefs and drift reviews;
- commitment ratification and accountability actions;
- action cards and escalation workflows;
- incident follow-up and evidence checks;
- leadership or stakeholder update drafts.

Capabilities must share the same policy, evidence, audit, and workspace-boundary model. A new capability does not justify a second bot, runtime, or private fork.

## Trust Model

Prompt instructions are not a security boundary. Authorization and sensitivity policy must run before retrieval, before tool invocation, before model egress, and before publication.

Every substantive output should be defeasible: it identifies evidence, distinguishes fact from inference, exposes unavailable sources, and gives an authorized human a correction path. Derived artifacts inherit the most restrictive visibility of their inputs.

## Product Guardrails

Sarathi is not:

- a replacement for Jira or another project-management system;
- a generic enterprise search product;
- a chat summarizer;
- an opaque OKR ceremony tool;
- a surveillance or hidden people-scoring system;
- an autonomous delivery manager;
- a nag bot that retries without policy or consequence.

## Success

Sarathi succeeds when operating owners spend less time manually reconstructing status, commitments have evidence or explicit blockers, silent pivots become visible decisions, source systems become more trustworthy, and teams receive fewer but more useful coordination interventions.

Synthetic tests establish internal consistency. Product success requires a real workspace round trip and a real human decision or behavior change.

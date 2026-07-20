# Workspace And Capability Model

This document defines how one single-tenant Sarathi runtime supports multiple isolated organizational workspaces and capability profiles without becoming multiple products.

## Deployment Boundary

One Sarathi deployment serves one organization. The deployment owns one runtime policy boundary, one identity integration, and one operational data plane.

Inside the organization, a workspace is the smallest independently governed unit for intent, evidence, policy, actions, and reporting. A workspace can represent a client engagement, project, product, initiative, operating unit, or another boundary chosen by the organization.

## Workspace Topology

Workspaces start disconnected. Container boundaries encode trust; typed relations encode meaning.

Sarathi does not require an unlimited project tree. When collaboration or synthesis is needed, explicit relations can represent containment, dependency, peer collaboration, shared policy, or approved portfolio synthesis. A relation does not merge raw evidence or permissions.

Cross-workspace access must be intentionally opened for a named destination, audience, field set, and purpose. Shared learning should normally move as an approved policy or template, not as raw evidence.

## Capability Profiles

A capability is reusable product behavior enabled and configured per workspace. A workspace capability profile declares:

- whether the capability is disabled, shadowed, or live;
- its authorized sources and destinations;
- its audience and visibility ceiling;
- its cadence, approval, escalation, and evidence rules;
- its required secrets by reference;
- its readiness and acceptance criteria.

Examples include `ai-delivery-assistant`, `compliance-reminders`, `drift-review`, and `accountability-actions`.

The same capability code may run in many workspaces, but its evidence, state, identities, and policy remain workspace-scoped.

## Configuration And Runtime State

Versioned workspace configuration declares desired boundaries and policy. Runtime state records what actually happened.

Configuration includes source mappings, actor mappings, capability modes, schedules, visibility rules, allowlists, templates, and seed intent. Runtime state includes evidence, ratified intent, actions, audit events, timers, delivery outcomes, projections, and drift findings.

Configuration reconciliation must not overwrite ratified human decisions or completed actions. Conflicts become reviewable drift rather than silent replacement.

## Public Core And Private Overlay

The public Sarathi repository owns generic capability code, schemas, adapters, policy contracts, tests, and synthetic examples. An organization-owned private overlay supplies confidential non-secret mappings, workspace policy, schedules, templates, and deployment projections.

Secrets remain in an approved secret manager. Raw evidence, transactional state, embeddings, and databases remain in runtime storage. The private overlay configures the public core; it must not fork product logic or become another deployable runtime.

## Identity And Direct Messages

Team and channel context can deterministically select a workspace. Direct messages are ambiguous unless the user, conversation, or command is explicitly bound to one workspace. Ambiguous requests fail closed or ask the user to choose; they never search all workspaces by default.

## Derived Views

Leadership and portfolio views are read models over explicitly approved workspace fields. They do not create a privileged universal evidence workspace. Every derived view must preserve provenance, sensitivity, source authorization, and destination policy.

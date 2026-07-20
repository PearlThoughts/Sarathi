# Feature Specification: example Teams Mention Production

**Feature Branch**: `feat/teams-production-vertical-slice`  
**Created**: 2026-07-11  
**Status**: Planned for implementation  
**Execution Beads**: `sar-wt2`, `sar-wt2.1`

## 1. Purpose

Deliver Sarathi's first team-facing production workflow. A member of a mapped
Teams channel asks `@Sarathi <question>` and receives a concise, grounded,
same-thread answer built only from policy-authorized example evidence.

## 2. Objective and Scope

The request path is the product. The service must authenticate inbound Teams
activities through the Microsoft 365 Agents SDK, resolve the exact tenant,
workspace, channel, thread, and caller, authorize every retrieval and model
egress, retrieve a bounded evidence envelope, and send a cited reply to the
originating thread.

Included: direct mentions, Teams thread context, explicit actor aliases,
mapped example workspace resolution, read-only Teams/Jira/GitHub/Vault adapters,
Postgres hosting, Railway operations, Teams package validation, and real-team
verification.

Excluded: proactive chasing, action cards, historical evaluation/backtesting,
shadow nudges, dashboards, broad search, source writes, cross-workspace
synthesis, autonomous decisions, and person scoring.

## 3. Principles

1. **Authenticated before interpretation.** `/api/messages` is authenticated
   by the supported Agents SDK middleware before Sarathi reads an activity.
2. **Mapped and bounded before retrieval.** An unknown tenant, channel,
   workspace, actor, or policy decision ends the request without source reads.
3. **Evidence is data, never instruction.** Teams, Jira, GitHub, and Vault
   text is untrusted evidence and cannot alter the system policy or prompt.
4. **One thread, one audience.** Replies stay in the originating Teams thread
   and may use no evidence above that channel's sensitivity ceiling.
5. **Private configuration stays private.** Real mappings, aliases, source
   identifiers, credentials, and vault content remain in the deployment
   projection or private workspace pack, never in this repository or logs.
6. **Fail closed and explain safely.** Missing configuration, authorization,
   provider consent, source availability, or model approval yields a concise
   non-sensitive refusal or partial-answer notice.

## 4. Architecture

```text
Teams client
  -> Azure Bot Service
  -> authenticated Node 22 Agents SDK ingress (/api/messages)
  -> teams-mention application capability
  -> workspace and actor resolution + boundary policy
  -> bounded context assembler
       Teams thread -> ratified intent -> referenced Jira -> GitHub -> Vault projection
  -> model-egress policy -> approved model port
  -> grounded response renderer -> same Teams thread

Railway Postgres stores Sarathi state, idempotency, and redacted audit events.
```

The Agents SDK/Express hosting edge is isolated from the runtime-neutral
application capability. The current Bun/Hono service remains the health,
readiness, and internal application composition surface; production deployment
uses a Node 22 ingress because Bun compatibility for the Microsoft SDK has not
been proven.

## 5. User Stories and Acceptance

### Story 1 — Direct Mention Answer (P1)

A mapped example Delivery Team member directly mentions Sarathi in a mapped
channel or reply, and receives a concise cited answer in the same thread.

**Independent test**: an authenticated synthetic Teams activity with a direct
mention produces exactly one threaded delivery with a filtered evidence list.

1. Given a direct mention in a mapped channel, when the caller and policy
   resolve, then Sarathi removes the mention and answers in that thread.
2. Given ordinary channel traffic, when it lacks a direct mention, then
   Sarathi creates neither an audit response nor an outgoing message.
3. Given duplicate delivery of the same activity, when it is replayed, then
   Sarathi produces no second reply or audit event.

### Story 2 — Bounded Grounded Context (P1)

A direct mention can use only the current thread, ratified intent, explicitly
referenced Jira/GitHub evidence, and approved Vault projection artifacts.

**Independent test**: a restricted item, cross-workspace item, or injection
string cannot enter the model context or rendered answer.

### Story 3 — Safe Failure and Operations (P1)

Unknown actors/channels, unavailable sources, blocked model egress, or missing
deployment prerequisites fail safely and expose readiness/freshness without
message content in logs.

**Independent test**: each precondition failure returns a stable safe result
and `/ready` reports the failing dependency.

## 6. Functional Requirements

- **FR-001**: Expose an Agents SDK-authenticated `POST /api/messages`.
- **FR-002**: Process only a direct Sarathi mention from a mapped Teams
  channel/thread and strip the mention before semantic handling.
- **FR-003**: Capture tenant, team, channel, conversation, root activity,
  activity ID, service URL, caller identity, timestamp, and reply reference.
- **FR-004**: Resolve tenant/channel to exactly one workspace and resolve
  callers only through explicit workspace-scoped aliases.
- **FR-005**: Apply tenant, workspace, actor membership, source visibility,
  audience sensitivity, and model-egress authorization before every retrieval
  and again before model invocation.
- **FR-006**: Retrieve a bounded root/replies/recent Teams window and only
  directly referenced or intent-linked Jira/GitHub/Vault evidence.
- **FR-007**: Preserve source URL, source ID, provenance, actor where known,
  timestamps, sensitivity, and freshness on every context item.
- **FR-008**: Treat every source payload as untrusted evidence and defend
  against prompt-injection instructions embedded in it.
- **FR-009**: Emit concise answers that distinguish fact from inference,
  include compact source links, and identify missing or stale sources.
- **FR-010**: Persist redacted correlation/audit/idempotency state without
  persisting or logging raw message content by default.
- **FR-011**: Use SQLite only for local/private development and Postgres for
  Railway staging/production, including migrations and restart persistence.
- **FR-012**: `/ready` must fail closed for Postgres, bot credentials, tenant
  binding, workspace pack, Graph consent, source adapters, or model provider.
- **FR-013**: The Teams manifest requests only team-scoped
  `ChannelMessage.Read.Group` RSC and is validated/packaged with `atk`.

## 7. Data Contracts

`TeamsMentionCommand` contains normalized activity identity and no provider SDK
types. `AuthorizedContextEnvelope` contains only policy-approved context items,
each with workspace, provenance, source URL/ID, occurred/updated time, actor,
sensitivity, and freshness. `GroundedAnswer` contains answer markdown,
fact/inference classification, citations, and unavailable-source notices.

## 8. Non-Functional Requirements

- Bounded source calls have cancellation, timeouts, retry budgets, and
  correlation IDs.
- Structured logs are redacted and source-message text is excluded.
- Read-only source adapter failures are partial and visible; authorization and
  configuration failures are closed.
- All public tests and manifests use invented data only.

## 9. Test and Acceptance Matrix

Reusable integration tests cover direct mentions, same-thread replies, thread
context, Jira/GitHub/Vault citation selection, identity/workspace resolution,
unknown/mapped denial, restricted-data isolation, source-outage partial answers,
prompt-injection resistance, non-mention silence, idempotency, and restart
persistence. Final acceptance additionally requires these scenarios in the real
example Delivery Team with safe private evidence retained outside the repository.

## 10. Stop and Rollback Conditions

Stop and disable inbound callbacks if callback authentication, tenant binding,
workspace mappings, Postgres, or model-egress policy is unavailable; if a source
write is attempted; if restricted/cross-workspace evidence could reach an
answer; or if a private value enters a public artifact. Roll back a release in
Railway, disable the Bot endpoint, restore Postgres from the verified backup,
and preserve only redacted audit correlation evidence.

## 11. References

- [Production Pilot Readiness](../001-production-pilot-readiness/spec.md)
- [Private Workspace Packs](../../docs/implementation/private-workspace-packs.md)
- [Module Boundaries](../../docs/architecture/module-boundaries.md)

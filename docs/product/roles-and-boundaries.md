# Roles And Boundaries

Sarathi is one bot with policy-bounded workspace and audience scopes.

Team-visible and leadership products share the same delivery model; they are not separate bots. The current inbound Teams path accepts mentions only from explicitly mapped standard channels and actors. Direct-message, meeting/group-chat, private-channel, and shared-channel answering must not be inferred from the product model or Teams manifest.

## Current Interaction Boundary

- **Available resolver:** explicitly mapped standard-channel and actor combinations.
- **Available source capture:** configured standard channels and explicitly mapped meeting or group chats may be indexed.
- **Not yet implemented through the current resolver:** inbound meeting/group-chat and direct-message answering.
- **Not production-ready:** private- and shared-channel answering.

Manifest capability, source ingestion, inbound resolution, authorization, reply delivery, and live acceptance are independent gates. No one gate supports an “all users” or “all channels” claim.

## Effective Scope

Scope comes from:

- who asked,
- where they asked,
- which workspace the channel/thread/issue/repo maps to,
- what source-system ACLs allow,
- what action is requested,
- where the answer will be posted.

Inference may narrow scope, never broaden it. If Sarathi is unsure whether the current audience may see an answer, it should draft privately or ask for approval.

## Team-Visible Scope

Examples:

- weekly plan and delivery status,
- blockers and missing validation,
- process FAQ,
- definition of done,
- access routes,
- incident follow-up,
- QA ownership,
- "what should I work on next?"

## PM/Leadership Scope

Examples:

- continuity risk,
- work sufficiency,
- staffing/replacement planning,
- budget and burn,
- quarterly reports,
- client or competitor risk,
- performance-review drafts.

These outputs must be framed as operational continuity and delivery risk, not hidden personal scorecards.

## Team Maturity Dials

Maturity is not a score. It is a PM-ratified interaction profile:

```yaml
teamProfile:
  seniorityMix: intern-heavy
  nudgeIntensity: high
  coachingDepth: step-by-step
  channelPreference: dm-first
  escalationThreshold: 4h
  reviewBy: delivery-manager
```

Sarathi may propose changes after observing outcomes, but the PM approves them. Store the artifact as "how Sarathi interacts with this team/person," not "how good this person is."

## Agent Boundary

Sarathi can propose and remember. Humans ratify. Source systems record.

Sarathi should never be the client voice, final approver, DRI, or hidden judge of people.

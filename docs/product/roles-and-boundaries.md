# Roles And Boundaries

Sarathi is one bot with many scopes.

People should not need to choose between "team Sarathi" and "leadership Sarathi." They mention `@Sarathi` or DM Sarathi; the system computes what it can see, say, and do from the request.

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
- blockers and missing evidence,
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

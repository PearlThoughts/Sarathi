# ADR 0010: Bounded Teams Collaboration Scopes

## Status

Accepted for incremental implementation.

Current implementation note: projection v2 admits standard channels through current team membership, an explicitly mapped group or meeting chat through current chat membership, and an explicitly mapped private channel through current channel membership. Private-channel code and package declarations still require channel-specific tenant installation, RSC, ingestion, isolation, and live acceptance before production admission. Legacy explicit-actor standard-channel mappings remain available during migration. Shared-channel and personal-chat answering remain disabled.

## Context

Teams knowledge synchronization already models configured channels and chats, while inbound mention resolution assumes a standard channel identified by tenant, team, and channel and repeats explicit actors under every mapping. That mismatch prevents safe multi-user chat and private-channel interaction. It also risks treating team membership, chat participation, and private-channel membership as interchangeable audiences.

Microsoft Teams exposes different resource identities, installation state, resource-specific permissions, rosters, and reply semantics for team channels and chats. Shared channels can include external tenants. Private-channel membership is narrower than parent-team membership. A group or meeting chat participant must not automatically inherit a team's full corpus.

The delivery answer itself is already a reusable structured application result. The collaboration surface must authorize that result without reimplementing reporting or replacing the evidence-first pipeline.

## Decision

Model the originating collaboration scope once as a domain-level discriminated union shared by ingress normalization, resolution, authorization, context assembly, and delivery.

Authorization produces an immutable resolved request context containing workspace, conversation, authenticated actor, effective audience, maximum sensitivity, model-egress policy, permitted corpus scopes, and reply target. It completes before any retrieval or model composition.

Treat admission and membership separately. Private deployment configuration explicitly admits each collaboration scope. An authoritative resource-specific Graph roster then proves current membership with bounded freshness. A failure or expired result denies access; tenant-wide permissions and stale membership are not fallbacks.

For admitted group and meeting chats, the audience policy is `current_roster`: a current participant receives the configured chat audience, including authorized indexed history for that audience. Private channels use a separate current channel roster and a distinct channel audience; parent-team membership is never substituted. These are deliberate current-membership policies rather than claims that message-time participation has been reconstructed. Roster evidence is cached for no more than two minutes; removal blocks newly resolved requests after that bound.

Use channel-thread reply targets for team channels and flat-chat reply targets for chats. Preserve the persistent activity lease across both surfaces.

Keep shared channels and personal chats as explicit denied union members until separate authorization contracts are approved. Because Teams manifest channel-feature declarations may expose private and shared capability together, runtime shared-channel denial must precede any manifest upgrade.

Private-channel message synchronization is authoritative reconciliation-only when Microsoft Graph RSC change-notification subscriptions are unavailable for that channel type. A private mapping must declare that mode explicitly so an expected subscription 403 cannot disrupt standard-channel or chat subscription renewal.

Keep structured delivery intelligence primary. Retrieval enriches authorized delivery episodes and never owns period population or completeness. Composition and validation continue to fail closed with only a privacy-safe notice.

## Consequences

- Standard-channel authorization can scale through current team membership without copying actors into each channel.
- Group/meeting chats and private channels receive distinct installation, roster, audience, corpus, and reply behavior.
- Synchronization and inbound interaction can converge on one conversation identity without coupling report results to Teams formatting.
- Deployment projections become versioned and more explicit.
- Graph roster availability and permission correctness become request-path dependencies, mitigated by a short bounded cache and safe denial.
- Manifest changes occur later than runtime policy and require live tenant proof.

## Alternatives rejected

### Copy every actor into every mapping

This scales poorly, drifts from Entra membership, and cannot express chat or private-channel audiences safely.

### Authorize every team member for every workspace corpus

This collapses distinct audiences and can disclose private-channel or chat-only material.

### Treat all Teams conversations as tenant-wide discoverable resources

This violates explicit admission and expands the product beyond the approved collaboration scopes.

### Create a separate chat reporting path

This would duplicate the working capability-first delivery product and allow behavior to diverge by surface.

## Rollback

Disable v2 collaboration mappings and deploy the prior application revision. Legacy standard-channel explicit-actor projections remain available during migration. Synchronized knowledge and delivery projections remain intact; no destructive data rollback is required.

## References

- [Bounded Teams Collaboration Scopes](../../specs/006-teams-collaboration-scopes/spec.md)
- [ADR 0009: Evidence-First Period Reporting](./0009-evidence-first-period-reporting.md)
- [Delivery synthesis](../architecture/delivery-synthesis.md)

# Specification: Bounded Teams Collaboration Scopes

## Purpose

Let authorized users ask Sarathi from explicitly admitted Microsoft Teams collaboration scopes without weakening the existing delivery-intelligence product or disclosing material across audience boundaries.

This specification is workspace-neutral. Tenant identifiers, team identifiers, chat identifiers, channel identifiers, actors, capability ontologies, evaluation questions, and source material belong in a private deployment projection.

## Product Contract

For an admitted conversation, Sarathi either posts a validated, composed answer or a short privacy-safe failure notice. It never publishes a deterministic raw-record fallback, source inventory, partial report, conversation transcript, or repetitive hygiene list.

Period, sprint, and leadership questions continue through the existing structured delivery projection, composer, citation resolver, and fail-closed report validator. Exact, full-text, vector, and relational retrieval may enrich a report; retrieval does not define its population or completeness.

## Conversation Model

Every admitted collaboration scope resolves to exactly one discriminated conversation kind:

- `standard_team_channel`
- `private_team_channel`
- `shared_team_channel`
- `group_chat`
- `meeting_chat`
- `personal_chat`

A team-channel identity carries tenant, Bot Framework team, Entra team, and channel identities. A chat identity carries tenant and chat identities. Meeting chats remain chats; channel meetings remain channels.

An inbound channel activity is first normalized as an unresolved `team_channel`. The runtime does not infer standard, private, or shared authorization from SDK `membershipType` or `channelType` strings. Explicit admission and authoritative Microsoft Graph capability or roster checks resolve the collaboration kind.

The normalized request also carries:

- authenticated caller Entra object identity and display label;
- a channel-thread or flat-chat reply target;
- activity identity, question, service URL, and received time.

Missing authenticated Entra identity fails closed. Guest, anonymous, federated, or application identities are not inferred from a display name.

## Resolved Request Context

Authorization produces one immutable context before any thread read, delivery query, retrieval, or model call. It contains:

- tenant and workspace;
- conversation identity and kind;
- mapped internal actor and trust tier;
- effective audience identity and membership evidence;
- maximum sensitivity and model-egress policy;
- permitted source, audience, and corpus scopes; and
- reply target and originating activity identity.

No downstream component may expand these boundaries. Delivery-intelligence results remain surface-independent; Teams formatting and reply addressing are adapter responsibilities.

## Admission and Membership

Admission and membership are separate checks.

An admitted scope is an explicit private deployment mapping. There is no tenant-wide discovery and no wildcard conversation mapping. Shared channels and personal chats are represented so they can be denied explicitly; they remain disabled until separately approved and implemented.

Membership is resolved from an authoritative Microsoft Graph roster using resource-specific consent for the originating resource:

- standard team channel: current parent-team membership;
- private team channel: current channel membership, independent of parent-team membership;
- group or meeting chat: current chat membership;
- shared team channel: a future dedicated contract that accounts for host and external tenants;
- personal chat: a future separately approved contract.

Membership evidence has a bounded freshness window. Positive authorization may be cached for at most two minutes. Expired evidence, Graph timeout, throttling, forbidden access, missing installation consent, ambiguous identity, or lookup failure denies the request. There is no stale-membership fallback.

The runtime may use only the resource-scoped permissions required for the admitted resource. Tenant-wide application permissions require a separate security decision and are not an implicit fallback.

## Audience and Corpus Isolation

Each admitted scope declares an effective audience and permitted corpus scopes. The originating actor must be a current member of that audience.

- Standard-team membership does not authorize private-channel or chat-only material.
- Private-channel membership does not authorize unrelated private channels or chats.
- Chat participation does not grant the full parent-team corpus unless the deployment mapping explicitly grants a bounded team corpus.
- Private-channel material cannot enrich a standard-channel answer unless an explicit policy grants that audience relationship.
- Synchronization, retrieval, report composition, citation resolution, and answer delivery use the same audience boundary.

Authorization is complete before retrieval and composition. Unsupported or denied scopes make zero thread-reader, delivery-query, retrieval, or model calls.

## Reply Semantics

Standard, private, and shared channel messages reply to the originating channel thread. Group, meeting, and personal chats reply to the originating chat without inventing channel thread semantics. The adapter receives a discriminated reply target rather than reconstructing it from unrelated identifiers.

Persistent activity leasing is acquired before authorization. Redelivered activities do not produce duplicate replies. A later rollout slice must prove that the lease lifetime and renewal behavior cover queue time plus the longest supported composition budget and process restarts.

## Source and Report Failure Semantics

Every report product declares its mandatory sources and optional enrichment sources. A mandatory source that is unavailable, stale beyond policy, unauthorized, or scoped out prevents a successful full-coverage report. Optional enrichment absence is represented internally and cannot be presented as complete evidence.

Composition, structural validation, citation validation, or delivery failure yields only the existing short privacy-safe failure class. Failure notices contain no tenant, workspace, audience, sensitivity, membership, source, or record identifiers.

## Versioned Deployment Projection

The public parser accepts a versioned, workspace-neutral projection. Legacy standard-channel projections remain a distinct compatibility version during migration; they do not silently acquire membership authorization or new conversation kinds.

The new version declares admitted conversations, membership policy, audience and corpus grants, sensitivity, model-egress policy, and internal actor mapping policy. A private overlay owns actual values and deployment sequencing.

## Operational Controls

Long quality reports retain their declared 40–60 second class of response budget. Broad rollout uses bounded concurrency and queuing rather than fallback content. Overload, provider limits, database pressure, lease-renewal failure, or deadline exhaustion fails closed.

Enablement is reversible per admitted conversation kind and mapping. Rollback disables the new projection, restores the prior application revision, and leaves synchronized evidence and structured delivery projections intact.

## Acceptance

### Compatibility

- The five governed sprint cases and last-week, this-week, last-30-days, and leadership products remain capability-first and cited.
- Report or composer failure publishes only the short failure notice.
- Structured reporting remains valid when optional semantic retrieval is disabled.

### Scope normalization

- Team-channel, group-chat, meeting-chat, and personal-chat activities normalize deterministically; admitted channel configuration resolves standard, private, or shared kind.
- Unsupported shared and personal scopes deny before Graph or retrieval.
- Missing or ambiguous authenticated identity denies safely.
- Channel replies retain the originating thread; chat replies retain the originating chat.

### Authorization

- At least two current members and two admitted standard channels succeed.
- Unmapped conversations, non-members, expired membership, Graph 403/404/429, timeout, and malformed rosters deny.
- Meeting/group chat succeeds only with an explicit mapping, installed app, consented chat RSC, and current participant.
- Private channel succeeds only for a current private-channel member with channel-specific installation and consent.
- A parent-team member outside the private channel cannot retrieve or receive its material.

### Operations

- Replayed and in-flight duplicate activities produce one reply.
- Reconciliation succeeds repeatedly for every enabled Teams source.
- Load tests establish a safe concurrency limit without partial answers.
- Disable and rollback paths are exercised.
- Real Teams messages and human ratings are produced only under explicit operator authorization and bind to the exact visible answer fingerprint.

## Non-Goals

- Tenant-wide Teams discovery.
- Incidental shared-channel enablement.
- Automatic personal-chat support.
- Replacing PostgreSQL, pgvector, Drizzle, delivery projections, or the existing composer.
- Hard-coding any customer, workspace, ontology, evaluation, or source identifiers in the public repository.

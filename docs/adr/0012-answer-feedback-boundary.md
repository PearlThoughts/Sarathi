# ADR 0012: Response-Level Feedback As A Separate Bounded Context

## Status

Accepted on 2026-08-13 for F1851-979.

## Context

Sarathi needs ordinary response-level feedback for product improvement, later evaluation, and reviewed corrected-answer candidates. Teams is the first interaction surface, delivery intelligence supplies query metadata, and PostgreSQL supplies persistence. The existing fingerprint-bound 1-5 evaluation rubric remains a governed acceptance mechanism and must not be reused for ordinary ratings.

## Decision

Create a public `answer-feedback` bounded context. It owns immutable answer linkage, three-state ratings, reason taxonomy, actor revisions, one-current projection, review disposition, aggregates, and training-candidate eligibility. PostgreSQL implements the capability port. Teams renders opaque actions and reuses the existing workspace, identity, audience, and conversation resolver before calling the application service.

Successful answer Markdown remains text. A compact Adaptive Card attachment carries the feedback interaction on the same activity. `Action.Execute` returns a replacement confirmation card, preventing noisy channel messages. Card data contains generated answer and idempotency identifiers plus enumerated action values; answer, question, prompt, source, and envelope content stay server-side.

## Consequences

Positive:

- transport, product feedback, governed evaluation, and source mutation remain separate;
- revisions and current state are durable and queryable without rewriting answers;
- other channels can reuse the domain and application capability;
- privacy-safe aggregate reporting can classify failures by responsible improvement lane.

Costs:

- answer delivery prepares a durable feedback snapshot before sending the card;
- Teams ingress adds a typed action route and must re-run authorization;
- additive PostgreSQL tables and migration coverage are required.

## Rejected Alternatives

- Teams-owned telemetry: rejected because transport would own domain state.
- `humanUsefulnessRating`: rejected because it is the governed fingerprint-bound 1-5 acceptance rubric.
- model/prompt feedback mutation: rejected because raw feedback is unreviewed evaluation data.
- another datastore or analytics product: rejected because it would split recovery, authorization, and retention.
- a full-answer Adaptive Card: rejected because it would degrade existing Markdown presentation.

## Follow-Up Boundary

This decision does not authorize fine-tuning, a sensitive review/export UI, product-registry commands, lifecycle transitions, Jira writes, source corrections, or broader conversation admission. Those require separate reviewed capabilities and authorization.

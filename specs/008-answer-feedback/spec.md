# Feature Specification: Response-Level Human Feedback

**Feature Branch**: `feat/response-feedback`
**Created**: 2026-08-13
**Status**: Accepted for implementation
**Input**: F1851-979 and the response-level human-feedback handover

## 1. Purpose

Sarathi must collect low-friction, fingerprint-bound feedback for eligible answers while preserving the answer, the governed evaluation rubric, product identity, delivery state, and source-system truth as separate concerns.

## 2. Problem And Objective

Sarathi can evaluate answers through a governed 1-5 rubric, but ordinary users do not have a response-level product-feedback path. The new capability must capture whether an answer was useful and why, retain revision history, support privacy-safe improvement analytics, and make corrected answers eligible for a later reviewed training-candidate workflow.

Objectives:

- attach three-state feedback controls to each eligible answer without degrading its Markdown presentation;
- retain exact answer, query, actor, workspace, conversation, and generation-configuration linkage in PostgreSQL;
- classify failures into retrieval, mapping, lifecycle, relationship, consolidation, presentation, and freshness lanes;
- expose privacy-safe aggregates without printing answer or correction text;
- keep raw feedback out of automatic training, evaluation acceptance, product-model mutation, and source-system mutation.

## 3. Principles

1. **Feedback is a domain capability.** `answer-feedback` owns ratings, reasons, revisions, review disposition, and training eligibility. Teams owns transport and rendering only.
2. **The original answer is immutable.** A rating or correction appends a feedback revision and never edits the answer snapshot.
3. **Authorization is re-evaluated.** Submission must resolve the current actor through the existing workspace, audience, and conversation boundary before the domain accepts it.
4. **Payloads are opaque and bounded.** Card actions carry only a generated answer identifier, idempotency identifier, enumerated values, and bounded user input.
5. **Product feedback is not acceptance.** Feedback never creates a governed `humanUsefulnessRating`, training record, lifecycle transition, registry command, or source update.
6. **Review is explicit.** Only a revision separately marked `accepted_for_training` can become a corrected-answer candidate; this slice does not add fine-tuning.

## 4. Architecture Overview

```text
Generated answer + authorized delivery context
  -> answer-feedback application records immutable answer snapshot
  -> Teams renderer attaches opaque Adaptive Card actions
  -> Microsoft Agents SDK routes Action.Execute
  -> existing resolver and authorizer re-establish actor and boundary
  -> answer-feedback application appends an idempotent revision
  -> PostgreSQL updates the one-current-revision projection
  -> returned Adaptive Card confirms quietly and permits revision

Operator CLI
  -> answer-feedback aggregate query
  -> counts, rates, reasons, query families, configuration revisions,
     corrections, and review dispositions only
```

The public repository owns the capability, PostgreSQL adapter, generic Teams card/action adapter, CLI, synthetic tests, and documentation. Private overlays may own rollout intent and evaluation procedure, but no raw response, correction, actor mapping, or private source body.

## 5. User Scenarios And Testing

### User Story 1 — Rate An Answer (P1)

An eligible recipient sees `Useful as-is`, `Partly useful`, and `Not useful` on the answer activity. Useful feedback records immediately. Partial and negative choices reveal a compact form with multi-select reasons and an optional correction.

**Independent Test**: Render the card, submit each rating through the typed handler, and verify the stored current projection and confirmation card.

### User Story 2 — Revise Feedback Safely (P1)

The same actor can revise feedback for the same answer. The current projection changes, prior revisions remain, and a repeated action with the same idempotency identifier does not create another revision.

**Independent Test**: Submit, repeat, revise, reload the repository, and compare revision history with the current pointer.

### User Story 3 — Inspect Product Feedback (P2)

An operator requests privacy-safe aggregates by rating, reason, query family, model/configuration revision, correction presence, and review disposition without retrieving answer or correction bodies.

**Independent Test**: Seed synthetic current revisions and assert exact aggregate counts and rates from the CLI result.

### Edge Cases

- malformed payload, unknown answer identifier, invalid rating or reason, excessive correction length;
- actor is no longer mapped or authorized for the conversation;
- workspace or conversation differs from the recorded answer boundary;
- answer delivery fails after snapshot preparation;
- duplicate platform delivery of one action;
- a previous answer text changes and therefore has a different fingerprint;
- database restart after answer registration and after multiple revisions.

## 6. Functional Requirements

- **FR-001**: Eligible successful answers must include the three binding rating choices.
- **FR-002**: `useful_as_is` must submit without a mandatory detail form.
- **FR-003**: `partly_useful` and `not_useful` must support any number of enumerated reasons and an optional correction of at most 2,000 Unicode characters.
- **FR-004**: Reasons must use the eleven public reason codes in this specification and support multiple values.
- **FR-005**: Each delivered answer snapshot must have a generated opaque identifier and immutable SHA-256 answer and query fingerprints.
- **FR-006**: One current feedback revision must exist per actor and answer while all historical revisions remain addressable.
- **FR-007**: A duplicate idempotency identifier must return the existing revision without appending history.
- **FR-008**: Submission must verify schema, answer existence, current actor mapping, current conversation authorization, workspace equality, and conversation-boundary equality.
- **FR-009**: Submission failure must return a concise card response and emit only privacy-safe diagnostic codes.
- **FR-010**: PostgreSQL must retain model, reasoning configuration, application revision, prompt/configuration revision when available, product-registry revision when available, retrieval/envelope fingerprint when available, response product/query family, generation time, feedback time, and revision number.
- **FR-011**: Teams action data must not contain answer text, question text, citations, source bodies, prompt content, model envelopes, arbitrary URLs, or external identifiers.
- **FR-012**: Aggregate reporting must include counts and rates for all ratings, reason distribution, correction rate, query family, model/configuration revision, and review disposition.
- **FR-013**: A training candidate can be created only from a revision whose disposition is `accepted_for_training`; ordinary feedback and corrections remain evaluation data.
- **FR-014**: Feedback must not invoke or write product-model, delivery-lifecycle, Jira, source, governed-evaluation-rating, or model-training operations.
- **FR-015**: Initial Teams integration must use `Action.Execute` replacement responses so confirmation updates the card without a new channel message.

## 7. Domain Contracts

Ratings:

- `useful_as_is`
- `partly_useful`
- `not_useful`

Reasons:

- `irrelevant`
- `missing_material_work`
- `wrong_capability_mapping`
- `wrong_delivery_status`
- `wrong_owner_or_dependency`
- `duplicate_activity`
- `difficult_to_understand`
- `too_detailed`
- `insufficient_detail`
- `stale`
- `other`

Review dispositions:

- `unreviewed`
- `accepted_for_evaluation`
- `accepted_for_training`
- `rejected`

`AnswerFeedbackAnswer` is the immutable delivered-answer snapshot. `AnswerFeedbackRevision` is an append-only actor response. `AnswerFeedbackCurrent` points to one revision. `CorrectedAnswerCandidate` is a derived reviewed view and not an automatic write target.

## 8. Persistence And Privacy

The existing PostgreSQL and Drizzle migration path owns three tables: immutable delivered answers, append-only revisions, and current pointers. Conversation identifiers are stored as stable fingerprints. Answer and question text remain private application data used only for authorized reconstruction; aggregate queries do not select them. Retrieval envelopes and source bodies are never copied.

The persistence adapter must use a transaction to append a revision and update the current pointer. Unique constraints enforce answer delivery identity, answer/actor/revision sequence, and idempotency.

## 9. Review And Training Boundary

This slice defines review disposition and the pure derivation rule for corrected-answer candidates. It does not expose a review mutation or training export command because the current CLI has no operator-role authorization contract for sensitive text. A later reviewed surface must add that authorization before exposing bodies.

## 10. Non-Functional Requirements

- deterministic card schema and action decoding;
- fail-closed authorization and persistence errors;
- restart survival through PostgreSQL integration coverage;
- no response/correction contents in logs or aggregate output;
- no public fixture or documentation may contain 1851-specific content;
- existing answer Markdown remains unchanged.

## 11. Success Criteria

- all three ratings, multi-select reasons, optional correction, revision, idempotency, authorization, malformed/unknown input, length, persistence, immutability, fingerprint, card, privacy, review boundary, aggregate, and non-mutation cases have permanent tests;
- `bun run check` passes in public and private repositories on their exact PR branches;
- both governed PRs merge and Railway deploys the exact merged public revision;
- health and card/action diagnostics are verified separately;
- live Teams acceptance remains unclaimed unless the user explicitly authorizes and observes the nine-step live sequence.

## 12. Rollback And Stop Conditions

Stop release on migration failure, wrong deployment revision, card serialization failure, action-route failure, authorization bypass, private-data leak, or any local CI failure. Roll back by redeploying the previous Railway revision; the additive feedback tables do not alter existing answers or source state.

## 13. Out Of Scope

- star ratings, claim-level feedback, or per-bullet feedback;
- automated fine-tuning or prompt mutation;
- automatic product-registry, lifecycle, Jira, evaluation-rating, or source updates;
- a sensitive review/export UI before an operator authorization contract exists;
- a second answer or evaluation pipeline;
- broadening Teams conversation admission.

## 14. References

- [Teams Mention Production](../002-teams-mention-production/spec.md)
- [AI Delivery Assistant Intelligence](../005-knowledge-layer/spec.md)
- [Bounded Teams Collaboration Scopes](../006-teams-collaboration-scopes/spec.md)
- [Module Boundaries](../../docs/architecture/module-boundaries.md)
- [Microsoft Agents SDK AgentApplication](https://learn.microsoft.com/en-us/microsoft-365/agents-sdk/agent-application)
- [AdaptiveCardsActions API](https://learn.microsoft.com/en-us/javascript/api/%40microsoft/agents-hosting/adaptivecardsactions)

# Response Feedback

Sarathi can attach a compact feedback card to each successfully delivered answer without changing the answer's Markdown presentation. The card asks whether the answer was useful and offers `Useful as-is`, `Partly useful`, and `Not useful`. Positive feedback records immediately. Partial or negative feedback expands an inline multi-select reason form with an optional correction. Submission replaces the interactor's card with a confirmation and fresh controls, so the same actor can revise feedback without posting a new channel message.

## Domain And Persistence Boundary

`src/modules/answer-feedback` owns the response-feedback capability. The Teams adapter only renders opaque action identifiers and routes authenticated actions into the application service. PostgreSQL stores an immutable exact-answer snapshot, append-only feedback revisions, and one current revision pointer per actor and answer. The snapshot binds feedback to answer and query fingerprints, workspace and opaque conversation boundary, generation configuration, application and registry revisions when available, retrieval fingerprint, response product, query family, and timestamps.

Railway applies the additive public Drizzle migration through the repository's `knowledge migrate apply` pre-deploy command before starting the Teams runtime. A migration failure blocks the new runtime rather than starting without feedback tables.

Action payloads contain only opaque answer and idempotency identifiers plus enumerated rating/reason values and a bounded optional correction. They never contain the answer, question, retrieval envelope, prompt, arbitrary URL, or private source body. Submission repeats the existing workspace, conversation, actor, and authorization checks. A changed answer receives a different fingerprint and feedback identity.

## Evaluation And Training Boundary

Ordinary response feedback is product evaluation data. It does not create the governed fingerprint-bound 1–5 `humanUsefulnessRating`, establish human acceptance, modify the original answer, train a model, or mutate product identity, lifecycle state, Jira, or any source system.

Every revision begins as `unreviewed`. The domain recognizes `accepted_for_evaluation`, `accepted_for_training`, and `rejected`, but the first delivery slice does not expose a sensitive-text review or export command. A corrected answer can become a training candidate only after a separate authorized review marks that exact revision `accepted_for_training`; the pure candidate projection refuses every other disposition.

## Operator Metrics

Operators can read privacy-safe current-revision aggregates through the supported CLI:

```text
bun run delivery feedback metrics --workspace-id <workspace-id>
```

The report includes counts and rates for the three ratings, reason distribution, correction submission rate, query-family distribution, model/reasoning/application/prompt revision distribution, and reviewed versus unreviewed counts. It does not print questions, answers, corrections, actor identifiers, conversation identifiers, or source bodies.

Reasons remain distinct so operators can route improvement work: relevance to interpretation/ranking, missed work to retrieval or episode construction, capability mapping to ontology resolution, delivery status to lifecycle reduction, owner/dependency errors to relationship resolution, repeated work to episode consolidation, presentation issues to composition/rendering, and stale results to synchronization/freshness.

## Acceptance Boundary

Automated tests prove card serialization, typed action handling, authorization, durable revision behavior, and aggregate calculation. Deployment health proves only runtime reachability. A controlled Teams acceptance still must prove the controls on a real answer, immediate positive submission, expanded detail form, correction submission, quiet confirmation, revision preservation, aggregate movement, and absence of product/source/evaluation mutation. Do not post a live test message without the admitted workspace owner's approval.

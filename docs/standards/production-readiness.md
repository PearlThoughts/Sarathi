# Production Readiness Standard

This document defines the evidence required before a Sarathi capability or deployment may be described as production-ready.

## Readiness Vocabulary

Use precise state labels:

- **Implemented:** code exists and focused tests pass.
- **Composed:** the production runtime injects the implementation into the real execution path.
- **Configured:** approved private mappings and secret references are present.
- **Deployed:** the intended merged SHA is running in the target environment.
- **Healthy:** the process responds and its liveness check passes.
- **Ready:** required dependencies and policy gates pass for the named capability.
- **Accepted:** a real authorized workflow has passed its behavioral and privacy acceptance criteria.

Do not collapse these states into "live" or "done." A healthy process can be deliberately unready, and a ready endpoint can still lack real user acceptance.

## Capability Readiness

Readiness is capability-specific. A deployment with multiple capabilities must expose safe component status so an intentionally disabled capability can be distinguished from a misconfigured or failing one.

Readiness responses must not expose identifiers, credentials, source content, or sensitive diagnostic details.

## Promotion Modes

Any proactive or externally visible capability uses explicit promotion modes:

1. `disabled`: no source query, scheduling, or delivery.
2. `shadow`: use approved real sources and produce a private preview without external delivery.
3. `live`: allow delivery only after a reviewed promotion reference and rollback path exist.

Adding one mapping or environment variable must never accidentally promote a capability to live operation.

## Credentials

Production integrations use renewable provider-managed credentials or token providers. Short-lived bearer tokens are diagnostic inputs, not durable production configuration. Secrets live in approved secret stores and are referenced, never copied into workspace packs, logs, docs, fixtures, or PRs.

## Reliability

Externally visible actions require:

- durable idempotency;
- explicit retry eligibility and retry timing;
- restart-safe audit state;
- bounded timeouts and failure handling;
- redacted observability;
- manual override and rollback;
- tests for duplicate delivery and partial failure.

Silence and failure are states to record and route, not reasons to retry indefinitely.

## Acceptance Evidence

Synthetic tests are necessary but insufficient. Production acceptance includes:

- a real target workspace and authorized caller or schedule;
- the real source and destination path;
- evidence or citations that resolve;
- expected same-thread or proactive delivery behavior;
- duplicate suppression;
- restricted and cross-workspace evidence exclusion;
- logs free of secrets and private content;
- an explicit human acceptance or correction;
- a tested rollback or disable path.

## Claim Review

For every completion claim, reviewers should independently verify Git state, merged PRs, local CI, deployed SHA, runtime composition, private configuration, external platform state, and real acceptance evidence. A checkpoint is not a terminal outcome.

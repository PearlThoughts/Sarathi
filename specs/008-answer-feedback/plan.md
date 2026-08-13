# Implementation Plan: Response-Level Human Feedback

**Branch**: `feat/response-feedback` | **Date**: 2026-08-13 | **Spec**: [spec.md](./spec.md)

## 1. Technical Context

- TypeScript 5.8, Bun 1.2, Effect 3, Microsoft Agents SDK 1.6.1
- PostgreSQL through the existing Drizzle schema and knowledge migration runner
- Vitest, Bun-native tests, PostgreSQL integration tests, architecture fitness checks, type coverage, and privacy scan
- Railway GitHub-source deployment through the repository release CLI

## 2. Constitution Check

- Human-guided and evidence-gated: raw feedback remains unreviewed evaluation data.
- Better Auth and existing Teams resolution own identity/membership; answer-feedback owns only its domain policy.
- Authorization runs again before feedback persistence.
- Strategy remains in SenG-Vault; buildable behavior lives in this specification.
- Public/private boundary is preserved with reusable code public and rollout intent private.

## 3. Structure Decision

```text
src/modules/answer-feedback/
  domain/answer-feedback.ts
  application/answer-feedback-service.ts
  ports/answer-feedback-repository.ts
  index.ts
src/infrastructure/postgres/
  answer-feedback-postgres.ts
src/infrastructure/teams/
  answer-feedback-card.ts
src/teams-ingress/node-server.ts
src/cli/commands/delivery-runtime.ts
drizzle/00NN_answer-feedback.sql
tests/
  answer-feedback-domain.test.ts
  answer-feedback-application.test.ts
  answer-feedback-card.test.ts
  answer-feedback-postgres.integration.test.ts
```

The domain module has no Microsoft, PostgreSQL, Hono, environment, or source-system imports. The Teams adapter receives a presentation-safe invitation and calls an application service after existing resolution/authorization. PostgreSQL implements only the module port.

## 4. Phases

### Phase A — Domain And Contracts

- define ratings, reasons, review dispositions, immutable answer snapshots, revisions, current projection, aggregates, and training-candidate derivation;
- define typed preparation, submission, aggregate, abandonment, and repository ports;
- add tests first for domain invariants and non-mutation boundaries.

### Phase B — Persistence

- add Drizzle tables, additive SQL migration, migration-plan registration, and indexes;
- implement immutable answer registration, append/current transaction, idempotent lookup, safe abandonment, and aggregate SQL;
- prove restart survival and current/history reconstruction in the PostgreSQL integration suite.

### Phase C — Teams Presentation And Actions

- serialize an Adaptive Card attachment beside the unchanged Markdown answer;
- register `Action.Execute` for direct useful submission and detailed form submission;
- re-run the existing resolver and authorizer, validate the typed payload, submit, and return a replacement confirmation/revision card;
- keep diagnostics to hashes and enumerated outcome codes.

### Phase D — Operator Surface And Documentation

- add `delivery feedback metrics` using the answer-feedback public application surface;
- document behavior, persistence, Teams interaction, metrics, error-lane routing, evaluation/training separation, and correction review lifecycle;
- add private rollout documentation without private data.

### Phase E — Verification And Release

- run targeted tests after each batch;
- run direct diff self-review and both exact-branch full local CI suites;
- create governed F1851-979 PRs, merge through GitHub, synchronize canonical checkouts, and deploy the merged public revision through the repository CLI;
- verify deployment identity, health, migration/card serialization/action diagnostics, and provide manual Teams acceptance because no live message is authorized.

## 5. Test And Evidence Strategy

- pure domain tests cover enumeration, revision, idempotency, immutability, fingerprint association, review gating, and error-lane mapping;
- application tests cover all ratings, authorization contexts, malformed/unknown payloads, conversation/workspace boundaries, optional correction, and no side effects outside the repository port;
- renderer tests inspect the complete card JSON for opaque-only payloads, multi-select input, correction bound, quiet confirmation, and unchanged answer text;
- PostgreSQL integration tests prove migrations, durable restart reconstruction, current/history behavior, and privacy-safe aggregates;
- existing delivery evaluation tests prove feedback does not create `humanUsefulnessRating`;
- public fixture/privacy scans prove no private organization data enters public artifacts.

## 6. Dependency And Recovery

Domain contracts precede persistence and adapters. Persistence precedes Teams composition. The private documentation PR can merge after the public contract is stable but contains no runtime dependency.

All schema changes are additive. If application deployment fails, redeploy the prior Railway revision. Feedback tables may remain unused; they do not participate in answer generation, retrieval, or source mutation.

## 7. Architecture Decision Significance

The new capability crosses domain, persistence, Teams transport, and operator surfaces, and alternatives include embedding it in delivery intelligence or the Teams adapter. This meets the impact, alternatives, and cross-cutting tests; ADR 0012 records the selected boundary.

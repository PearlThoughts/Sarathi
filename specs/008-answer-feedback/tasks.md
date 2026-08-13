# Tasks: Response-Level Human Feedback

**Input**: [spec.md](./spec.md) and [plan.md](./plan.md)
**Execution ledger**: `sar-kxz` / `F1851-979`

## Foundation

- [ ] T001 Add answer-feedback domain contracts and invariant tests.
- [ ] T002 Add the application service and in-memory contract tests for preparation, submission, revisions, idempotency, authorization, and review gating.
- [ ] T003 Add Drizzle schema, additive migration, PostgreSQL repository, and restart-survival integration tests.

## Teams Experience

- [ ] T004 Add privacy-safe Adaptive Card rendering for direct useful and detailed partial/negative feedback.
- [ ] T005 Compose answer preparation into successful Teams answer delivery without changing answer Markdown.
- [ ] T006 Register typed `Action.Execute` handling through the existing resolver/authorizer and return quiet confirmation/revision cards.

## Operations And Documentation

- [ ] T007 Add privacy-safe `delivery feedback metrics` output and aggregate tests.
- [ ] T008 Update public architecture, product behavior, operator, Teams, and evaluation/training documentation.
- [ ] T009 Add private rollout/evaluation documentation under `sint-zdx` without raw feedback or private source data.

## Verification And Release

- [ ] T010 Run targeted tests, architecture/privacy checks, and direct diff self-review.
- [ ] T011 Run exact-branch `bun run check` in both repositories and record totals and controlled skips.
- [ ] T012 Open F1851-979 PRs, merge through GitHub, sync canonical checkouts, and close Beads with merge evidence.
- [ ] T013 Deploy the exact public merge revision through the repository Railway release path and verify health separately from feedback diagnostics.
- [ ] T014 Provide one exact manual Teams acceptance sequence; do not post a live message without explicit approval.

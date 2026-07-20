# Feature Specification: Unified Production Hardening

## Purpose

Make the one public Sarathi runtime safe to operate for Finance and example without
embedding PearlThoughts configuration or enabling a delivery merely because a
variable is present.

## Requirements

- Finance runtime mode is exactly `disabled`, `shadow`, or `live`; the default
  is `disabled`. The private projection supplies it as
  `SARATHI_FINANCE_RUNTIME_MODE`.
- An authenticated dry-run uses the real configured Finance source and returns
  the exact proposed digest, but performs no Teams delivery and creates no
  delivered reminder audit event.
- Dry-run acceptance evidence is durable but contains only a digest hash and
  safe metadata, never item text or recipient identifiers.
- Shadow runtime acceptance uses the real source and durable audit adapter,
  exercises reservation and due-retry selection, contains scheduler-load
  failure, performs zero external delivery, and finishes in a non-retryable
  `shadow_accepted` audit state.
- Live Finance requires an explicit promotion reference in addition to an
  explicit `live` mode.
- `/ready` reports safe component states for Teams mention handling, Finance,
  scheduler, Postgres, and source/delivery credential availability. Intentional
  Finance disablement is distinct from a broken configuration.
- Retry processing honours `retryAt`, catches scheduled failures, and relies on
  durable reservation state to suppress duplicates across restarts.
- All tests and public fixtures remain synthetic.

## Non-Goals

- Storing Finance or example mappings, recipients, evidence, or secrets in the
  public repository.
- Promoting Finance live without a separately reviewed private projection and
  explicit SenG approval.
- Creating a second runtime, Bot, Teams app, scheduler, or Cloudflare service.

## Verification

- Unit and integration tests cover mode gates, authenticated dry-run behavior,
  authenticated shadow acceptance, component readiness, deferred retry, caught
  scheduler errors, zero delivery, and restart idempotency.
- `bun run check` passes from the feature worktree.

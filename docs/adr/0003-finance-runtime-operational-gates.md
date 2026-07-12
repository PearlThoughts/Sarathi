# ADR 0003: Finance Runtime Operational Gates

## Status

Accepted

## Context

The unified runtime needs real Finance dry-run verification without accidental
delivery, while its scheduler must tolerate failure and restart safely.

## Decision

Use explicit `disabled`, `shadow`, and `live` modes. Only `live` starts the
scheduler and it requires a promotion reference. A separate authenticated
dry-run endpoint is available only for a complete shadow or live composition;
it uses the same source and renderer but no delivery path. Retry eligibility is
durable and driven by `retryAt`; readiness reports safe component states.

## Consequences

Adding a workspace ID cannot enable Finance. Operations get observable
intentional disablement, while failures remain visible. Private projection
approval is required before any live promotion.

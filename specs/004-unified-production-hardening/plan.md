# Implementation Plan: Unified Production Hardening

## Boundaries

```text
private deployment projection -> environment adapter -> runtime composition
                                                -> public Finance application
```

The Finance application remains source/delivery/audit-port based. Runtime
composition parses modes, authenticates the operator entry point, exposes safe
readiness, and starts only the live scheduler. Postgres adapters own durable
retry eligibility and acceptance metadata.

## Work

1. Extend Finance audit ports and Postgres implementation for retry eligibility
   and redacted dry-run acceptance metadata.
2. Make scheduler execute scheduled work and due retries safely.
3. Add a mode-aware hosted Finance composition and authenticated dry-run route.
4. Replace boolean readiness with a safe component report.
5. Add deterministic regression coverage and run the full check.
6. Add a shadow-only acceptance operation that uses real source/audit adapters,
   a fail-closed no-delivery port, durable retry proof, scheduler-error proof,
   and terminal audit cleanup.

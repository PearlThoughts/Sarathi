# Implementation Plan: Compliance Reminders Contract

The bounded context lives at `src/modules/compliance-reminders/`.

```text
workspace-scoped source port
  -> compliance-reminders application
  -> idempotency/audit port + delivery port
```

Domain/application code uses existing generic follow-up types for digest formatting. Ports own source access, atomic idempotency reservation, durable delivery state, and message delivery. Infrastructure adapters and private configuration are deliberately deferred.

Verification is unit-level and deterministic: dry-run has no side effects; workspace mismatch is denied; duplicate keys suppress delivery; success and failure both produce audit records; failed delivery remains retryable.

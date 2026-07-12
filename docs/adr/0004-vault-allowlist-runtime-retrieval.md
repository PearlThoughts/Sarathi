# ADR 0004: Vault allowlist runtime retrieval

## Status

Accepted

## Context

Sarathi's Teams composition previously accepted a serialized Vault projection
through a Railway environment variable. That approach can place raw private
evidence into the deployment configuration, which violates the production
overlay boundary.

## Decision

The private overlay supplies `SARATHI_VAULT_ALLOWLIST_JSON` only. Every entry
identifies an approved workspace, source key, GitHub repository, repository
path, optional ref, sensitivity, and consent scope. It cannot include titles,
excerpts, note bodies, URLs, timestamps, or any other raw evidence fields.

At request time, the infrastructure Vault adapter retrieves only matching
allowlisted documents using the already-required read-only GitHub credential.
It derives a bounded normalized evidence record in memory and returns no
unallowlisted document. The runtime does not provide a compatibility path for
the raw projection environment variable.

## Consequences

- Git and Railway variables retain configuration references, never Vault text.
- The GitHub token must have read-only access to the explicitly allowlisted
  Vault repository.
- Missing or malformed allowlist configuration fails Teams readiness closed.
- Retrieval is auditable through source URLs and content-derived external IDs.

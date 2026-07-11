# Tasks: 1851 Teams Mention Production

## Foundation

- [ ] TM-001 Define `teams-mention` contracts and application use case under
  `src/modules/teams-mention/` with direct-mention, policy, injection, and
  idempotency tests.
- [ ] TM-002 Add private workspace mapping/actor-alias projection contracts;
  unknown and ambiguous identities must remain unresolved.
- [ ] TM-003 Add Postgres repository parity, additive migration, rollback, and
  restart tests.

## Read-Only Context

- [ ] TM-101 Implement bounded Graph thread reader.
- [ ] TM-102 Implement Jira Cloud reader for referenced/intent-linked issues.
- [ ] TM-103 Implement least-privileged GitHub App reader for linked evidence.
- [ ] TM-104 Implement Vault projection reader for approved artifacts only.
- [ ] TM-105 Assemble a sensitivity-filtered evidence envelope and source links.

## Teams and Model Edges

- [ ] TM-201 Implement Node 22 Agents SDK `/api/messages` ingress and
  same-thread sender.
- [ ] TM-202 Implement approved model adapter and fail closed when no approved
  provider is configured.
- [ ] TM-203 Add redacted audit/correlation/idempotency persistence, rate limits,
  timeouts, cancellation, and readiness checks.
- [ ] TM-204 Add Teams manifest, Agents Toolkit configuration, validation, and
  packaging.

## Operations

- [ ] TM-301 Provision Railway/Postgres and configure GitHub-source deployment.
- [ ] TM-302 Provision Entra/Bot registration and team-scoped RSC consent.
- [ ] TM-303 Install the package in 1851 Delivery Team and execute the real
  acceptance matrix.
- [ ] TM-304 Record private runbook/rollback/uninstall evidence without adding
  identifiers or secrets to this repository.

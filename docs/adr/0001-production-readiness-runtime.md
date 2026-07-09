# ADR 0001: Production Readiness Runtime Shape

## Status

Accepted

## Context

Sarathi is still pre-production. The first production-readiness milestone is not a Teams bot; it is a private evidence round trip that proves a delivery owner can reconcile a workspace pack, import real local evidence, and generate a useful drift review without leaking private data into the public repository or into team/client-visible outputs.

## Decision

Sarathi will use a single-tenant deployment shape for the next production-readiness slice.

Railway is the preferred hosted runtime for the Hono/Bun service once the report loop proves value. The service must expose `/health` and the existing runtime smoke endpoints before any Teams callback traffic is routed to it. Railway deployment remains guarded until project/service identifiers, secrets, auth, and rollback steps are configured.

SQLite remains the local/private runtime store for private workspace packs and the first evidence-review loop. The cloud path is Postgres with the same Strategy Kernel tables after the import/report contracts stabilize. SQLite databases used for private workspaces stay outside the public repository.

Teams bot work is deferred until the drift review proves value. The future callback endpoint should be a narrow authenticated route that receives Teams events, normalizes them into `evidence_item`, stores watermarks or event cursors, and never lets raw Teams content bypass boundary-policy checks.

Authentication and consent are mandatory before production traffic. Better Auth owns identity, sessions, organization/team membership, and coarse app roles. Sarathi policy owns source authorization, sensitivity, trust tier, tool authorization, approval, and model-egress decisions. Installation consent must explicitly cover the Teams/Jira/GitHub sources being imported.

Secrets belong in the deployment provider secret store and local developer secret tooling, never in workspace packs, fixtures, docs, PR bodies, or generated reports. Private report commands must write to explicit private paths instead of printing private report content to standard output.

Retention is source-scoped. Sarathi stores excerpts and hashes in `evidence_item`, not full raw exports by default. Private workspace operators need a retention window per source, a redaction path for sensitive evidence, and a way to regenerate reports after redaction. Team/client-visible outputs must apply a sensitivity ceiling before rendering.

Rollback is operational, not only Git-based. A bad import is rolled back by restoring the SQLite/Postgres database from backup or deleting records by source watermark inside a reviewed operator workflow. A bad hosted release is rolled back by Railway deployment rollback plus disabling inbound Teams callbacks. Bot posting remains approval-gated until rollback and audit paths are proven.

## Consequences

- Generic import/report code may live in the public repository, but real workspace packs, raw exports, SQLite databases, generated reports, and private paths must stay outside it.
- The first production proof is a private drift review generated from real evidence, not a deployed bot.
- CLI output for private file-backed commands reports counts and write status only.
- Postgres support should reuse the Strategy Kernel repository contract rather than introducing a second domain model.
- Future Teams deployment work must include callback authentication, event cursor storage, source consent, redaction, retention, audit, and rollback tests before being called production-ready.

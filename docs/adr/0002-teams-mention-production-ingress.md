# ADR 0002: Teams Mention Production Ingress

## Status

Accepted

## Context

ADR 0001 deferred Teams bot work while the first private evidence loop was
proved. That evidence loop now exists, and the next approved product milestone
is a direct `@Sarathi` question answered safely inside a mapped example Teams
thread.

The Microsoft 365 Agents SDK is the supported JavaScript activity lifecycle
and authentication surface. Its supported hosting quickstart is Express-based.
Bun compatibility is not proven for this SDK in Sarathi's production path.

## Decision

Sarathi will use Azure Bot Service for the Teams channel and a thin Node 22
Express ingress at `/api/messages`, using the official Agents SDK authentication
middleware. It normalizes an authenticated activity into the runtime-neutral
`teams-mention` capability. Sarathi policy and context assembly run behind that
adapter; no Bot Framework or Graph type enters domain/application code.

The deployment remains single-tenant. Real workspace mappings, actor aliases,
and approved Vault projection data stay in private deployment configuration.
The Teams app requests only `ChannelMessage.Read.Group` RSC for this initial
team-scoped installation. Source adapters are read-only. Postgres is required
in hosted environments and SQLite stays local/private.

## Consequences

- Production needs both Node 22 and the existing runtime code, with an explicit
  internal composition boundary.
- `/ready` becomes a meaningful production gate rather than a static success.
- Real Teams acceptance evidence is mandatory; endpoint reachability alone is
  insufficient.
- Action cards, proactive workflows, and broad retrieval remain deferred.

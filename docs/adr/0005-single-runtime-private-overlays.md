# ADR 0005: Single Runtime With Private Organization Overlays

## Status

Accepted

## Context

Organizations may adopt Sarathi first for one visible workflow and later add other workspaces or capabilities. Maintaining a separate Bot, runtime, or private code fork for each workflow duplicates identity, deployment, policy, evidence, and operational responsibility.

The open-source core must remain useful and inspectable without embedding organization-specific names, mappings, policies, or evidence. Organizations still need versioned confidential configuration and deployment intent.

## Decision

Each organization operates one single-tenant Sarathi runtime and one visible application identity. Multiple isolated workspaces and capability profiles run inside that deployment.

Reusable behavior belongs in the public Sarathi core. Organization-specific confidential non-secret configuration belongs in an organization-owned private overlay. The overlay may contain workspace identifiers, source mappings, schedules, recipients, allowlists, templates, and policy. It must not contain credentials, raw evidence, databases, embeddings, or another deployable Sarathi service.

Secrets remain in an approved secret manager. Runtime evidence and action state remain in transactional storage. The private overlay is rendered or reconciled into a validated deployment projection rather than copied manually into multiple platforms.

## Consequences

- A new workspace or capability does not create a second Bot or runtime.
- Workspace isolation is mandatory even when capabilities share code and infrastructure.
- Private overlays remain active repositories; archived legacy runtime material may be retained only as non-deployable reference.
- Public examples stay synthetic and community-safe.
- Operators need explicit disabled, shadow, and live promotion gates.
- Cross-workspace synthesis is an authorized projection, not unrestricted evidence access.

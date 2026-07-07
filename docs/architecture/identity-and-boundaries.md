# Identity And Boundaries

This document defines how Sarathi uses Better Auth without making Better Auth responsible for all authorization decisions.

## Better Auth Responsibility

Better Auth owns:

- user sessions,
- the installed organization for this deployment,
- organization membership inside that deployment,
- Better Auth teams inside the installed organization,
- coarse product roles such as owner, admin, maintainer, member, viewer, and agent.

The Better Auth organization plugin supports organization roles, custom permissions, and teams. Sarathi uses that as the identity and membership substrate, not as the complete data-sensitivity model.

Local development can run with `SARATHI_AUTH_MODE=static`, which returns no authenticated sessions and is only for unauthenticated foundation checks. Production must use `SARATHI_AUTH_MODE=better-auth-postgres` with `SARATHI_AUTH_DATABASE_URL` and `SARATHI_AUTH_SECRET`.

Sarathi is not a cloud-hosted multi-tenant SaaS in this architecture. Each customer or team installs the app in its own environment, so deployment isolation handles tenant isolation. Better Auth organizations model the installed organization's internal structure; they are not a cross-customer tenancy layer.

## Sarathi Responsibility

Sarathi owns:

- source-system authority mapping,
- communication structure,
- team topology,
- sensitivity tier,
- trust tier required for a data surface,
- delegation stage,
- model-egress policy,
- human approval requirements,
- evidence requirements.

These properties are compiled from observed source systems plus YAML overlays, then enforced by Sarathi policy checks before data retrieval, tool calls, and model egress.

## Modeling Rule

Use Better Auth organization/team membership for "who belongs to this installed organization/team." Use Sarathi policy boundaries for "what this user or agent may see or do in this context."

Do not encode sensitive domains only as Better Auth roles. A user may be a Better Auth `admin` while still needing explicit Sarathi approval to expose restricted HR, finance, legal, security, or payroll context to a model.

For Microsoft Teams entry points, Entra/Bot Framework identities must be resolved into Sarathi principals before boundary-policy decisions run. Unmapped external principals should fail closed until a trust tier is explicitly established.

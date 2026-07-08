# Public And Private Boundary

This document defines what belongs in the public Sarathi repository and what must stay in private workspace packs, vaults, or organization-specific deployments.

## Public Repository

The public repository should contain reusable product and engineering assets:

- domain model and schema,
- migrations,
- connector interfaces,
- generic Teams/Jira/GitHub/Vault adapters,
- rule engine,
- projection engine,
- accountability card framework,
- synthetic examples,
- test fixtures with invented organizations and people,
- architecture decisions,
- product requirements,
- implementation specs,
- community-safe documentation.

The public repository should be useful without any private customer or organization data.

## Private Workspace Repositories

Private workspace packs should contain organization-specific configuration and sensitive context:

- real workspace names when sensitive,
- client names and stakeholder mappings when sensitive,
- Teams team/channel/chat IDs,
- Jira project keys and filters,
- repository mappings,
- vault folder mappings,
- goal registers,
- accepted commitments,
- extracted evidence,
- private policies,
- generated reports,
- credentials and secret references,
- sensitive rationale and tradeoff notes.

Private packs should not fork product logic. They configure and seed the product.

## Vault Records

Human-readable governance records can live in a private vault or policy repository:

- decision records,
- goal and commitment snapshots,
- internal rationale,
- stakeholder-specific context,
- sensitive lessons learned,
- reports intended for leadership only.

Sarathi may publish to the vault through projections, but the vault remains the readable governance surface for humans.

## Synthetic Examples

Public examples should use invented data:

- fake organization,
- fake client,
- fake project,
- fake channels,
- fake tickets,
- fake people,
- fake PRs.

Synthetic examples should preserve the structure of real delivery problems without copying private wording, names, links, or incident details.

## Visibility Strata

Every intent node and evidence item should carry visibility:

- `private`: visible only to system owners or explicitly authorized operators.
- `leadership`: visible to leadership and operating owners.
- `team`: visible to the workspace delivery team.
- `stakeholder`: safe for external stakeholder surfaces.
- `public`: safe for open-source examples and documentation.

Visibility must be enforced before retrieval, before projection, before bot messages, and before model egress.

## Open Source Development Rule

When a feature requires private context to explain why it exists, split the work:

- public repo: generic capability, API, schema, tests, and synthetic examples,
- private vault or workspace pack: private rationale, real mappings, and sensitive adoption notes.

This keeps Sarathi open and inspectable while preserving organization-specific trust boundaries.


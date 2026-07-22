# Attributed Delivery Context Notes

> **Status: WIP design reference — do not merge as-is.** This checkpoint predates
> ADR 0008 and the continuous-intelligence task split. Resume it under
> `sar-2du.11`, primarily KLG-523 and KLG-526. Before integration, move the
> assertion contract into the delivery-intelligence domain/application boundary,
> add schema versioning, aliases, stable author identity, confidence independent
> of source authority, explicit supersession, and permanent authorization,
> version, deletion, conflict, and retrieval tests.

Use a configured Vault note for delivery knowledge that is known by a person but is not yet represented accurately in Jira, GitHub, or Teams. The note remains the canonical human-readable source; PostgreSQL stores its versioned retrieval projection.

```yaml
---
sarathi_delivery:
  subject:
    kind: module
    key: product-builder
    title: Product Builder
  asserted_by: Delivery Lead
  asserted_at: 2026-07-22T10:00:00Z
  effective_from: 2026-07-01T00:00:00Z
  authority: 0.8
---
```

Use ordinary Markdown headings below the frontmatter. Recognized headings include Status, Scope, Goals, Requirements, Ownership, Dependencies, Risks, Decisions, Next Action, Milestones, and Social Context or Human Observations.

- Put durable delivery state and rationale in the note.
- Put executable commitments, owners, dates, and acceptance criteria in Jira.
- Let Teams and GitHub provide observed activity signals.
- State interpretations as attributed observations, not objective facts. Include an `effective_to` date when the assertion should expire.
- Update or delete the source note to supersede or remove its indexed claims. Vault revision, ACL, sensitivity, authority cap, effective dates, and deletion state remain attached before retrieval or model egress.

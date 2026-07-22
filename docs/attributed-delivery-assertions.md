# Attributed Delivery Assertions

Attributed delivery assertions capture project knowledge that a person can support but that is not yet represented accurately in a connected system. The configured Markdown note remains the human-readable source of truth. Sarathi stores a versioned, cited, permission-bound projection in PostgreSQL.

Use this frontmatter only inside a configured Vault root:

```yaml
---
sarathi_delivery:
  schema_version: 1
  assertion_id: delivery/example-module/2026-07-22
  subject:
    kind: module
    key: example-module
    title: Example Module
    aliases:
      - module alias
  author:
    id: entra:stable-person-id
    display_name: Delivery Lead
  asserted_at: 2026-07-22T10:00:00Z
  effective_from: 2026-07-01T00:00:00Z
  confidence: 0.8
  supersedes:
    - delivery/example-module/2026-07-15
---
```

Ordinary Markdown headings below the frontmatter become cited claims. Recognized delivery headings include Status, Scope, Goals, Requirements, Ownership, Dependencies, Risks, Decisions, Next Action, Milestones, Human Observations, and Social Context.

Contract rules:

- `assertion_id`, `subject.key`, and `author.id` are stable identifiers. Display names and aliases may change without changing identity.
- `confidence` records the author's confidence and is independent of the configured source authority. Source authority cannot be raised from note content.
- `effective_from` and `effective_to` describe business validity; `asserted_at` records when the person made the assertion.
- `supersedes` names earlier assertion envelopes. A current correction suppresses the earlier claim before model egress, even when the viewer cannot access the correction. Deleting the correction makes the earlier active source claim eligible again.
- The source revision, ACL, sensitivity, citation, author, confidence, and effective dates remain attached to every projected claim.
- Editing, deleting, renaming, or moving the note follows normal immutable Vault reconciliation. Control frontmatter is validated but is not embedded as knowledge content.

Put executable commitments, owners, dates, and acceptance criteria in the connected work tracker when possible. Use attributed assertions for durable human context, interpretations, corrections, and rationale—not as a way to bypass source permissions or the finance boundary.

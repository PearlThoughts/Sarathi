# Private Workspace Packs

Sarathi public code and fixtures stay synthetic. Real organization workspace packs belong outside this public repository.

## Location Contract

- Store private packs outside the public checkout, for example under a private vault or private policy repository.
- Point local tooling at that directory with `SARATHI_PRIVATE_WORKSPACE_PACK_DIR`.
- Keep private packs out of `docs/`, `tests/`, committed fixtures, PR descriptions, and generated examples.
- Current public CLI commands use synthetic in-memory fixtures only. File-backed private pack loading from `SARATHI_PRIVATE_WORKSPACE_PACK_DIR` is the follow-up integration point, not public-repo fixture data.

## Required Shape

Private packs use the same versioned contract as public synthetic packs:

- `workspace.yaml`
- `actors.yaml`
- `mappings/jira.yaml`
- `mappings/teams.yaml`
- `mappings/github.yaml`
- `mappings/vault.yaml`
- `policies/accountability.yaml`
- `policies/deploy-readiness.yaml`
- `policies/qa-evidence.yaml`
- `policies/visibility.yaml`
- `seeds/goals.yaml`
- `seeds/commitments.yaml`
- `seeds/bets.yaml`
- `templates/daily-delivery-brief.md`
- `templates/drift-review.md`
- `templates/client-update.md`

## Reconciliation Rules

Pack loading is reconciliation, not overwrite:

- Create missing workspace config.
- Propose seed intent as candidates.
- Tighten policy when the pack is stricter.
- Create review items when a pack conflicts with ratified runtime intent, completed actions, or human-edited decisions.

Do not include real Teams IDs, Jira keys, repository names, client names, or private note paths in public tests or docs.

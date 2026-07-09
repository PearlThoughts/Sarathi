# Private Workspace Packs

Sarathi public code and fixtures stay synthetic. Real organization workspace packs belong outside this public repository.

## Location Contract

- Store private packs outside the public checkout, for example under a private vault or private policy repository.
- Point local tooling at that directory with `--pack <path>` or `SARATHI_PRIVATE_WORKSPACE_PACK_DIR`.
- Point durable local runtime state at SQLite with `--db <path>` or `SARATHI_DB_PATH`.
- Keep private packs out of `docs/`, `tests/`, committed fixtures, PR descriptions, and generated examples.
- Current public CLI commands stay synthetic by default. File-backed reconciliation is explicit and requires a pack directory plus a SQLite database path.
- CLI output for file-backed reconciliation is a safe summary. It reports counts and non-identifying workspace shape only; it does not print actor names, external IDs, source paths, Jira keys, repository names, Teams IDs, or vault paths.

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

## Public Synthetic Fixture

The public repository includes a synthetic fixture at `tests/fixtures/workspace-packs/launchpad/`.
It mirrors the private-pack directory shape for tests and demos, but every identifier is placeholder data.

Example local dry run:

```bash
bun run src/cli/release.ts workspace reconcile \
  --pack tests/fixtures/workspace-packs/launchpad \
  --db /tmp/sarathi-runtime.sqlite
```

The command creates missing workspace config, persists pack policies/templates, and proposes seed intent as candidate intent nodes. It does not overwrite ratified or human-edited runtime intent; conflicts become pack drift findings.

# How Sarathi Works

Sarathi combines one visible bot with scoped policy and work context behind it.

## Workspace

A workspace is the project/client/team boundary Sarathi uses to reason about delivery.

It can bind:

- Teams team, channel, thread, or group chat,
- Jira project, board, epic, sprint, release, or JQL filter,
- GitHub repos and GitHub Actions logs,
- policy repo or Obsidian-compatible vault,
- spreadsheet or document for budget, plan, or staffing,
- future sources such as helpdesk, CRM, CodeCompass, and MCP agent sessions.

Different teams use different delivery processes. Sarathi should not force one process model. It should draft a workspace map, ask the PM to correct it, then compile the approved version.

## Policy Repo

Ratified delivery knowledge lives in a git-backed policy repo as Markdown/YAML:

- project intent,
- milestone plan,
- team profile,
- process FAQ,
- definition of done,
- escalation policy,
- learned preferences.

Obsidian can edit this repo, but Obsidian is not a hard dependency. VS Code, GitHub, or any Markdown editor should work.

## Work Signals

Observed work events live in runtime storage:

- Teams messages and threads,
- Jira issues and transitions,
- GitHub commits and PRs,
- CI results,
- source links and citations.

This data is not stored in the policy repo because it is high-volume, access-controlled, and transactional.

Connected Jira records, Teams channel messages, project-email records, and GitHub activity do not need per-record approval before they contribute to an internal delivery answer. Sarathi trusts that the source event occurred, attributes interpretations as claims, and exposes conflicts instead of silently choosing a winner.

Non-financial project context is visible to mapped workspace members within the configured sensitivity ceiling. Finance remains a separate confidential boundary and fails closed without an explicit entitlement.

## Learning

Sarathi should not silently learn through opaque memory.

The loop is:

1. Observe work signals.
2. Infer a possible rule, FAQ, preference, or risk.
3. Ask the PM or authorized lead to approve, edit, or reject.
4. Store ratified learning in the policy repo.
5. Compile it into runtime policy, memory, and indexes.

## Storage Split

- **Ratified policy and intent:** Markdown/YAML in a git-backed policy repo and queryable Strategy Kernel state.
- **Delivery objects, relations, claims, metrics, and events:** SQLite for local operation; Postgres for the hosted single-tenant runtime.
- **Loop state, timers, audit, and idempotency:** transactional SQLite or Postgres state according to deployment mode.
- **Retrieval memory:** rebuildable full-text or vector indexes derived from canonical source records.

Glean is a competing lookup category, not Sarathi's memory layer. Opaque memory blobs weaken the product's trust story. A hosted Postgres database does not imply SaaS multi-tenancy; one deployment still serves one organization.

# How Sarathi Works

Sarathi combines one visible bot with scoped policy and evidence behind it.

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

## Evidence Plane

Observed work events live in runtime storage:

- Teams messages and threads,
- Jira issues and transitions,
- GitHub commits and PRs,
- CI results,
- source links and citations.

This data is not stored in the policy repo because it is high-volume, access-controlled, and transactional.

## Learning

Sarathi should not silently learn through opaque memory.

The loop is:

1. Observe work signals.
2. Infer a possible rule, FAQ, preference, or risk.
3. Ask the PM or authorized lead to approve, edit, or reject.
4. Store ratified learning in the policy repo.
5. Compile it into runtime policy, memory, and indexes.

## Storage Split

- **Ratified policy and intent:** Markdown/YAML in a git-backed policy repo.
- **Evidence and events:** SQLite evidence store.
- **Loop state and timers:** SQLite transactional state.
- **Retrieval memory:** LanceDB or rebuildable indexes.

Postgres, Glean, and mem0 are not v1 dependencies. Postgres is only for future hosted multi-tenant scale. Glean is a competing lookup category, not Sarathi's memory layer. Opaque memory blobs weaken the product's trust story.

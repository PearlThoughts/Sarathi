# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd prime` for full workflow context.

> **Architecture in one line:** Issues live in a local Dolt database
> (`.beads/dolt/`); cross-machine sync uses `bd dolt push/pull` (a
> git-compatible protocol), stored under `refs/dolt/data` on your git
> remote — separate from `refs/heads/*` where your code lives.
> `.beads/issues.jsonl` is a passive export, not the wire protocol.
>
> See [SYNC_CONCEPTS.md](https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md)
> for the one-screen overview and anti-patterns (don't treat JSONL as the
> source of truth; don't `bd import` during normal operation; don't
> reach for third-party Dolt hosting before trying the default).

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd dolt push          # Push beads data to remote
```

## Sarathi Architecture

Sarathi uses a domain-first TypeScript service shape:

- `src/domain` holds shared policy primitives.
- `src/modules/*` holds bounded contexts. Other code imports each context through its public `index.ts`.
- Inside a module, add `domain`, `application`, `ports`, and `api` folders only when that layer has real code.
- `src/infrastructure` implements external adapters such as Better Auth and YAML.
- `src/platform` wires runtime composition and Hono routes.

Sarathi is single-tenant per deployment. Better Auth owns identity, session, installed-organization membership, team membership, and coarse roles for that deployment. Sarathi policy owns sensitivity, trust tier, source authorization, tool authorization, approval, evidence, and model-egress decisions.

YAML overlays declare scope and policy intent. They do not enforce security by themselves. Enforcement must happen before retrieval, before tool invocation, and before model egress.

## Tests

```bash
bun install
bun run check
bun run runtime:smoke
```

The local CI equivalent is `bun run check`.

## Live Teams Acceptance Reporting

Every agent that completes a live Sarathi test in Microsoft Teams must report the
test in the active user conversation immediately after the response is observed.
Do not defer this evidence to the final handoff, a Bead, a PR, or a log file.

Each report must include:

- the exact user-visible request sent to Sarathi;
- the exact user-visible Sarathi response, preserving its line structure and
  citation labels;
- a clickable Teams permalink to the request or response thread that the user can
  open to verify the exchange;
- observed start and completion timestamps plus end-to-end latency;
- the initiating identity, team, channel, thread, workspace, and audience when
  available;
- the inferred question intent and any scope, sprint, entity, time-window, or
  confidentiality criteria used to plan the answer;
- the sources requested, attempted, selected, excluded, unavailable, or in
  conflict, identified by source type and resolvable citation rather than by
  copying hidden source bodies;
- privacy-safe execution diagnostics such as retrieval counts, duplicate
  suppression, permission filtering, provider/fallback path, model timing, and
  bounded failure classifications when observable.

The conversation report is part of acceptance. A test is not complete until the
user can review both the rendered exchange and its Teams permalink. If Teams does
not expose a resolvable permalink, report that as a failed acceptance criterion;
do not substitute a screenshot, message ID, or locally constructed URL and call
the test complete.

Never include provider keys, authorization headers, cookies, hidden prompts,
chain-of-thought, private evidence bodies, or raw browser/network dumps in the
conversation report, Beads, commits, PRs, CI output, or retained artifacts. If a
user-visible request or response itself contains a credential, redact only the
credential, label the redaction, and fail the privacy acceptance check. Keep
underlying evidence access governed by the runtime even when the rendered answer
is intentionally visible to the 1851 workspace.

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->

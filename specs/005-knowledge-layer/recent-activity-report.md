# Sub-Spec: Recent Delivery Activity Report

## Purpose

This child capability adds a fast, date-bounded answer path for questions such as “What did the team do today?” It complements the knowledge layer without turning historical retrieval into the product’s primary identity and without creating a separate bot, product plan, or persistent activity index.

## Scope

- Detect explicit daily or recent-delivery-summary questions after workspace and caller authorization.
- Read approved GitHub repositories, Jira projects, and standard Teams channels live within a workspace-local calendar window.
- Normalize, deduplicate, rank, and compose the result into at most three cited lines.
- Enforce workspace, caller, channel, sensitivity, and source allowlists before any source request or answer composition.
- Return a useful partial result when one source is unavailable, while naming the unavailable source.
- Bound the activity path so Teams can receive a response in less than ten seconds end to end.
- Keep Jira and Teams activity ephemeral; this capability does not broaden persistent Teams history or email ingestion.

## Scope by Stream

- `github-activity` -> live approved pull-request and commit APIs
- `jira-activity` -> live approved issue-search and bounded changelog APIs
- `teams-activity` -> live messages from explicitly approved standard channels

## Data Contracts

- `DeliveryActivityItem` per source result with:
  - stable source identifier and activity kind
  - workspace and sensitivity boundary
  - occurred-at timestamp inside the requested window
  - concise action summary
  - resolvable HTTPS citation
  - source authority
- `DeliveryActivityReport` per request with:
  - at most three newline-separated source summaries
  - citations embedded in the response text
  - explicit unavailable-source names
  - status (`ok|partial|empty`)
- Source errors must identify only the affected source and must not include credentials or private message bodies.

## Agent Role

`AI Delivery Assistant` owns intent routing, authorized live retrieval, bounded synthesis, and concise Teams delivery. Source APIs remain authoritative and Sarathi does not write back in this capability.

## Actions

1. Classify explicit recent-activity questions without intercepting ordinary project-status questions.
2. Calculate the current workspace-local day as an exact UTC half-open interval.
3. Filter authorized source scopes before performing live GitHub, Jira, or Teams requests.
4. Run bounded source reads concurrently and suppress duplicate URLs and merge commits already represented by pull requests.
5. Compose one concise line per source, with resolvable citations and explicit partial-source status.
6. Deliver through the existing Teams reply path without invoking the language model for this deterministic report intent.

## Exit Criteria

- A permanent test proves unauthorized workspaces, actors, repositories, projects, and channels cause no source call.
- A permanent test proves only items inside the workspace-local calendar window appear.
- A permanent test proves duplicate activity is suppressed and citations remain resolvable.
- A permanent test proves one unavailable source yields an explicit partial report without leaking source content into logs.
- Exact-branch `bun run check` passes.
- A real Teams question produces a relevant GitHub/Jira/Teams report in less than ten seconds end to end.
- The application and production configuration have recorded rollback anchors before deployment.

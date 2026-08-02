# Delivery Synchronization Operations

Sarathi runs all continuous source adapters through one checkpointed PostgreSQL workflow. Events accelerate synchronization; hourly reconciliation remains the correctness path for missed, delayed, duplicate, out-of-order, edited, deleted, renamed, and out-of-scope records.

## Commands

```text
bun run delivery sync backfill all
bun run delivery sync events jira --event-id <provider-id> --payload-hash sha256-<digest>
bun run delivery sync reconcile all
bun run delivery sync subscriptions teams
bun run delivery sync status all
```

`backfill` ignores the previous cursor and asks each configured adapter for its bounded historical inventory. GitHub and Teams default to six months when the private configuration does not declare an earlier `historySince` boundary.

`events` accepts one provider event identity and a precomputed payload hash. It never accepts or stores an event body. A duplicate completed identity returns without fetching the source again. Accepted and retryable identities fetch the authoritative source before advancing a checkpoint.

`reconcile` reads the durable cursor, takes one expiring lease shared by every trigger for that source, renews it during long reads, fetches authoritative changes, commits projections and tombstones, then records the terminal run. The hosted runtime checks each source independently every 15 minutes by default, so one unavailable provider cannot prevent the other repair paths. Source checkpoints still enforce their configured hourly repair cadence; the shorter scheduler interval gives short-lived Teams subscriptions multiple renewal opportunities before expiry. A new scheduled tick starts only after the active tick has finished; the interval is measured from completion so a long bootstrap cannot create overlapping in-process repair loops. Configure `SARATHI_SYNC_SCHEDULER_ENABLED=true` in production; `SARATHI_SYNC_RECONCILE_INTERVAL_SECONDS` and `SARATHI_SYNC_INITIAL_DELAY_SECONDS` may override the scheduler interval and first-run delay.

Teams message reads pace each admitted channel or chat independently at [Microsoft Graph's documented per-resource rate](https://learn.microsoft.com/en-us/graph/throttling-limits#microsoft-teams-service-limits). Retryable 429, 500, 502, 503, and 504 responses honor `Retry-After` and apply a bounded exponential floor when the provider returns zero or no useful delay; transient transport failures use the same bounded backoff. Authorization and other deterministic client errors still fail immediately. Provider instability therefore delays or safely rejects the atomic reconciliation instead of committing a partial corpus.

`subscriptions teams` creates, renews, or recreates one Microsoft Graph change-notification subscription for every configured conversation whose projection enables notifications. An explicitly admitted private channel can instead declare `notificationSubscription: reconciliation_only` because Microsoft Graph does not support RSC message subscriptions for that scope; the hourly authoritative read remains its correctness path. The hosted repair loop invokes subscription repair before source reconciliation, and it should also run during bounded deployment verification. Provider resource URLs and client state remain outside command output; PostgreSQL stores only provider identity, a resource hash, and lifecycle timestamps.

Microsoft Graph posts validation and change/lifecycle notifications to `/api/teams/notifications` on the strict API host. Validation tokens are echoed as plain text. Accepted notifications are reduced to one stable event identity and payload hash, acknowledged with HTTP 202, and then cause an authoritative Teams source refresh. Lifecycle events renew subscriptions before refreshing. Notification bodies and client state are neither persisted nor logged; hourly reconciliation repairs any event lost during process interruption.

`status` exits successfully only when every selected source has a successful checkpoint inside `SARATHI_SYNC_STALE_AFTER_SECONDS`, which defaults to two hours. Output is limited to source identity, scope hashes, timestamps, lag, subscription state, lease metadata, run state, counts, and checksums. Raw provider cursors and indexed source revisions remain private in PostgreSQL and are never printed.

`bun run knowledge status` also reports count-only embedding cache progress by workspace, source, model, and dimensions. The cache stores content hashes and vectors, never source bodies. Completed chunks survive provider failures and process replacement; the cache is cleared only in the same transaction that commits projections and the successful checkpoint.

GitHub synchronization honors provider reset and retry headers. It uses the recursive Git tree as the authoritative path and blob-identity inventory, then streams one commit archive for each repository with changed eligible code instead of consuming one REST request per file. Only configured, non-sensitive, non-generated code paths from the tree are retained; binary, oversized, missing, and archive/tree-mismatched entries fail closed or become tombstones under the existing policy. When the approved portfolio exhausts the core API quota, the active operation keeps its lease heartbeat, waits within a bounded retry budget, and resumes the exact failed request instead of restarting the snapshot.

## Configuration boundary

The existing Jira and Vault settings remain authoritative. Continuous repository and collaboration configuration use:

```text
SARATHI_KNOWLEDGE_GITHUB_CONFIG_JSON
SARATHI_KNOWLEDGE_TEAMS_CONFIG_JSON
SARATHI_SYNC_OWNER_ID
SARATHI_SYNC_LEASE_SECONDS
SARATHI_SYNC_STALE_AFTER_SECONDS
SARATHI_SYNC_SCHEDULER_ENABLED
SARATHI_SYNC_RECONCILE_INTERVAL_SECONDS
SARATHI_SYNC_INITIAL_DELAY_SECONDS
SARATHI_TEAMS_NOTIFICATION_URL
SARATHI_TEAMS_LIFECYCLE_NOTIFICATION_URL
SARATHI_TEAMS_NOTIFICATION_CLIENT_STATE
```

The GitHub configuration declares a source ID, approved repositories, ACLs, sensitivity, exclusions, and optional history boundary. The Teams configuration declares a source ID, approved channels, labels, ACLs, sensitivity, and optional history boundary. `SARATHI_SYNC_OWNER_ID` is a deployment-owner prefix; every command derives a unique hashed execution owner so an overlapping tick or replacement process cannot re-enter another invocation's lease. Values belong in the private overlay or protected runtime variables, not the public repository.

Every source body is authorized and normalized inside its adapter, then persisted only through the existing knowledge and delivery repositories. Provider credentials, event bodies, message bodies, document bodies, code bodies, and private configuration are excluded from command output and synchronization-control records.

## Recovery

An expired lease can be acquired by another worker. Failed runs retain a failure class and do not advance the authoritative checkpoint. Replaying the event or running hourly reconciliation is safe; successfully cached embedding chunks are reused on the retry. Application rollback uses the previous Sarathi revision; the additive synchronization tables, cached vectors, and checkpoints remain available for the restored revision.

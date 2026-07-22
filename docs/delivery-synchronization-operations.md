# Delivery Synchronization Operations

Sarathi runs all continuous source adapters through one checkpointed PostgreSQL workflow. Events accelerate synchronization; hourly reconciliation remains the correctness path for missed, delayed, duplicate, out-of-order, edited, deleted, renamed, and out-of-scope records.

## Commands

```text
bun run delivery sync backfill all
bun run delivery sync events jira --event-id <provider-id> --payload-hash sha256-<digest>
bun run delivery sync reconcile all
bun run delivery sync status all
```

`backfill` ignores the previous cursor and asks each configured adapter for its bounded historical inventory. GitHub and Teams default to six months when the private configuration does not declare an earlier `historySince` boundary.

`events` accepts one provider event identity and a precomputed payload hash. It never accepts or stores an event body. A duplicate completed identity returns without fetching the source again. Accepted and retryable identities fetch the authoritative source before advancing a checkpoint.

`reconcile` reads the durable cursor, takes one expiring lease shared by every trigger for that source, renews it during long reads, fetches authoritative changes, commits projections and tombstones, then records the terminal run. Invoke `reconcile all` hourly through the existing deployment scheduler.

`status` exits successfully only when every selected source has a successful checkpoint inside `SARATHI_SYNC_STALE_AFTER_SECONDS`, which defaults to two hours. Output is limited to source identity, cursor and scope hashes, timestamps, lag, subscription state, lease metadata, run state, counts, and checksums.

## Configuration boundary

The existing Jira and Vault settings remain authoritative. Continuous repository and collaboration configuration use:

```text
SARATHI_KNOWLEDGE_GITHUB_CONFIG_JSON
SARATHI_KNOWLEDGE_TEAMS_CONFIG_JSON
SARATHI_SYNC_OWNER_ID
SARATHI_SYNC_LEASE_SECONDS
SARATHI_SYNC_STALE_AFTER_SECONDS
```

The GitHub configuration declares a source ID, approved repositories, ACLs, sensitivity, exclusions, and optional history boundary. The Teams configuration declares a source ID, approved channels, labels, ACLs, sensitivity, and optional history boundary. Values belong in the private overlay or protected runtime variables, not the public repository.

Every source body is authorized and normalized inside its adapter, then persisted only through the existing knowledge and delivery repositories. Provider credentials, event bodies, message bodies, document bodies, code bodies, and private configuration are excluded from command output and synchronization-control records.

## Recovery

An expired lease can be acquired by another worker. Failed runs retain a failure class and do not advance the authoritative checkpoint. Replaying the event or running hourly reconciliation is safe. Application rollback uses the previous Sarathi revision; the additive synchronization tables and checkpoints remain available for the restored revision.

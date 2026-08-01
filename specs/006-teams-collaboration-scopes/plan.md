# Implementation Plan: Bounded Teams Collaboration Scopes

## Delivery slices

1. Introduce the public conversation and reply-target discriminated unions. Normalize inbound activities and deny unsupported kinds before workspace resolution while retaining legacy standard-channel authorization.
2. Add a versioned projection, membership-resolution port, resource-scoped Graph adapters, bounded freshness, and audience/corpus grants. Migrate admitted standard channels through the private overlay.
3. Admit the explicitly configured meeting/group chat after installation, RSC, membership, same-chat delivery, and duplicate-delivery evidence are proven.
4. Add bounded queueing, lease renewal, concurrency tests, and operational disable controls.
5. Add private-channel support only after current package, channel-installation, roster, and consent requirements are proven. Keep shared channels denied.

Each slice uses a fresh feature worktree, a governed issue-linked pull request, self-review, and the full local CI-equivalent suite from the exact branch before merge.

## Architecture boundaries

- `teams-mention/domain` owns normalized conversation identity, caller identity, reply target, and resolved request context.
- `teams-mention/application` owns authorization-before-use orchestration and fail-closed outcomes.
- Graph infrastructure resolves installed-app consent and current resource membership through ports.
- The private deployment projection maps concrete resources, audiences, corpus grants, and actor policy.
- `delivery-intelligence` remains the structured capability-first reporting product.
- `teams-ingress` remains an adapter that normalizes Bot Framework activities and delivers through the provided reply target.

## Migration safety

Legacy unversioned projections stay standard-channel-only with explicit actors. The v2 parser is additive and explicit; it cannot reinterpret a legacy mapping as team-membership authorization. Runtime denial for shared and personal scopes lands before any manifest change. Manifest capability upgrades are last, after corresponding Graph proof and runtime tests.

No live Teams test message is sent without separate operator authorization.

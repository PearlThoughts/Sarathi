# Contract: Product Model Query And Command API

## Request Context

Every operation receives a server-resolved context containing organization, workspace, authenticated actor, trust tier, effective audience, maximum sensitivity, model-egress policy, permitted corpus scopes, request ID, and surface. Browser-supplied identity or workspace claims are inputs to authentication, not authority.

## Queries

The initial transport surface is versioned under `/v1/workspaces/{workspaceId}/product-model`. It exposes `GET /map`, `GET /entities/{entityId}`, `GET /entities/{entityId}/subgraph`, `GET /coverage`, and `GET /availability`. Transport paths are adapters over the application query contracts below; they do not expose repository query parameters or arbitrary graph traversal.

- `GetProductMap`: primary hierarchy at a revision or valid time, with bounded summary fields.
- `GetCapabilitySubgraph`: one entity, ancestors, descendants, and selected typed relations within bounded depth.
- `GetFeatureDossier`: identity, aliases, variants, invariants, availability, delivery summary, technical links, evidence coverage, and proposals.
- `GetProductGraphAtTime`: historical hierarchy and relations valid at a requested instant.
- `ListChangeProposals`: authorized proposals by state, age, source class, or affected entity.
- `PreviewProductChange`: audience-filtered semantic diff, invariant results, affected references, and required approvals.
- `GetProductCoverage`: stale, contested, unmapped, ambiguous, or weakly supported areas.
- `GetProductAvailability`: entity plus resolved variant, environment, build, flag, and delivery/verification stages.

Query envelopes return `workspaceId`, `asOf`, `revision`, `entities`, `relations`, `page`, `coverage`, and safe warnings. They never return evidence bodies merely because the caller can see a product entity.

## Commands

Mutation uses `POST /changes/preview` and `POST /commands`. Product Studio authenticates through the browser identity boundary and calls these endpoints from its server-side adapter; Sarathi resolves the installed organization, workspace membership, audience, trust, and policy independently.

- `ProposeEntity`, `RatifyEntity`, `ContestEntity`
- `RenameEntity`, `MoveEntity`
- `AddRelation`, `RemoveRelation`
- `MergeEntities`, `SplitEntity`
- `CreateVariant`, `ChangeVariantPrecedence`
- `DeprecateEntity`, `RetireEntity`, `SupersedeEntity`
- `PromoteAudience`, `ResolveProposal`

Every command includes:

```json
{
  "type": "MoveEntity",
  "workspaceId": "workspace-id",
  "targetId": "product-entity-id",
  "expectedRevision": 12,
  "idempotencyKey": "opaque-request-key",
  "justification": "Product owner approved the revised boundary",
  "payload": {
    "newParentId": "product-entity-id"
  }
}
```

The transport resolves actor and audience; the client cannot select them. A successful result contains `status`, `revision`, `eventId`, changed IDs, and projection state. Rejections are typed as unauthorized, stale revision, invalid graph, ambiguous variant, incomplete merge/split disposition, approval required, or idempotency conflict.

## Preview And Commit

Preview is side-effect free and returns a short-lived `previewToken` bound to command hash, actor, workspace, policy version, and expected revision. Commit revalidates all rules; a preview never reserves authority or guarantees success.

Commands execute transactionally. Domain state, revision, identity events, audit, and outbox records commit together. Projection consumers are idempotent and cannot expand the originating audience.

## Payload Integration

Product Studio uses an authenticated server-side adapter. Read views call query endpoints. Form actions call preview and command endpoints. Payload hooks may improve editor behavior, but they are not an enforcement boundary.

Payload-owned drafts may contain editorial text and pending form state. They reference Sarathi entity IDs and revisions. On stale revision, the editor must reload the Sarathi diff and deliberately reapply or discard the draft.

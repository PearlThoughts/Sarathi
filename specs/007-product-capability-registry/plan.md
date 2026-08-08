# Implementation Plan: Product Capability Registry And Product Studio

## Architecture Decision

Introduce a proposed `product-model` bounded context that owns stable business product identity and governed evolution. `delivery-intelligence` continues to own delivery episodes, period census, report products, and answer composition. It receives a ratified capability projection through a public port instead of maintaining an unrelated ontology.

Payload CMS is an optional human-surface adapter called Sarathi Product Studio. It may use the same PostgreSQL cluster, but it must have separate schemas, roles, migrations, and ownership. Payload reads Sarathi APIs and submits Sarathi commands; it has no write privilege on product-model tables.

## Boundary Map

- `product-model/domain`: entities, hierarchy, relations, variants, registration, lifecycle, revisions, identity events, and invariants.
- `product-model/application`: authorized queries, previews, commands, proposal review, and projection rebuild coordination.
- `product-model/ports`: repositories, evidence references, audit, clock, identity, policy, and projection notifications.
- `product-model/api`: Hono transport contracts for the browser and machine clients.
- `boundary-policy`: authorization before graph read, evidence expansion, preview, command, or model egress.
- `delivery-intelligence`: consumes ratified registry IDs and produces the existing capability ledger and report inputs.
- `knowledge-layer`: resolves authorized evidence and citations without owning product identity.
- `strategy-kernel`: links goals, commitments, decisions, and policy to product entities.
- Payload: renders maps, dossiers, proposals, diffs, and coverage; stores only editorial/UI state it owns.
- Backstage: optional read projection for technical artifacts and ownership links.

## Persistence Plan

Use normalized PostgreSQL tables and Drizzle migrations. The authoritative hierarchy is an adjacency list with one active parent edge per structural entity. Recursive CTEs provide ancestors, descendants, paths, depth, and cycle-safe impact traversal.

Maintain typed non-hierarchical edges separately. Add a rebuildable closure table only after measured query evidence shows recursive traversal is insufficient for common ancestry, audience, or policy checks. An `ltree` or materialized path may later be a read projection, never the source of identity or hierarchy truth.

All domain changes run in one transaction and append a revision plus identity/audit events. Business validity (`valid_from`, `valid_to`) is distinct from system history (`recorded_at`, `superseded_at`).

## Product Studio Write Flow

1. Query the authorized graph or dossier with its revision.
2. Edit a local form or Payload-owned draft.
3. Submit a preview command with actor context, expected revision, and idempotency key.
4. Sarathi authorizes the request and validates graph, variant, identity, sensitivity, and reference invariants.
5. Sarathi returns an audience-filtered impact diff and warnings.
6. Submit the approved command.
7. Sarathi commits the domain transaction, revision, audit event, and outbox notification.
8. Delivery and technical projections update idempotently; Product Studio refreshes from Sarathi.

Payload versions help recover editorial drafts. Sarathi revisions prove domain decisions. Neither substitutes for the other.

## Delivery Slices

1. Add domain contracts, fixtures, graph invariants, and in-memory repositories without changing reporting.
2. Add PostgreSQL/Drizzle persistence, recursive traversal, revision history, and migration tests.
3. Add authorized query, preview, and command APIs with idempotency and optimistic concurrency.
4. Project ratified IDs into the existing `CapabilityLedger`; migrate aliases and corrections additively.
5. Add evidence-backed proposals and coverage projections from already authorized sources.
6. Build Product Studio read-only map and dossier views.
7. Enable governed edits after preview, audit, rollback, accessibility, and authorization acceptance.
8. Add optional Backstage and runtime-observability projections after the registry is stable.

## Verification Strategy

- Domain tests: kind compatibility, single parent, cycle rejection, rename/move, merge/split, redirect, variant precedence, proposal expiry, and bitemporal queries.
- Repository tests: migration preservation, transaction rollback, optimistic concurrency, idempotency, recursive paths, rebuildable projections, and workspace isolation.
- Authorization tests: deny before storage/evidence/model access; claim/evidence sensitivity separation; audience-filtered impact previews.
- Contract tests: stable query envelopes and exhaustive command outcomes.
- Compatibility tests: current period census, capability grouping, citation validation, and safe-failure paths remain unchanged.
- UI tests: keyboard-accessible tree/table alternative, semantic zoom, large-map rendering, impact preview, and stale-revision recovery.
- Exact-branch gate: `bun run check` before every implementation merge.

## Rollback

Disable Product Studio commands first, leaving read-only queries available. Revert the application revision and stop registry projection consumers. Additive tables remain unused; existing delivery projections and reports continue operating. No rollback may discard identity events or silently restore an old hierarchy as current truth.

# Tasks: Product Capability Registry And Product Studio

This task map defines later implementation slices. This documentation change does not claim that the registry or Product Studio is implemented.

## Domain Foundation

- [x] T001 Add `product-model` domain contracts and public surface.
- [x] T002 Add hierarchy, relation, registration, variant, and identity-evolution invariants.
- [x] T003 Add deterministic fixtures for rename, move, merge, split, retirement, and historical queries.

## Persistence And Application

- [ ] T004 Add Drizzle tables and additive migration tests.
- [ ] T005 Add recursive-CTE repository traversal with cycle and depth bounds.
- [ ] T006 Add transactional revisions, audit events, idempotency, and optimistic concurrency.
- [ ] T007 Add authorized query, preview, and command application services.

## Delivery Integration

- [ ] T008 Project ratified registry IDs into the existing `CapabilityLedger`.
- [ ] T009 Migrate legacy capability aliases and corrections without changing report population.
- [ ] T010 Prove the governed period, sprint, leadership, citation, and safe-failure regressions.

## Product Studio

- [ ] T011 Build a read-only product map and feature dossier through Sarathi APIs.
- [ ] T012 Add semantic zoom, relation filters, coverage, and accessible tree/table alternatives.
- [ ] T013 Add previewed governed edits and stale-revision recovery.
- [ ] T014 Prove identity integration, audience filtering, audit, rollback, and Product Studio independence from Teams runtime availability.

## Optional Projections

- [ ] T015 Evaluate closure-table or `ltree` projections using measured workloads.
- [ ] T016 Project technical realization into Backstage without changing registry authority.
- [ ] T017 Link build-, environment-, and tenant-qualified runtime observations after retention and audience policy acceptance.

# Tasks: Product Capability Registry And Product Studio

This task map records the merged implementation slices. Live PostgreSQL, Product Studio identity-broker/browser, and private real-data acceptance remain separate evidence gates where noted in their PRs and Beads records.

## Domain Foundation

- [x] T001 Add `product-model` domain contracts and public surface.
- [x] T002 Add hierarchy, relation, registration, variant, and identity-evolution invariants.
- [x] T003 Add deterministic fixtures for rename, move, merge, split, retirement, and historical queries.

## Persistence And Application

- [x] T004 Add Drizzle tables and additive migration tests.
- [x] T005 Add recursive-CTE repository traversal with cycle and depth bounds.
- [x] T006 Add transactional revisions, audit events, idempotency, and optimistic concurrency.
- [x] T007 Add authorized query, preview, and command application services.

## Delivery Integration

- [x] T008 Project ratified registry IDs into the existing `CapabilityLedger`.
- [x] T009 Migrate legacy capability aliases and corrections without changing report population.
- [x] T010 Prove the governed period, sprint, leadership, citation, and safe-failure regressions.

## Product Studio

- [x] T011 Build a read-only product map and feature dossier through Sarathi APIs.
- [x] T012 Add semantic zoom, relation filters, coverage, and accessible tree/table alternatives.
- [x] T013 Add previewed governed edits and stale-revision recovery.
- [x] T014 Prove identity integration, audience filtering, audit, rollback, and Product Studio independence from Teams runtime availability.

## Optional Projections

- [ ] T015 Evaluate closure-table or `ltree` projections using measured workloads.
- [ ] T016 Project technical realization into Backstage without changing registry authority.
- [ ] T017 Link build-, environment-, and tenant-qualified runtime observations after retention and audience policy acceptance.

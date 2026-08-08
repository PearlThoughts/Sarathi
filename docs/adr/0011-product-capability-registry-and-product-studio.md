# ADR 0011: Sarathi Product Capability Registry And Product Studio

## Status

Proposed for incremental implementation.

## Context

Sarathi's delivery model groups source activity into capabilities, but a workspace's durable product vocabulary still depends on configured mappings and evidence. Team shorthand, evolving feature boundaries, client variants, migrations, invariants, and technical realization cannot be reconstructed reliably from nearest records alone.

Product owners also need a non-technical surface for reviewing and changing the map. Making Payload CMS or Backstage authoritative would split Sarathi's domain, allow direct writes to bypass policy, and couple historical delivery meaning to another product's storage semantics.

This decision affects domain ownership, PostgreSQL schema, authorization, report compatibility, browser APIs, private overlays, technical projections, and future Product Studio implementation.

## Decision

Create a Sarathi-owned `product-model` bounded context for the Product Capability Registry. It owns stable product, area, capability, and feature identities; a single-parent primary hierarchy; typed relations; variants; registration and lifecycle state; revisions; proposals; and append-only identity evolution.

Use normalized PostgreSQL tables. Store the primary hierarchy as an adjacency list and query it with bounded, cycle-safe recursive CTEs. Keep typed cross-relations in a separate edge table. Closure tables, materialized paths, or `ltree` may be added only as rebuildable read projections after measurement. Do not add a graph database.

Keep the existing delivery-intelligence reporting path. Its `CapabilityLedger` becomes a read projection of ratified registry identity plus workspace mappings and evidence; the registry does not create a second reporting pipeline.

This decision refines ADR 0007 rather than replacing it. `delivery-intelligence` remains the primary project operating model for delivery objects, observations, claims, conflicts, queries, and reports. `product-model` owns only the slower-changing business product vocabulary and its governed evolution.

Use Payload CMS as the optional Sarathi Product Studio adapter. Payload renders Sarathi query APIs and submits previewed commands with expected revisions and idempotency. It may store editorial drafts and UI layout state in its own schema, but it cannot write Sarathi domain tables. Payload drafts are not domain ratification.

Separate schemas, database roles, migrations, and availability boundaries even when Sarathi and Payload share a PostgreSQL cluster. Product Studio failure must not stop Teams answers or synchronization.

## Consequences

### Positive

- Product and delivery people share stable business identities that survive renames and regrouping.
- Delivery evidence, strategy, technical catalogs, deployments, and telemetry can converge on one governed product vocabulary.
- Product owners get a visual editing surface without moving domain authority into a CMS.
- Historical reports and citations remain explainable after merges, splits, and retirement.
- PostgreSQL transactions, Drizzle migrations, backup, authorization, and operations remain the durable boundary.

### Negative

- The registry introduces a new bounded context and migration path from current capability mappings.
- Merge, split, variant precedence, and bitemporal queries require careful domain and repository tests.
- A custom Product Studio view is still application work; Payload relationships alone are insufficient.
- Derived closures, paths, search documents, and technical projections require reconciliation and freshness monitoring.

## Alternatives Considered

### Make Payload the source of truth

Rejected because CMS writes and hooks cannot own Sarathi authorization, graph invariants, report history, audience policy, or delivery projections. Payload versions remain useful for editorial recovery.

### Model business features directly in Backstage

Rejected as the primary model because Backstage is optimized for software catalog entities and technical ownership. It remains a suitable technical projection and integration surface.

### Keep only the current capability mappings

Rejected because mappings do not provide stable identity, human restructuring, typed evolution, variants, historical views, or rich dossiers.

### Use nested sets or materialized paths as authority

Rejected because frequent moves rewrite large subtrees and the patterns do not represent the wider typed graph. Paths remain optional projections.

### Adopt a graph database

Rejected because bounded traversals fit PostgreSQL and another datastore would add security, transaction, backup, and consistency boundaries without a demonstrated constraint.

## Rollback

Disable command endpoints and Product Studio mutation, stop projection consumers, and deploy the prior application revision. Leave additive registry tables and immutable identity history intact. Existing delivery projections and report composition continue on their established path.

## References

- [Product Capability Registry specification](../../specs/007-product-capability-registry/spec.md)
- [Implementation plan](../../specs/007-product-capability-registry/plan.md)
- [Research](../../specs/007-product-capability-registry/research.md)
- [ADR 0007: Delivery Intelligence](./0007-delivery-intelligence-projection.md)
- [Intent and Evidence Graph](../architecture/intent-evidence-graph.md)

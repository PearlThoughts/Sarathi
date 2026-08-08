# Research: Product Capability Graph And Product Studio

## Enterprise Modeling Patterns

Enterprise capability tools commonly start with a small business-language hierarchy and link it to applications, organizations, processes, and technology. SAP LeanIX recommends relatively stable business capabilities, a shallow hierarchy, and explicit typed relations. Palantir's ontology separates semantic objects and links from governed actions that apply operational change. Sarathi should adopt those principles without becoming a general enterprise-architecture suite.

Backstage is useful for software components, APIs, resources, ownership, search, and technical relations. Its own catalog guidance frames the graph as a high-level human mental model and a cache/projection over authoritative sources. Sarathi therefore may publish technical references to Backstage, but Backstage should not own product-feature identity, audience policy, evidence, ratification, or historical delivery meaning.

## PostgreSQL Hierarchy Options

### Adjacency list with recursive CTEs — selected authority

One parent edge per structural entity makes moves local, preserves relational constraints, and fits typed history. PostgreSQL recursive CTEs support hierarchy traversal, explicit depth/breadth ordering, path construction, and cycle detection. This is the best fit for an evolving product map on the existing Postgres/Drizzle stack.

### Closure table — optional derived projection

A closure table stores every ancestor/descendant pair. It makes repeated ancestry and subtree authorization queries fast, but moves require transactional projection maintenance and it multiplies rows. Use only as rebuildable derived state when measurements justify it.

### Materialized path or `ltree` — optional read projection

Paths are convenient for subtree filtering and display. Reparenting rewrites descendant paths, identifiers must be encoded safely, and a path cannot express arbitrary cross-relations. PostgreSQL `ltree` is suitable as an indexed projection after real query evidence, not as canonical identity.

### Nested sets — rejected as authority

Left/right bounds make static subtree reads efficient, but moves and insertions rewrite many rows, concurrent editing is difficult, history is awkward, and the technique does not model general graph relations. It conflicts with frequent PM-driven regrouping.

### Native graph database — rejected for this stage

A graph database improves unconstrained multi-hop exploration, but introduces another datastore, query language, authorization boundary, migration path, backup regime, and consistency problem. Current traversal is bounded and PostgreSQL already satisfies persistence, audit, transaction, and security requirements.

### Event stream only — rejected

Append-only identity events are necessary for audit and reconstruction, but replaying events is not an efficient primary query model. Keep current-state tables plus append-only revisions/events.

## Payload Product Studio Fit

Payload provides collections, relationship fields, generated APIs, access control, versions/drafts, custom Admin views, authentication extension points, PostgreSQL support, and transactions. Those are useful for a product-owner workspace and editorial material.

Payload relationship fields are not sufficient as the canonical graph: they do not enforce Sarathi's typed edge rules, single-parent hierarchy, merge/split protocol, audience boundary, bitemporal history, or delivery projections. Direct Payload hooks are also bypassable by non-Payload writers. The durable integration is a custom Admin view backed by Sarathi query and command APIs.

Product Studio may store presentation narratives, onboarding help, saved views, and node layouts in Payload-owned tables. Canonical titles, hierarchy, registration, lifecycle, variants, and identity history remain in Sarathi.

## Visualization Options

React Flow is a strong candidate for editable node interaction and custom React nodes. Cytoscape.js is a strong candidate for larger graph analysis and layout algorithms. The first implementation should remain library-neutral until representative map sizes, keyboard navigation, semantic zoom, impact-preview interaction, and accessibility alternatives are tested.

## Primary References

- [PostgreSQL recursive queries](https://www.postgresql.org/docs/current/queries-with.html)
- [PostgreSQL `ltree`](https://www.postgresql.org/docs/current/ltree.html)
- [Payload collections](https://payloadcms.com/docs/configuration/collections)
- [Payload relationships](https://payloadcms.com/docs/fields/relationship)
- [Payload versions](https://payloadcms.com/docs/versions/overview)
- [Payload drafts](https://payloadcms.com/docs/versions/drafts)
- [Payload collection access control](https://payloadcms.com/docs/access-control/collections)
- [Payload custom Admin views](https://payloadcms.com/docs/custom-components/custom-views)
- [Payload authentication](https://payloadcms.com/docs/authentication/overview)
- [Payload transactions](https://payloadcms.com/docs/database/transactions)
- [Payload PostgreSQL adapter](https://payloadcms.com/docs/database/postgres)
- [Backstage catalog graph](https://backstage.io/docs/features/software-catalog/creating-the-catalog-graph/)
- [Backstage model extensions](https://backstage.io/docs/features/software-catalog/extending-the-model/)
- [SAP LeanIX business capability modeling](https://help.sap.com/docs/leanix/ea/business-capability-modeling-guidelines)
- [SAP LeanIX relations](https://help.sap.com/docs/leanix/ea/relations)
- [Palantir Foundry ontology overview](https://www.palantir.com/docs/foundry/ontology/overview)

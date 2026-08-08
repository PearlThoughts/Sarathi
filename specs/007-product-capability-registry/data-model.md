# Data Model: Product Capability Registry

## Aggregate Boundaries

`ProductEntity` is the stable identity aggregate for a product, product area, capability, or feature. It owns registration state, lifecycle, canonical name, descriptive metadata, revision, validity, sensitivity, and audience. Names and paths are mutable; the opaque entity ID is not.

The product graph is composed from explicit records rather than a JSON graph document:

- `product_entity`: canonical identity and current governed state.
- `product_entity_alias`: source-qualified names, abbreviations, redirects, and validity.
- `product_hierarchy_edge`: the authoritative primary-parent adjacency list.
- `product_relation`: typed non-hierarchical links.
- `product_variant`: scoped differences from a base entity.
- `product_claim`: attributable statements about meaning, behavior, invariants, or availability.
- `product_change_proposal`: proposed command, evidence references, expiry, and review decision.
- `product_revision`: immutable transaction-level revision metadata.
- `product_identity_event`: rename, move, merge, split, redirect, retire, and supersede history.
- `product_external_reference`: source and technical catalog references without copying source bodies.
- `product_view_layout`: optional UI-owned coordinates, grouping, filters, and saved-view state in a Payload-owned schema.

Availability and coverage are derived projections, not fields on the canonical entity.

## Relational Shape

The intended schema uses UUID primary keys and workspace-qualified foreign keys. Active canonical keys are unique within a workspace. An active hierarchy edge is unique by child, and indexes cover parent, child, validity, and revision. Relation uniqueness includes workspace, source, relation type, target, qualifiers, and validity so the same semantic edge is not duplicated by repeated evidence.

`product_revision` allocates one monotonic workspace revision per committed command. Changed records refer to that revision, while `product_identity_event` records the semantic operation and disposition map. Evidence references use source-stable identifiers and authorized knowledge references; product tables do not duplicate message, issue, document, or code bodies.

JSONB is limited to versioned extension qualifiers whose schema is validated by the owning relation or variant type. Core identities, statuses, timestamps, audiences, and relation endpoints remain typed columns. A derived closure projection, when enabled, stores workspace, ancestor, descendant, depth, source revision, and rebuild state; it never accepts direct application writes.

## Entity State

Registration state is one of `candidate`, `ratified`, `contested`, or `superseded`. Lifecycle is independently `planned`, `available`, `deprecated`, `retired`, or `unknown`. Delivery state is not stored here; `delivery-intelligence` reconstructs planned, implemented, reviewed, merged, checked, released, deployed, verified, accepted, and impact-observed stages from evidence.

Every governed record carries:

- workspace and stable ID;
- `valid_from` and optional `valid_to` for business validity;
- `recorded_at` and optional `superseded_at` for system history;
- created/decided actor and source class;
- sensitivity, audience, and evidence reference boundaries;
- monotonically increasing aggregate revision.

## Hierarchy Invariants

- Structural entities have zero or one active primary parent.
- A workspace may contain multiple products, but a hierarchy edge never crosses workspaces.
- Kind transitions follow `product -> area -> capability -> feature`; explicitly approved skipped levels are allowed.
- An entity cannot be its own ancestor. Preview and commit both run cycle detection.
- Paths are calculated from IDs and current names; paths are not identity.
- Moves append history and invalidate derived paths/closures; they do not rewrite entity IDs.

## Typed Relations

Initial relation vocabulary:

- product semantics: `depends_on`, `enables`, `conflicts_with`, `alternative_to`, `supersedes`;
- delivery and intent: `implements`, `contributes_to`, `governed_by`, `affected_by`;
- realization: `realized_by`, `exposed_by`, `configured_by`, `deployed_as`, `observed_by`;
- assurance: `verified_by`, `constrained_by`, `available_to`;
- variation: `variant_of`.

Each relation declares allowed source/target kinds, direction, cardinality, transitivity policy, registration state, validity, provenance, sensitivity, and audience. Reverse labels are presentation metadata, not duplicate edges.

## Variants

A `ProductVariant` qualifies a base entity by one or more axes:

`client | tenant | brand | role | environment | version | build | feature_flag`

Variant resolution filters all authorized, time-valid qualifiers and applies a declared partial order for the fields they override. There is no universal axis ranking: a client rule, environment rule, build rule, and feature flag can all apply together. Conflicting equally applicable overlays fail as ambiguous. A variant stores only the delta from the base definition and its applicability interval, so customization and rollout remain queryable without cloning the feature tree.

## Identity Evolution

- **Rename**: preserve ID, add the former canonical name as an alias, append an event.
- **Move**: preserve ID, close the former hierarchy edge, create the new edge, append an event.
- **Merge**: choose or create a survivor, redirect superseded IDs, reconcile aliases and relations, preserve historical references.
- **Split**: create new IDs, require a complete disposition for active references, preserve the original as a historical redirect or contested shell.
- **Retire**: preserve the entity and history; exclude it from current navigation unless requested.

No identity event deletes source evidence or rewrites the product structure used by an already accepted historical report.

## Delivery Compatibility

The existing `CapabilityLedger` remains the report-time read model. It is populated from ratified registry entities plus current workspace mappings and corrections. Existing delivery objects and change capsules reference registry IDs additively. Until migration is complete, legacy capability keys resolve through explicit aliases; they are not silently reclassified.

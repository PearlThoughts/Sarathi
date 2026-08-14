# Feature Specification: Product Capability Graph Exploration

**Feature Branch**: `feat/it-126-capability-graph`
**Created**: 2026-08-13
**Status**: Product-owner interaction baseline accepted; production promotion in progress
**Work tracking**: Jira `IT-126`; Beads `sar-ebu`

## 1) Purpose

Turn Product Studio's existing 3D Product Capability Graph into an enterprise product-knowledge exploration experience over the governed Product Capability Registry and its authorized delivery projections. The feature preserves the 3D text constellation while adding bounded exploration, explainable relationships, synchronized analytical and accessible views, rich dossiers, temporal navigation, and explicit delivery-stage distinctions.

## 2) Problem and Objective

The current graph can display the product map, focus on a node, search, filter relation types, and show a small dossier subset. It does not distinguish selection from exploration, expose selectable relationship semantics, restore client-side navigation state, consume existing subgraph/availability/history contracts, or compose delivery intelligence into the studio.

Objective:

- Make governed product identity, structure, boundaries, variants, relationships, history, assurance, coverage, and delivery context explorable from one synchronized state model.
- Keep every traversal authorized and bounded, every delivery stage semantically distinct, and every non-WebGL interaction operational.
- Preserve Sarathi and `delivery-intelligence` as the only domain authorities; Product Studio owns presentation state only.

## 3) Principles

1. **One governed model**
   Every visual lens and alternative view projects the same authorized Sarathi entities, relations, claims, variants, history, and delivery summaries.
2. **Identity is not delivery activity**
   Work items, repositories, services, and deployments support product understanding but never become primary capabilities or acceptance proof.
3. **Selection is reversible presentation state**
   Selecting, comparing, changing lenses, moving the camera, or expanding a branch cannot mutate registry semantics.
4. **Bounded and privacy-safe by construction**
   Traversal limits and audience filtering are application/API contracts, not browser conventions; errors never reveal hidden identifiers or evidence bodies.
5. **Equivalent access, not a fallback afterthought**
   The hierarchy, structured list, relationship list, and inspectors share selection and remain operational when WebGL is unavailable.
6. **Motion communicates state**
   Camera movement and path animation occur only for deliberate focus changes and selected paths, and stop under reduced-motion preferences.

## 4) Authority and Architecture

```text
Governed Product Registry       Delivery Intelligence
entities, claims, variants,     volatile stages, citations,
relations, history, coverage    acceptance and impact evidence
             |                         |
             +---- application composition ----+
                                                  |
                                    authorized Product Model API
                                    bounded + audience-filtered
                                                  |
                                    Product Studio server client
                                    authenticated same-origin BFF
                                                  |
                               shared exploration state + projections
                                      /           |           \
                                3D graph     inspectors     accessible views
```

- Sarathi remains authoritative for canonical identity, hierarchy, semantic relations, claims, variants, lifecycle, revisions, authorization, and mutations.
- `delivery-intelligence` remains authoritative for volatile delivery stages and evidence-backed report composition.
- Product Studio may persist only saved layouts, coordinates, filters, lenses, camera state, expanded branches, preferences, and editorial drafts that reference Sarathi IDs and revisions.
- No graph database, direct SQL mutation, browser Jira/GitHub fetch, duplicated delivery store, or public private-overlay vocabulary is permitted.

## 5) User Scenarios and Testing

### User Story 1 — Select, inspect, and explore (Priority: P1)

An authorized user selects a capability without changing the scene, reads a compact summary, then explicitly explores its bounded neighbourhood and reverses the navigation with browser Back.

**Independent Test**: Load a synthetic deep hierarchy, select a capability, explore a subfeature, and restore the prior focus with Back while retaining a usable scene.

**Acceptance Scenarios**:

1. **Given** a loaded constellation, **when** a node is single-clicked, **then** the node, its parent, children, and relevant relations are emphasized, unrelated nodes fade, the compact inspector opens, and the URL updates without a reload.
2. **Given** a selected entity, **when** Explore or double-click is used, **then** its authorized bounded subgraph becomes the focus and the previous focus remains in reversible history.
3. **Given** reduced motion, **when** focus changes, **then** the scene changes without animated camera travel or ambient animation.

### User Story 2 — Understand typed relationships (Priority: P1)

An authorized user selects an edge, sees a business-readable directional statement and safe governance metadata, follows the related entity, and finds bounded prerequisite or impact paths.

**Independent Test**: Select a synthetic dependency edge, verify forward/reverse labels and validity, then execute bounded prerequisite and downstream-impact actions.

**Acceptance Scenarios**:

1. **Given** a visible relation, **when** it is selected, **then** its source, target, direction, reverse label, semantic family, definition, state, validity, revision, and safe evidence metadata are shown.
2. **Given** two selected entities, **when** Find path is invoked, **then** only an authorized, typed, depth-bounded and node-bounded path is highlighted or an explicit no-path result is shown.
3. **Given** a stored forward edge, **when** rendered from the target perspective, **then** the reverse label is derived without storing a duplicate inverse edge.

### User Story 3 — Change analytical lens without changing authority (Priority: P1)

An authorized user switches among constellation, hierarchy, dependency, relationship, customer journey, delivery, realization, variant, assurance, coverage, and history lenses over the same selected entity and filters.

**Independent Test**: Switch every lens for one entity and verify its declared traversal, relation families, limits, legend, encodings, and available actions.

### User Story 4 — Read the full governed dossier (Priority: P1)

An authorized user opens a full dossier and navigates overview, structure, relationships, behavior and boundaries, variants, delivery, evidence and governance, and history without seeing raw storage or unauthorized evidence.

**Independent Test**: Render every section from synthetic claims, variants, history, coverage, and delivery projections, including unavailable and contested states.

### User Story 5 — Use synchronized non-WebGL views (Priority: P1)

A keyboard-only user or a user whose browser cannot initialize WebGL explores the same entities and relationships through structured hierarchy, list/table, matrix, landscape, timeline, and revision-diff views.

**Independent Test**: Force WebGL initialization failure, traverse the hierarchy, select a relationship, open and close the dossier, and restore focus without touching the canvas.

### Edge Cases

- An entity or relation becomes unauthorized between initial render and lazy expansion.
- A query is truncated by depth, node, or relation bounds.
- Delivery enrichment is temporarily unavailable while the registry remains available.
- A variant resolution is ambiguous or no variant matches the supplied context.
- A historical revision predates a rename, move, merge, split, or retirement.
- Back/Forward references an entity absent from the currently authorized projection.
- WebGL initializes and later loses its context.
- A lens has no governed relation types for the selected entity.

## 6) Functional Requirements

### Exploration state

- **FR-001**: Single selection MUST retain the graph scene; exploration MUST be a separate explicit action.
- **FR-002**: The URL MUST encode entity focus, selected entity or edge, lens, revision, and synchronized view with Back/Forward restoration.
- **FR-003**: The client MUST preserve camera and exploration history without treating coordinates as business meaning.
- **FR-004**: Compare MUST accept at most two authorized entities and path queries MUST use bounded typed traversal.
- **FR-005**: One-hop expansion and branch collapse MUST reuse stable graph object identities.

### Domain projections

- **FR-006**: Relation semantics MUST expose a stable display label, reverse label, family, definition, directionality, and permitted lens families for every governed relation type.
- **FR-007**: Historical queries MUST support a governed revision or instant and return the effective revision, limits, truncation, and safe warnings.
- **FR-008**: Entity history MUST expose authorized rename, move, merge, split, redirect, retirement, supersession, revision, and validity information where recorded.
- **FR-009**: Availability MUST expose base claims, selected variant resolution, precedence, applicability, validity, ambiguity, and warnings without exposing storage rows.
- **FR-010**: Delivery enrichment MUST be additive, audience-filtered, failure-safe, and composed through the existing Capability Ledger / `delivery-intelligence` path.
- **FR-011**: Delivery output MUST keep proposed, planned, being implemented, implemented, reviewed, merged, checked, released, migrated, deployed, compatible, verified, accepted, impact observed, and retired distinct; absent evidence MUST remain absent.

### Presentation

- **FR-012**: Edges MUST be keyboard- and pointer-selectable first-class visual objects.
- **FR-013**: The compact inspector MUST show only name, kind, definition, lifecycle/registration, parent/children summary, relation summary, delivery summary, revision, and high-priority warnings.
- **FR-014**: The full dossier MUST provide the eight sections defined by this specification and use business-readable claims rather than raw claim storage structures.
- **FR-015**: All eleven visual lenses MUST declare traversal, included entity/relation types, direction, bounds, grouping, filters, encoding, legend, and actions.
- **FR-016**: The hierarchy/list, dependency matrix, coverage landscape, delivery timeline, and revision diff MUST share selection and filters with the canvas.
- **FR-017**: Jira issues, repositories, services, APIs, and deployments MAY appear only as grouped supporting records or supporting realization nodes.

### Safety and operability

- **FR-018**: All server queries MUST enforce maximum depth, nodes, and relations and MUST reject unbounded or invalid requests.
- **FR-019**: Authorization failures and unavailable projections MUST return privacy-safe errors and MUST not leak hidden IDs, evidence bodies, source identifiers, or metadata.
- **FR-020**: WebGL failure MUST leave an operational structured navigator and inspector.
- **FR-021**: Focus changes MUST be announced; overlays MUST trap and restore focus; every control MUST have visible focus and a keyboard path.
- **FR-022**: Selected state, registration, delivery, truncation, and warnings MUST have non-color indicators and adequate contrast.
- **FR-023**: The graph MUST avoid reconstruction for selection-only changes, dispose WebGL resources, respond to resize, bound labels/relations, and throttle high-frequency interactions.

## 7) Key Contracts

- **Graph snapshot**: effective revision and instant, bounded authorized entities/relations, relation semantics, limits, truncation, warnings.
- **Capability subgraph**: focus entity plus authorized ancestors, descendants, and typed relations under explicit limits.
- **Entity dossier**: governed entity, structure, claims, variants, relations, references, proposals, coverage, history summary, and safe warnings.
- **Relation dossier**: derived semantic statement plus stored direction, lifecycle, validity, source class, authorization-safe provenance, revision, and coverage.
- **Availability**: resolved base/variant behavior and ambiguity result for explicit qualifiers.
- **Delivery exploration**: stage counts and supporting work summaries composed by `delivery-intelligence`, with citations/verification/acceptance kept distinct and an explicit availability state.
- **Exploration state**: presentation-only focus, selection, comparison, lens, view, revision, filters, expanded branches, and camera snapshot.

## 8) Non-Functional Requirements

- **Performance**: Initial bounded graph becomes interactive without loading every descendant; selection-only updates do not replace the graph data objects; lazy expansions honor server bounds; browser measurements cover desktop and tablet.
- **Accessibility**: WCAG-oriented keyboard, focus, announcements, contrast, reduced motion, text resizing, semantic landmarks, and a complete non-WebGL path.
- **Explainability**: Every relation and delivery state carries a human-readable meaning and safe provenance/coverage status.
- **Security**: Browser requests use the authenticated Product Studio boundary; server credentials never reach the client.
- **Recoverability**: Deep links restore safe state; unavailable optional projections degrade independently; destructive registry changes are outside this feature.

## 9) Success Criteria

- Permanent domain/API tests prove direction labels, bounds, filters, authorization, variants, delivery composition, history, truncation, and unavailable projections.
- Component and browser tests prove selection, edge inspection, drill-down/history, lenses, dossiers, stage distinctions, reduced motion, privacy-safe errors, keyboard operation, tablet layout, and WebGL failure.
- Browser instrumentation shows selection-only changes reuse node/link identities and do not reheat or reconstruct the full scene.
- Public fixtures use synthetic product vocabulary and include three deep slices plus delivery, private-evidence, and unrelated-work distractors.
- `bun run check`, `bun run runtime:smoke`, Product Studio build/check, and the complete Product Studio browser suite pass on the exact PR branch.
- The merged revision is deployed through the sanctioned Railway path and live-verified; product-owner acceptance remains a separate final gate.

## 10) Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---:|---|
| Canvas state grows into a parallel product model | High | Keep domain DTOs immutable and presentation state ID/revision-based; add architecture-fitness tests. |
| Delivery enrichment creates a second reporting path | High | Compose only through the existing delivery application boundary and expose a narrow projection. |
| Browser complexity degrades accessibility | High | Treat synchronized structured views as first-class and test with forced WebGL failure. |
| Dense graphs become unusable | High | Lazy expansion, typed lenses, hard bounds, label LOD, stable identities, and truncation affordances. |
| Visual stages imply false completion | High | Fixed stage vocabulary, non-collapsing labels, and explicit missing/unsupported states. |
| Private overlay content reaches public Git | High | Synthetic public fixtures, secret scanning, and final diff review. |

## 11) Stop Conditions

- CodeCompass bootstrap loses its required healthy context during discovery.
- The design requires Product Studio/Payload to write Sarathi domain data or duplicate delivery records.
- A query cannot be bounded or audience-filtered without changing the authorization model.
- Exact-branch local CI or privacy-safe regression tests fail.
- Jira/governance gates or required GitHub checks cannot be satisfied.
- Production deployment cannot be tied to the merged revision.

## 12) Decisions

- No new ADR is required: this feature implements and tightens ADR 0011 and specification 007 without changing authority, storage, or integration ownership.
- Relation display semantics are an additive public domain/application projection; inverse presentation labels are derived, never stored as inverse edges.
- Product Studio uses an authenticated same-origin server boundary for lazy queries.
- Delivery is optional enrichment: registry exploration remains operational with an explicit unavailable-delivery state.
- Saved views are out of the first implementation slice unless the existing Payload presentation collection can store them without schema/domain coupling; all lens definitions remain reusable regardless.

## 13) References

- [Product Capability Registry](../007-product-capability-registry/spec.md)
- [Product Model API](../007-product-capability-registry/contracts/product-model-api.md)
- [Product Model data model](../007-product-capability-registry/data-model.md)
- [ADR 0011](../../docs/architecture/decisions/0011-product-capability-registry-and-product-studio.md)
- Jira `IT-126`
- Beads `sar-ebu`

## 14) Product-owner acceptance addendum — Product Digital Twin Explorer

The first production implementation at revision `1d18bbf5a4585a399e6019d8921ea491867c53f8`
passed its technical gates but failed product-owner usability acceptance. The graph exposed many
controls and metadata surfaces without giving a newly onboarded person a coherent way to learn the
product. Technical presence is therefore not acceptance evidence for this experience.

The accepted interaction direction is a synchronized model-explorer workspace:

- a persistent left product tree for the complete authorized hierarchy;
- an uninterrupted central 3D text model for spatial exploration;
- a persistent right contextual inspector with actual named children and relationships;
- a contextual analysis drawer for advanced views and delivery/history detail;
- `Explore`, `Explain`, and `Tour` entry modes, with advanced analysis kept secondary;
- deliberate camera movement and selected-path animation, never continuous ambient motion.

### Additional functional requirements

- **FR-024**: Tree, canvas, and inspector MUST remain simultaneously visible on supported desktop
  layouts and MUST share one selection. Tablet layouts MAY collapse one side panel at a time while
  preserving the same state and keyboard path.
- **FR-025**: Selecting an entity in any surface MUST reveal and highlight its complete visible tree
  path, update the inspector, and preserve the current scene identity.
- **FR-026**: The persistent inspector MUST display named immediate children and named related
  entities as direct navigation actions rather than counts alone.
- **FR-027**: The default surface MUST prioritize search, breadcrumbs, lens, revision, and learning
  mode. Path, impact, prerequisites, variants, coverage, history, and other expert operations MUST
  move into contextual inspector or analysis controls.
- **FR-028**: The 3D model MUST use stable product-area clustering, hierarchy-sensitive label
  typography, selection halos, hover/selection edge labels, intentional camera framing, and
  selected-path motion. These encodings MUST remain understandable without color alone.
- **FR-029**: `Explore` MUST support free synchronized navigation; `Explain` MUST present a concise
  governed narrative for the selection; `Tour` MUST step through a governed or explicitly
  presentation-authored sequence of existing Sarathi IDs without inventing product semantics.
- **FR-030**: Delivery context MUST visibly separate active sprint, recently completed sprint,
  current-quarter promise relevance, blocked work, rollout, verification, and acceptance.
- **FR-031**: Sparse relationship coverage MUST be disclosed as a coverage limitation. Visual
  rendering MUST NOT infer a dependency, journey, DDD boundary, or business relationship from
  coordinates, hierarchy, work-item co-occurrence, or animation.
- **FR-032**: A reviewable prototype using current authorized data or public synthetic fixtures MUST
  be product-owner reviewed before another production merge or deployment.

### Prototype acceptance slice

The next review checkpoint is intentionally narrower than the full original feature:

1. Persistent hierarchy tree with expand/collapse, search, selection, and zoom/isolate actions.
2. Central 3D model with improved text rendering, stable clusters, intentional motion, and direct
   node/edge interaction.
3. Persistent inspector with About, Contains, Relationships, and Delivery sections.
4. Synchronized selection across all three surfaces.
5. One representative deep hierarchy slice.
6. One clickable governed relationship.
7. One delivery overlay that distinguishes quarter and sprint context from delivery stages.
8. One guided learning tour over existing authorized entity IDs.

The product owner accepted this interaction baseline for production promotion on 2026-08-14.
That acceptance covers the usability direction represented by the synchronized tree, 3D model,
persistent inspector, learning modes, and contextual delivery presentation. It does not waive
post-deploy verification, authorize inferred relationships, or claim that the currently sparse
governed relationship dataset is complete. Remaining lenses and analytical surfaces may now be
refined incrementally over the same governed model.

# Tasks: Product Capability Graph Exploration

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)
**Tracking**: Jira `IT-126`; Beads `sar-ebu`

## Phase 1: Governed readiness

- [x] T001 [Setup] Load repository instructions, routed strategy, feature contracts, architecture, deployment, and test context.
- [x] T002 [Setup] Bootstrap CodeCompass independently for public and private repositories.
- [x] T003 [Setup] Verify current local/remote revisions, Railway services/health, and populated registry through authorized APIs.
- [x] T004 [Setup] Create Jira `IT-126`, claim Beads `sar-ebu`, and create `feat/it-126-capability-graph` worktree.
- [x] T005 [Setup] Author the approved feature specification and architecture plan.

## Phase 2: Product and delivery query contracts

- [x] T006 [US2] Add table-driven tests and an exhaustive semantic catalog for product relation labels, reverse labels, families, definitions, and lens membership.
- [x] T007 [US4] Add revision-addressable historical graph and entity-history query/API tests and implementation under existing authorization/bounds.
- [x] T008 [US4] Extend availability tests/contracts for base claims, qualifiers, precedence, validity, ambiguity, and safe warnings.
- [x] T009 [US4] Add a narrow `delivery-intelligence` product exploration projection with distinct stages, safe grouped supporting work, citations/coverage, and unavailable behavior.
- [x] T010 [US1] Extend Product Studio server schemas/client and authenticated same-origin query routes for subgraph, availability, coverage, history, relation metadata, and delivery.
- [x] T011 [US1] Run focused domain/API/client contract tests and commit/push the contract checkpoint.

## Phase 3: Exploration state and stable graph

- [x] T012 [US1] Add the declarative lens catalog and URL-backed exploration reducer with node/edge selection, compare pair, focus path, view, filters, and revision.
- [x] T013 [US1] Refactor graph scene merging to preserve node/link object identities and avoid full reconstruction/reheat for selection-only updates.
- [x] T014 [US1] Implement single-click select, double-click/Explore focus, one-hop expand, branch collapse, product home, camera snapshots, and Back/Forward restoration.
- [x] T015 [US2] Implement selectable directed edges, relation emphasis, bounded path/impact/prerequisite actions, and privacy-safe no-result/truncation states.
- [x] T016 [US1] Add focused reducer/component/performance tests and commit/push the exploration checkpoint.

## Phase 4: Dossiers and analytical lenses

- [x] T017 [US4] Implement the compact entity inspector and resizable/focus-managed full dossier with eight governed sections.
- [x] T018 [US2] Implement the relation inspector with derived direction semantics, validity, registration, provenance class, qualifiers, coverage, revision, and authorized delivery impact.
- [x] T019 [US3] Implement all eleven lens projections, legends, encodings, filters, limits, and actions over the shared model.
- [x] T020 [US4] Render claims, variants, ambiguity, delivery-stage distinctions, evidence/governance, and history/revision comparison in business language.
- [x] T021 [US3] Add focused component tests and commit/push the dossier/lens checkpoint.

## Phase 5: Accessible synchronized views

- [x] T022 [US5] Implement the structured hierarchy/list and relationship navigation with complete keyboard selection/exploration.
- [x] T023 [US5] Implement dependency matrix, coverage landscape, delivery timeline, and revision diff sharing selection and filters.
- [x] T024 [US5] Implement live announcements, visible focus, overlay focus restoration, Escape behavior, non-color state indicators, and text resizing.
- [x] T025 [US5] Implement reduced-motion behavior, responsive desktop/tablet layout, WebGL loss/failure recovery, and operational no-canvas mode.
- [x] T026 [US5] Add accessibility/component/browser regression tests and commit/push the accessibility checkpoint.

## Phase 6: Full verification and review

- [x] T027 [Verify] Add synthetic deep-slice fixtures including migration/deployed/compatible/verified/accepted distinctions, unauthorized evidence, and unrelated work distractors.
- [x] T028 [Verify] Run all focused domain/API/Product Studio tests and resolve failures.
- [x] T029 [Verify] Run root `bun run check` and `bun run runtime:smoke` on the exact branch.
- [x] T030 [Verify] Run Product Studio complete check/build/browser suite on desktop and tablet; inspect console/network and performance instrumentation.
- [x] T031 [Review] Run direct final-diff self-review, architecture re-check, public/private boundary check, secret scan, and repository status checks.

## Phase 7: Governed release and acceptance handoff

- [ ] T032 [Release] Read current GitHub governance, update Jira, push final branch, and open the Jira-keyed PR with PR Contract and review evidence.
- [ ] T033 [Release] Resolve required checks/comments and merge only after exact-branch local CI evidence remains valid.
- [ ] T034 [Release] Pull merged `main` into the clean canonical checkout and remove the clean former worktree through the sanctioned workflow.
- [ ] T035 [Release] Deploy the merged revision through the repository's sanctioned Railway path and verify deployment identity/health.
- [ ] T036 [Release] Use an authorized Product Studio browser session for live node/edge selection, exploration, lenses, dossier, delivery, history, accessibility, reduced-motion, and safe-failure checks.
- [ ] T037 [Release] Update Beads and Jira with exact evidence and hand off explicit product-owner review questions without claiming acceptance.

## Dependencies

- T006-T010 must finish before lazy studio queries and inspectors rely on their contracts.
- T012-T016 must finish before synchronized views share the state machine.
- T017-T025 must finish before the complete browser suite can represent acceptance criteria.
- T029-T031 are mandatory preconditions for T032-T033.
- T033 is a mandatory precondition for deployment and live verification.
- Product-owner acceptance is external to engineering completion and remains open after T037.

## Phase 8: Product-owner usability recovery

- [x] T038 [Review] Record rejected product-owner acceptance and preserve `IT-126` / `sar-ebu` as open work.
- [x] T039 [Setup] Create a fresh `feat/it-126-product-digital-twin` worktree from the deployed merged revision.
- [x] T040 [UX] Implement the persistent synchronized product tree, central model, and contextual inspector workspace.
- [x] T041 [UX] Replace the crowded toolbar with novice-safe Explore, Explain, and Tour entry points plus contextual analysis actions.
- [x] T042 [UX] Improve text hierarchy, clustering, selection halo, hover/selected edge labels, camera framing, and intentional selected-path animation.
- [x] T043 [UX] Show named children, named relations, active/recent sprint work, current-quarter relevance, and distinct delivery stages in the persistent inspector.
- [x] T044 [Test] Add permanent component and browser regression tests for synchronization, learning modes, motion, delivery distinctions, tablet behavior, and WebGL fallback.
- [x] T045 [Verify] Run focused Product Studio tests and browser proof, self-review the interaction slice, and push a reviewable prototype branch.
- [ ] T046 [Accept] Obtain explicit product-owner interaction acceptance before PR merge or another production deployment.

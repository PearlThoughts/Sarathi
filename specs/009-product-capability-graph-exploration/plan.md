# Implementation Plan: Product Capability Graph Exploration

**Branch**: `feat/it-126-capability-graph` | **Date**: 2026-08-13 | **Spec**: [spec.md](./spec.md)

## 1) Execution Goals

Implement the feature in one governed public-repository worktree with checkpoint commits at domain/API, server-client, exploration shell, analytical views/accessibility, and verification boundaries. The private overlay is read-only context and live verification input; it receives no taxonomy or evidence changes.

## 2) Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.3; React 19 / Next.js 15  
**Primary Dependencies**: Effect, Hono, Payload, `3d-force-graph`, Three.js, Playwright, Vitest  
**Storage**: Existing Sarathi SQLite/D1-compatible product-model repositories; Payload only for Product Studio presentation/auth concerns  
**Testing**: Vitest/domain contract tests, architecture tests, Next build/check, Playwright browser suite, runtime smoke  
**Target Platform**: Railway-hosted Sarathi API and Product Studio; modern desktop/tablet browsers  
**Constraints**: audience-filtered bounded traversal; no new authority/store; synthetic public fixtures; WebGL-independent operation

## 3) Architecture Fitness Check

- [x] Product identity, relation semantics, claims, variants, history, and authorization remain in `product-model` domain/application/API layers.
- [x] Volatile delivery summaries are composed inside `delivery-intelligence` and injected into the sanctioned API projection.
- [x] Product Studio's browser receives data only through its authenticated server boundary and stores only presentation state.
- [x] Existing public façade exports and database ports remain stable; additions are additive.
- [x] No direct data-store access, Jira/GitHub browser integration, graph database, or cross-context import is introduced.
- [x] The existing architecture fitness gate (`bun run static:architecture`) remains mandatory.

Re-check after implementation: public APIs must expose only audience-safe DTOs, no infrastructure imports may enter Product Studio domain code, and the delivery query must depend on delivery application ports rather than source adapters.

## 4) Project Structure

```text
src/modules/product-model/
  domain/                    relation semantic vocabulary
  application/               bounded graph/detail/history queries
  api/                       additive read routes
src/modules/delivery-intelligence/
  application/               product delivery exploration projection
src/platform/
  runtime composition only

product-studio/src/
  domain/                    DTOs, lens catalog, exploration state
  server/                    typed Sarathi client and authenticated BFF
  views/                     shell, graph, inspectors, synchronized views
product-studio/tests-browser/
tests/

specs/009-product-capability-graph-exploration/
```

**Structure decision**: Extend established bounded contexts and the current Product Studio rather than creating a graph subsystem. Presentation-specific lens definitions live in Product Studio; semantic relation labels live with the public product vocabulary.

## 5) State Model

```text
initial deep link
  -> graph loaded
  -> selected node | selected edge | compare pair
  -> explicit explore pushes focus snapshot
  -> lazy bounded projection merged into stable scene
  -> lens/view/revision changes project the same authorized model
  -> Back/Forward restores focus, selection, lens, view, revision, camera
```

Selection never triggers a domain mutation. A focus change may trigger a bounded server query. An authorization or availability failure produces a safe state while preserving the last operational structured view.

## 6) Phase Plan

### Phase A — Contracts and query composition

- Add relation semantics and historical-revision query contracts with tests.
- Add bounded delivery exploration composition with explicit unavailable behavior.
- Expose additive authorized routes and schema/client contracts.

### Phase B — Exploration shell

- Introduce a single URL-backed reducer for focus, selection, compare, lens, view, revision, filters, and expanded branches.
- Add authenticated same-origin lazy-query routes.
- Separate single-select from explicit explore and preserve browser/camera history.
- Reuse graph node/link objects across selection changes and clean up WebGL resources.

### Phase C — Inspectors and lenses

- Build compact node inspector, full tabbed dossier, and relation inspector.
- Implement the eleven declarative lens definitions and consistent legend.
- Add compare, find-path, impact, prerequisites, expand-hop, collapse-branch, and product-home actions under bounds.

### Phase D — Synchronized and accessible views

- Add hierarchy/list, dependency matrix, coverage landscape, delivery timeline, and revision diff.
- Implement announcements, focus lifecycle, keyboard commands, reduced motion, tablet responsiveness, and WebGL-failure recovery.

### Phase E — Verification and release

- Add synthetic fixtures and permanent domain, API, component, browser, performance-instrumentation, and privacy tests.
- Run focused gates at every checkpoint and the complete exact-branch local CI suite.
- Self-review, governed PR/merge, canonical sync, sanctioned Railway deployment, and live authenticated verification.

## 7) Test and Evidence Strategy

- Domain/API: table-driven relation semantics; bounded traversal; audience/sensitivity; variants/ambiguity; historical revision; delivery-stage composition; unavailable delivery; safe truncation.
- Product Studio: reducer and URL round trip; selection/explore distinction; relation grouping; dossiers; lenses; stage display; reduced motion; safe errors.
- Browser: authenticated load/login return, node/edge selection, explore/Back/Forward, path, lenses, dossier round trip, keyboard-only path, forced WebGL failure, desktop/tablet, wrong audience.
- Performance: browser-visible counter/assertion proving no `graphData` replacement or full reheat on selection-only changes; bounded rendered relation count; console/network inspection.
- Release evidence: exact commit SHA, command results, Railway deployment ID, production registry revision, selected entity, console/network result, and acceptance boundary.

## 8) Dependency Graph

```text
relation/history contracts ----+
                               +--> server client/BFF --> exploration shell
delivery projection -----------+                         |
                                                         +--> inspectors/lenses
                                                         +--> accessible views
                                                                  |
synthetic fixtures + focused tests -------------------------------+
                                                                  |
full local CI -> self-review -> PR checks -> merge -> deploy -> live verify
```

## 9) Delivery Milestones

1. **Contract milestone**: additive public query contracts and tests pass; checkpoint commit pushed.
2. **Experience milestone**: graph, inspectors, lenses, synchronized views, and focused browser tests pass; checkpoint commits pushed.
3. **Release milestone**: complete local CI and self-review pass, PR merges, exact revision deploys and is live-verified.

## 10) Recovery and Stop Rules

- Preserve the last passing checkpoint; do not merge or deploy around a failing gate.
- If delivery sources are unavailable, return an explicit unavailable projection and keep registry exploration operational.
- If a historical revision cannot be authorized or reconstructed, return a safe typed error and retain the current view.
- If browser WebGL fails, route state and structured navigation remain authoritative for the UI session.
- Production rollback uses the sanctioned Railway release workflow and must target an exact known-good revision.

## 11) Release Checklist

- [ ] Architecture fitness re-check passed.
- [ ] No private vocabulary, evidence, identifiers, credentials, or generated runtime files in Git.
- [ ] Focused permanent tests passed at each checkpoint.
- [ ] Root `bun run check` and `bun run runtime:smoke` passed on the PR branch.
- [ ] Product Studio complete check/build/browser suite passed on the PR branch.
- [ ] Direct self-review recorded with scope, risks, and evidence.
- [ ] Jira-keyed PR passed governance and required checks.
- [ ] Merged SHA deployed through Railway and live-verified.
- [ ] Beads/Jira updated with exact evidence.
- [ ] Product owner asked to review; acceptance not inferred.

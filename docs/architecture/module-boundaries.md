# Module Boundaries

Sarathi follows a capability-first rule: start with the business capability, then choose the layer inside that capability. Do not start in Hono, Better Auth, Railway, GraphQL, or YAML code unless the change is adapter-only.

## Capability Layout

Each bounded context lives under `src/modules/<capability>` and exposes one public surface:

- `index.ts`: public API for other capabilities, platform code, and application composition.
- `contracts.ts`: optional public type-only contract surface when `index.ts` would create a composition cycle.
- `domain/`: vocabulary and rules owned by the capability.
- `application/`: use cases that coordinate domain rules and ports.
- `ports/`: capability-owned contracts for side effects.
- `api/`: HTTP route registration and transport shaping.

Do not create placeholder folders. A layer exists only when there is production code or a test-backed contract that belongs there.

`src/modules/delivery-intelligence` owns the public product role and the reusable delivery model. It names delivery objects, relations, observations, claims, metrics, query plans, audience semantics, team-profile dials, and the PostgreSQL/pgvector storage boundary. Reporting is a query over this model, not a separate temporal subsystem.

`src/modules/delivery-execution-observability` owns the safe execution-stage vocabulary, one absolute deadline and cooperative cancellation context, bounded span attributes, bounded metric labels, and telemetry ports. It never receives questions, answers, prompts, source content, people, source-native identifiers, private URLs, request headers, provider responses, credentials, or private configuration. OpenTelemetry, structured stdout, error reporting, Better Stack, and Railway adapters live under `src/infrastructure/observability`.

`src/modules/product-model` owns the slower-changing business product vocabulary: stable product, area, capability, and feature identity; its primary hierarchy; aliases; registration and lifecycle; variants; revisions; and governed identity evolution. It does not own delivery state or report composition.

`src/modules/answer-feedback` owns exact-answer feedback snapshots, append-only actor revisions, current projections, privacy-safe aggregates, review dispositions, and reviewed corrected-answer candidates. Teams owns neither this domain nor its persistence. Feedback cannot mutate the original answer, product model, lifecycle state, evaluation rating, or source systems.

`src/modules/delivery-intelligence` owns the reusable project operating model and safe delivery-query grammar. Time windows are optional query constraints, not a separate bounded context. `src/modules/knowledge-layer` supports it with versioned unstructured content, retrieval, provenance, citations, and reconciliation. Neither module may deep-import the other; cross-capability composition uses public ports and result contracts.

## Cross-Boundary Rules

- Platform and app composition import modules through `src/modules/*/index.ts`.
- Infrastructure implements ports; modules do not import infrastructure.
- Domain code has no Hono, Better Auth, Railway, database, YAML, or SDK imports.
- Application code depends on domain and ports, not concrete adapters.
- Source-system inference is treated as evidence; YAML overlays are explicit policy input, not enforcement.

The enforceable contract is `bun run static:architecture`, which runs ArchContract and dependency-cruiser. Keep both gates green when moving code across layers.

## Product-Model Fitness Rules

Product-model persistence uses the Drizzle schema and typed query builders for ordinary reads, inserts, updates, and deletes. Raw SQL is reserved for relational operations that the normal builder API does not express usefully, such as bounded recursive CTE traversal, PostgreSQL advisory transaction locks, and aggregate reconstruction. A raw-SQL exception must stay in infrastructure, remain parameterized and bounded, and have a permanent query-shape or integration test.

`tests/product-model-architecture-adherence.test.ts` turns these conventions into fail-loud Vitest checks. It verifies the domain/application/ports layout, keeps framework and infrastructure dependencies out of the core, prevents infrastructure leakage through the public barrel, rejects raw product-model DML, requires the Drizzle transaction boundary, keeps the delivery compatibility adapter on the existing report path, and requires every permanent product-model suite to be registered in `tests/manifest.json` and `tests/TEST-INDEX.md`.

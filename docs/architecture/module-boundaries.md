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

`src/modules/delivery-intelligence` owns the reusable project operating model and safe delivery-query grammar. Time windows are optional query constraints, not a separate bounded context. `src/modules/knowledge-layer` supports it with versioned unstructured content, retrieval, provenance, citations, and reconciliation. Neither module may deep-import the other; cross-capability composition uses public ports and result contracts.

## Cross-Boundary Rules

- Platform and app composition import modules through `src/modules/*/index.ts`.
- Infrastructure implements ports; modules do not import infrastructure.
- Domain code has no Hono, Better Auth, Railway, database, YAML, or SDK imports.
- Application code depends on domain and ports, not concrete adapters.
- Source-system inference is treated as evidence; YAML overlays are explicit policy input, not enforcement.

The enforceable contract is `bun run static:architecture`, which runs ArchContract and dependency-cruiser. Keep both gates green when moving code across layers.

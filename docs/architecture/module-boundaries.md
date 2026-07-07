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

`src/modules/delivery-assistant` is currently a test-backed contract layer. It names the public product role, audience scopes, maturity dials, and storage split before the loops are implemented.

## Cross-Boundary Rules

- Platform and app composition import modules through `src/modules/*/index.ts`.
- Infrastructure implements ports; modules do not import infrastructure.
- Domain code has no Hono, Better Auth, Railway, database, YAML, or SDK imports.
- Application code depends on domain and ports, not concrete adapters.
- Source-system inference is treated as evidence; YAML overlays are explicit policy input, not enforcement.

The enforceable contract is `bun run static:architecture`, which runs ArchContract and dependency-cruiser. Keep both gates green when moving code across layers.

# Sarathi Product Studio

Product Studio is an optional human-facing adapter over Sarathi's Product Capability Registry. Sarathi remains authoritative for canonical entities, hierarchy, relations, variants, registration, lifecycle, history, authorization, preview, commands, and audit.

## Runtime boundary

The Payload/Next runtime owns only its authentication records and future editorial or saved-view state. The read-only product map and dossier call Sarathi's versioned HTTP API from a server component through `src/server/sarathi-product-model-client.ts`. The browser never receives the configured Sarathi read token and cannot select an actor or installed workspace.

Product Studio login uses Payload's own secure HttpOnly cookie and database-backed session. The unchecked default retains Payload's two-hour lifetime. An editor may explicitly select **Remember me** to extend only that login to 365 days; the request-scoped duration applies to the signed token, cookie, and session record without changing the shared authentication configuration. Standard Payload logout revokes the session and clears the same cookie.

The first view is an interactive 3D text capability graph: users orbit the governed product model, drill from product areas into capabilities and features, reveal typed cross-relations, jump through search, and open the governed dossier for the current focus. Text height and node size represent hierarchy role and direct-child count, while stable color identifies the top-level product area; neither encodes delivery progress or evidence volume. A compact text navigator remains available so keyboard and assistive-technology users do not depend on WebGL graph interaction.

## Database isolation

- `PRODUCT_STUDIO_DATABASE_URL` is the only database URL read by Payload.
- Prefer a dedicated Product Studio database and role. If a shared PostgreSQL cluster is operationally required, the role owns only the `product_studio` schema and must have no privileges on Sarathi product-model, delivery, knowledge, audit, or outbox schemas/tables.
- Payload uses `schemaName: "product_studio"`, `push: false`, its own `src/migrations` directory, and explicitly registered production migrations.
- Raw SQL is permitted only in Payload-generated migration artifacts. Runtime Product Studio source uses the versioned Sarathi HTTP API and must not issue SQL against Sarathi domain storage.
- Do not point `PRODUCT_STUDIO_DATABASE_URL` at `SARATHI_STRATEGY_DATABASE_URL` or grant the Payload role write access to Sarathi domain tables.

## Sarathi access

`SARATHI_PRODUCT_STUDIO_READ_TOKEN` is a server-only, read-only credential for the installed workspace. Its authorization should permit the versioned product-model map/dossier/subgraph/coverage/availability query surface only. It must not permit commands, evidence expansion, model egress, Teams delivery, synchronization control, or cross-workspace access.

Governed mutation uses a separate user-bound credential provider and POST-only adapter. `SARATHI_PRODUCT_STUDIO_USER_CREDENTIALS_JSON` maps an authenticated Payload user ID to a short-lived Sarathi actor credential and expiry. The provider fails closed for missing, malformed, unknown, or expired mappings. Production installations should replace the environment-backed provider with their OAuth/OIDC token broker while preserving the same per-user contract.

The mutation adapter never reads `SARATHI_PRODUCT_STUDIO_READ_TOKEN`. Governed rename reauthenticates the Payload session on every preview and execute request, resolves that exact user's credential, and requires expected revision, stable idempotency key, justification, valid time, and a short-lived preview token. Confirmation is disabled for hidden impacts. A stale revision requires the editor to reload the current dossier and deliberately reapply or discard the draft.

## Availability

Product Studio deploys independently. A failed Sarathi read returns a closed error view with no product data. Product Studio health or database failures do not participate in the Teams, synchronization, or delivery-report runtimes.

The Railway service builds from the repository root so the shared Bun lockfile remains authoritative, while using `/product-studio/railway.toml` as its custom config file. The service must use its own PostgreSQL service and `PRODUCT_STUDIO_DATABASE_URL`; it must not reuse Sarathi's application database credential.

## Verification

From the repository root:

```sh
bun run check:product-studio
```

The gate runs strict TypeScript, Biome/Oxlint, permanent Vitest contract tests, and a production Next/Payload build. Build verification uses non-secret local placeholder configuration and does not connect to a live database or Sarathi API.

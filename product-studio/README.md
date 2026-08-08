# Sarathi Product Studio

Product Studio is an optional human-facing adapter over Sarathi's Product Capability Registry. Sarathi remains authoritative for canonical entities, hierarchy, relations, variants, registration, lifecycle, history, authorization, preview, commands, and audit.

## Runtime boundary

The Payload/Next runtime owns only its authentication records and future editorial or saved-view state. The read-only product map and dossier call Sarathi's versioned HTTP API from a server component through `src/server/sarathi-product-model-client.ts`. The browser never receives the configured Sarathi read token and cannot select an actor or installed workspace.

The first view provides hierarchy, relation filtering, a full-path table, and dossier summary. It uses native links, forms, lists, headings, and tables so keyboard and assistive-technology users do not depend on a visual graph interaction.

## Database isolation

- `PRODUCT_STUDIO_DATABASE_URL` is the only database URL read by Payload.
- Prefer a dedicated Product Studio database and role. If a shared PostgreSQL cluster is operationally required, the role owns only the `product_studio` schema and must have no privileges on Sarathi product-model, delivery, knowledge, audit, or outbox schemas/tables.
- Payload uses `schemaName: "product_studio"`, `push: false`, its own `src/migrations` directory, and explicitly registered production migrations.
- Raw SQL is permitted only in Payload-generated migration artifacts. Runtime Product Studio source uses the versioned Sarathi HTTP API and must not issue SQL against Sarathi domain storage.
- Do not point `PRODUCT_STUDIO_DATABASE_URL` at `SARATHI_STRATEGY_DATABASE_URL` or grant the Payload role write access to Sarathi domain tables.

## Sarathi access

`SARATHI_PRODUCT_STUDIO_READ_TOKEN` is a server-only, read-only credential for the installed workspace. Its authorization should permit the versioned product-model map/dossier/subgraph/coverage/availability query surface only. It must not permit commands, evidence expansion, model egress, Teams delivery, synchronization control, or cross-workspace access.

Governed mutation uses a separate user-bound credential provider and POST-only adapter. `SARATHI_PRODUCT_STUDIO_USER_CREDENTIALS_JSON` maps an authenticated Payload user ID to a short-lived Sarathi actor credential and expiry. The provider fails closed for missing, malformed, unknown, or expired mappings. Production installations should replace the environment-backed provider with their OAuth/OIDC token broker while preserving the same per-user contract.

The mutation adapter never reads `SARATHI_PRODUCT_STUDIO_READ_TOKEN`. Preview and execute require expected revision, stable idempotency key, justification, valid time, and a user-bound credential; execute additionally requires the short-lived preview token. UI mutation remains disabled until the preview, confirmation, and stale-revision recovery view is installed.

## Availability

Product Studio deploys independently. A failed Sarathi read returns a closed error view with no product data. Product Studio health or database failures do not participate in the Teams, synchronization, or delivery-report runtimes.

## Verification

From the repository root:

```sh
bun run check:product-studio
```

The gate runs strict TypeScript, Biome/Oxlint, permanent Vitest contract tests, and a production Next/Payload build. Build verification uses non-secret local placeholder configuration and does not connect to a live database or Sarathi API.

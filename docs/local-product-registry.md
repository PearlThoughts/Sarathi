# Local Product Registry And Product Studio

This workflow runs Sarathi's authoritative Product Capability Registry and the optional Payload-based Product Studio against separate local PostgreSQL databases. Product Studio reads and mutates product identity only through Sarathi's versioned HTTP API.

## Container engine

Use one Docker-compatible engine at a time. Docker Desktop and Colima keep independent images, networks, and volumes; switching contexts does not move database data between them.

For Docker Desktop:

```sh
open -a Docker
docker context use desktop-linux
```

For a dedicated Colima profile:

```sh
colima start sarathi --cpu 6 --memory 12 --disk 80 --vm-type vz --mount-type virtiofs --runtime docker
docker context use colima-sarathi
```

Confirm the selected engine before starting the databases:

```sh
docker context show
docker info
```

## Databases

Start the isolated PostgreSQL 18 services:

```sh
bun run local:db:up
bun run local:db:status
```

The default local-only ports are:

- `127.0.0.1:55432`: Sarathi with pgvector;
- `127.0.0.1:55433`: Product Studio/Payload.

Apply the public Sarathi migrations:

```sh
SARATHI_STRATEGY_DATABASE_URL='postgresql://sarathi_local:sarathi_local_only@127.0.0.1:55432/sarathi_local' \
  bun run knowledge migrate apply
```

Apply Product Studio's own migrations from the repository root:

```sh
PAYLOAD_SECRET='replace-with-a-local-secret' \
PRODUCT_STUDIO_DATABASE_URL='postgresql://product_studio_local:product_studio_local_only@127.0.0.1:55433/product_studio_local' \
  bun run --cwd product-studio payload migrate
```

Never point `PRODUCT_STUDIO_DATABASE_URL` at Sarathi's domain database.

## Applications

Configure the Sarathi API with a product-model database, preview secret, and explicit principals. A command principal used by the importer must permit the `product-studio` surface because the command endpoints deliberately enforce that boundary. Keep access tokens in ignored environment files or protected environment variables, not command arguments.

Start the API and Product Studio in separate terminals:

```sh
bun run dev
bun run --cwd product-studio dev
```

Use distinct local ports if another application already owns the defaults. Verify Sarathi through `/health`, then open Product Studio through `http://localhost:<port>/admin/product-map`. A new Product Studio database requires a local first-user registration before the authenticated map is visible.

## Governed proposal import

The importer consumes a generic JSON document with `version: 1`, `mode: proposals-only`, a source workspace key, and deterministic proposal records. Organization-specific vocabulary stays outside the public repository. A separate JSON relation map resolves private relation terms to Sarathi's public relation types.

Preview against the current registry revision:

```sh
SARATHI_API_BASE_URL='http://127.0.0.1:3011' \
SARATHI_PRODUCT_MODEL_ACCESS_TOKEN='<protected-token>' \
bun run product-registry preview \
  --file /private/path/proposals.json \
  --relation-map /private/path/relation-map.json \
  --workspace workspace-local \
  --valid-from 2026-01-01T00:00:00.000Z \
  --justification 'Product-owner-approved foundational product model.'
```

The preview returns a fingerprint bound to the proposal content, resolved commands, target workspace, current revision, valid time, and justification. Apply only that fingerprint:

```sh
SARATHI_API_BASE_URL='http://127.0.0.1:3011' \
SARATHI_PRODUCT_MODEL_ACCESS_TOKEN='<protected-token>' \
bun run product-registry apply \
  --file /private/path/proposals.json \
  --relation-map /private/path/relation-map.json \
  --workspace workspace-local \
  --valid-from 2026-01-01T00:00:00.000Z \
  --justification 'Product-owner-approved foundational product model.' \
  --approval-fingerprint sha256-...
```

For every command, the importer requests a server preview and submits the returned short-lived preview token. It uses expected revisions, deterministic idempotency keys, and application commands. It never writes registry tables or Payload storage directly.

Unsupported proposal kinds and unresolved relation terms are reported as explicit deferrals. A re-preview after a successful import must produce zero commands and `already-current` dispositions. Definition, hierarchy, lifecycle, audience, sensitivity, alias, relation, or registration drift is reported as a conflict rather than silently overwritten.

## Production gate

Local success does not authorize production. Before any hosted execution, record the target deployment, current registry revision, exact proposal and relation-map fingerprints, planned dispositions, server-preview impacts, rollback procedure, and explicit product-owner approval. Hosted commands must use the same API path; direct SQL and Payload persistence remain prohibited.

Stop local services without deleting their volumes:

```sh
bun run local:db:down
```

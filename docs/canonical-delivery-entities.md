# Canonical Delivery Entities

Sarathi keeps source-native identifiers for provenance while assigning every projected delivery object a workspace-local canonical key. This permits structured joins across Jira, Vault, GitHub, Teams, and email without introducing a graph database or a second data platform.

## Private catalog

Production supplies `SARATHI_DELIVERY_ENTITY_CATALOG_JSON` from the private deployment overlay. The public repository owns the validated contract and join behavior; private project, module, repository, and person names remain deployment data.

```json
{
  "version": 1,
  "entities": [
    {
      "kind": "module",
      "canonicalKey": "product-builder",
      "title": "Product Builder",
      "aliases": [
        { "source": "github", "value": "repository-name" },
        { "source": "jira", "value": "component-name" },
        { "value": "shared delivery name" }
      ]
    }
  ]
}
```

Aliases may be source-qualified when the same word has different meanings in different systems. Catalog validation rejects duplicate canonical keys, unknown kinds or sources, blank aliases, and ambiguous aliases. If no configured alias matches, Sarathi retains a deterministic `kind:external-key` identity rather than guessing.

The catalog is read only by ingestion paths. Query paths use persisted canonical keys and aliases, and still authorize the underlying source object before an alias can affect retrieval or leave the system.

## Time semantics

Projected records preserve separate timestamps:

- `sourceCreatedAt`: when the source says the item was created, when available.
- `sourceUpdatedAt`: the source revision time used for freshness and convergence.
- `observedAt`: the business observation time used by delivery query windows.
- `indexedAt`: when Sarathi persisted the projection.

Backfilled historical rows retain their prior observation time as the safest available source-update and index approximation. New source adapters must not substitute ingestion time for a known source timestamp.

## Lifecycle

An edit deactivates the previous source projection and its aliases before activating the new version. A deletion or scope removal retires both the source object and its alias rows. Canonical keys group authorized results across sources; source item IDs and citation URLs remain unchanged so every answer can resolve back to evidence.

import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { KnowledgePostgresDatabase } from "../src/infrastructure/postgres/knowledge-migrations.ts";
import {
  buildProductHierarchyTraversalQuery,
  buildProductModelRevisionQuery,
  buildProductRelationReadQuery,
  createPostgresProductModelGraphRepository,
} from "../src/infrastructure/postgres/product-model-graph-repository.ts";
import { parseProductEntityId } from "../src/modules/product-model/index.ts";

const workspaceId = "workspace-synthetic";
const rootId = "00000000-0000-4000-8000-000000000001";

const entityId = (value: string) => Effect.runSync(parseProductEntityId(value));

const request = () => ({
  workspaceId,
  rootEntityId: entityId(rootId),
  direction: "descendants" as const,
  maximumDepth: 4,
  maximumNodes: 50,
  point: { kind: "current" as const, at: "2026-01-02T00:00:00.000Z" },
  visibility: {
    audienceIds: ["workspace:synthetic", "role:owner"],
    maximumSensitivity: "internal" as const,
  },
});

describe("PostgreSQL product-model graph repository", () => {
  it("reads only induced, visible, bounded relation overlays", () => {
    const compiled = new PgDialect().sqlToQuery(
      buildProductRelationReadQuery({
        workspaceId,
        entityIds: [entityId(rootId), entityId("00000000-0000-4000-8000-000000000002")],
        maximumRelations: 25,
        point: { kind: "current", at: "2026-01-02T00:00:00.000Z" },
        visibility: {
          audienceIds: ["workspace:synthetic"],
          maximumSensitivity: "internal",
        },
      }),
    );

    expect(compiled.sql).toContain("from product_relation relation");
    expect(compiled.sql).toContain("select distinct on (relation.id)");
    expect(compiled.sql).toContain("relation.audience ?| array[$");
    expect(compiled.sql).toContain("relation.source_entity_id = any(array[$");
    expect(compiled.sql).toContain("relation.target_entity_id = any(array[$");
    expect(compiled.sql).toContain("limit $");
    expect(compiled.params).toContain(26);
  });

  it("resolves current and historical workspace revisions with bound parameters", () => {
    const dialect = new PgDialect();
    const current = dialect.sqlToQuery(
      buildProductModelRevisionQuery(workspaceId, {
        kind: "current",
        at: "2026-01-02T00:00:00.000Z",
      }),
    );
    const historical = dialect.sqlToQuery(
      buildProductModelRevisionQuery(workspaceId, { kind: "revision", revision: 7 }),
    );

    expect(current.sql).toContain("select max(revision)::integer as revision");
    expect(current.sql).toContain("recorded_at <= $");
    expect(current.params).toContain("2026-01-02T00:00:00.000Z");
    expect(historical.sql).toContain("revision = $");
    expect(historical.params).toContain(7);
  });

  it("injects temporal and row-visibility predicates before bounded recursive traversal", () => {
    const compiled = new PgDialect().sqlToQuery(buildProductHierarchyTraversalQuery(request()));

    expect(compiled.sql).toContain("with recursive selected_revision");
    expect(compiled.sql).toContain("state.workspace_id = $");
    expect(compiled.sql).toContain("edge.workspace_id = $");
    expect(compiled.sql).toContain("state.recorded_at <= $");
    expect(compiled.sql).toContain("edge.recorded_at <= $");
    expect(compiled.sql).toMatch(/state\.audience \?\| array\[\$\d+, \$\d+\]::text\[\]/);
    expect(compiled.sql).toContain("case state.sensitivity");
    expect(compiled.sql).toContain("inner join visible_state child");
    expect(compiled.sql).toContain("inner join visible_state parent");
    expect(compiled.sql).toContain("walk.depth < $");
    expect(compiled.sql).toContain("not next_state.entity_id = any(walk.path)");
    expect(compiled.sql).toContain("limit $");
    expect(compiled.params).toContain(workspaceId);
    expect(compiled.params).toContain(rootId);
    expect(compiled.params).toContain(1);
    expect(compiled.params).toContain(4);
    expect(compiled.params).toContain(51);
    expect(compiled.params).toContain("workspace:synthetic");
    expect(compiled.params).toContain("role:owner");
  });

  it("resolves revision history through the revision timestamp without removing bounds", () => {
    const compiled = new PgDialect().sqlToQuery(
      buildProductHierarchyTraversalQuery({
        ...request(),
        point: { kind: "revision", revision: 7 },
      }),
    );

    expect(compiled.sql).toContain("from product_revision");
    expect(compiled.sql).toContain("state.recorded_at <= selected.recorded_at");
    expect(compiled.sql).toContain("edge.recorded_at <= selected.recorded_at");
    expect(compiled.params).toContain(7);
    expect(compiled.params).toContain(51);
  });

  it("reconstructs valid-time history from closed rows instead of erasing past intervals", () => {
    const compiled = new PgDialect().sqlToQuery(
      buildProductHierarchyTraversalQuery({
        ...request(),
        point: { kind: "valid_time", at: "2025-06-01T00:00:00.000Z" },
      }),
    );

    expect(compiled.sql).toMatch(
      /or \(\$\d+ = 'valid_time'\s+and state\.valid_from <= \$\d+::timestamptz/,
    );
    expect(compiled.sql).toMatch(
      /or \(\$\d+ = 'valid_time'\s+and edge\.valid_from <= \$\d+::timestamptz/,
    );
    expect(compiled.params).toContain("2025-06-01T00:00:00.000Z");
  });

  it("keeps an empty effective audience fail-closed while allowing explicitly public rows", () => {
    const compiled = new PgDialect().sqlToQuery(
      buildProductHierarchyTraversalQuery({
        ...request(),
        visibility: { audienceIds: [], maximumSensitivity: "public" },
      }),
    );

    expect(compiled.sql).toContain("state.audience = '[]'::jsonb");
    expect(compiled.sql).toContain("state.audience ?| array[]::text[]");
    expect(compiled.params).toContain(0);
  });

  it("rejects invalid ancestor and resource bounds before database access", async () => {
    const execute = vi.fn();
    const repository = createPostgresProductModelGraphRepository({
      execute,
    } as unknown as KnowledgePostgresDatabase);

    const missingRoot = await Effect.runPromise(
      Effect.either(
        repository.traverseHierarchy({
          ...request(),
          rootEntityId: undefined,
          direction: "ancestors",
        }),
      ),
    );
    const excessiveDepth = await Effect.runPromise(
      Effect.either(repository.traverseHierarchy({ ...request(), maximumDepth: 9 })),
    );
    const excessiveNodes = await Effect.runPromise(
      Effect.either(repository.traverseHierarchy({ ...request(), maximumNodes: 501 })),
    );

    expect(missingRoot._tag).toBe("Left");
    expect(excessiveDepth._tag).toBe("Left");
    expect(excessiveNodes._tag).toBe("Left");
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns a deterministic bounded page and an explicit truncation signal", async () => {
    const rows = [
      {
        entityId: rootId,
        parentId: null,
        kind: "product",
        canonicalName: "Synthetic Product",
        description: null,
        registration: "ratified",
        lifecycle: "available",
        sensitivity: "internal",
        audience: ["workspace:synthetic"],
        revision: 3,
        depth: 0,
      },
      {
        entityId: "00000000-0000-4000-8000-000000000002",
        parentId: rootId,
        kind: "area",
        canonicalName: "Synthetic Area",
        description: "Fixture-only area",
        registration: "ratified",
        lifecycle: "available",
        sensitivity: "internal",
        audience: ["workspace:synthetic"],
        revision: 3,
        depth: 1,
      },
    ] as const;
    const execute = vi.fn(async () => ({ rows }));
    const repository = createPostgresProductModelGraphRepository({
      execute,
    } as unknown as KnowledgePostgresDatabase);

    const result = await Effect.runPromise(
      repository.traverseHierarchy({ ...request(), maximumNodes: 1 }),
    );

    expect(result).toEqual({
      nodes: [
        {
          entityId: rootId,
          kind: "product",
          canonicalName: "Synthetic Product",
          registration: "ratified",
          lifecycle: "available",
          sensitivity: "internal",
          audience: ["workspace:synthetic"],
          revision: 3,
          depth: 0,
        },
      ],
      truncated: true,
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});

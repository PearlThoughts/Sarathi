import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  createProductModelQueryService,
  type ProductHierarchyNode,
  ProductModelAccessDenied,
  type ProductModelGraphRepository,
  type ProductModelQueryAuthorizer,
  ProductModelQueryUnavailable,
  type ProductModelRequestContext,
  parseProductEntityId,
} from "../src/modules/product-model/index.ts";

const workspaceId = "workspace-synthetic";
const rootEntityId = Effect.runSync(parseProductEntityId("00000000-0000-4000-8000-000000000001"));
const childEntityId = Effect.runSync(parseProductEntityId("00000000-0000-4000-8000-000000000002"));

const context: ProductModelRequestContext = {
  organizationId: "organization-synthetic",
  workspaceId,
  actorId: "actor-synthetic",
  trustTier: "trusted",
  effectiveAudience: ["workspace:synthetic", "role:owner"],
  maximumSensitivity: "internal",
  modelEgress: "block",
  permittedCorpusScopes: ["product-model"],
  requestId: "request-synthetic",
  surface: "product-studio",
};

const root: ProductHierarchyNode = {
  entityId: rootEntityId,
  kind: "product",
  canonicalName: "Synthetic Product",
  registration: "ratified",
  lifecycle: "available",
  sensitivity: "internal",
  audience: ["workspace:synthetic"],
  revision: 3,
  depth: 0,
};

const child: ProductHierarchyNode = {
  entityId: childEntityId,
  parentId: rootEntityId,
  kind: "area",
  canonicalName: "Synthetic Area",
  registration: "ratified",
  lifecycle: "available",
  sensitivity: "internal",
  audience: ["workspace:synthetic"],
  revision: 3,
  depth: 1,
};

const relation = {
  id: "relation-synthetic",
  workspaceId,
  type: "depends_on" as const,
  source: { kind: "entity" as const, entityId: childEntityId },
  target: { kind: "entity" as const, entityId: rootEntityId },
  registration: "ratified" as const,
  sourceClass: "fixture",
  sensitivity: "internal" as const,
  audience: ["workspace:synthetic"],
  validFrom: "2026-01-01T00:00:00.000Z",
  createdRevision: 3,
};

const allowedAuthorizer = (events: string[]): ProductModelQueryAuthorizer => ({
  authorize: (_request, operation) =>
    Effect.sync(() => {
      events.push(`authorize:${operation}`);
      return { allowed: true, reason: "Allowed.", policyVersion: "policy-1" };
    }),
});

const repository = (events: string[]): ProductModelGraphRepository => ({
  resolveRevision: ({ point }) =>
    Effect.sync(() => {
      events.push(`revision:${point.kind}`);
      return 3;
    }),
  readRelations: ({ point }) =>
    Effect.sync(() => {
      events.push(`relations:${point.kind}`);
      return { relations: [relation], truncated: false };
    }),
  traverseHierarchy: (request) =>
    Effect.sync(() => {
      events.push(`traverse:${request.direction}:${request.point.kind}`);
      return {
        nodes: request.direction === "ancestors" ? [root] : [root, child],
        truncated: request.maximumNodes === 1,
      };
    }),
});

describe("product-model application queries", () => {
  it("denies before revision or graph repository access", async () => {
    const authorize = vi.fn(() =>
      Effect.succeed({ allowed: false, reason: "Workspace denied.", policyVersion: "policy-1" }),
    );
    const resolveRevision = vi.fn();
    const readRelations = vi.fn();
    const traverseHierarchy = vi.fn();
    const service = createProductModelQueryService({ authorize }, {
      resolveRevision,
      readRelations,
      traverseHierarchy,
    } as unknown as ProductModelGraphRepository);

    const result = await Effect.runPromise(
      Effect.either(service.getProductMap(context, { at: "2026-01-02T00:00:00.000Z" })),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left).toBeInstanceOf(ProductModelAccessDenied);
    expect(authorize).toHaveBeenCalledOnce();
    expect(resolveRevision).not.toHaveBeenCalled();
    expect(readRelations).not.toHaveBeenCalled();
    expect(traverseHierarchy).not.toHaveBeenCalled();
  });

  it("authorizes once before returning a bounded current map envelope", async () => {
    const events: string[] = [];
    const service = createProductModelQueryService(allowedAuthorizer(events), repository(events));

    const result = await Effect.runPromise(
      service.getProductMap(context, {
        at: "2026-01-02T00:00:00.000Z",
        maximumDepth: 3,
        maximumNodes: 1,
      }),
    );

    expect(events).toEqual([
      "authorize:get-map",
      "revision:current",
      "traverse:descendants:current",
      "relations:current",
    ]);
    expect(result).toMatchObject({
      workspaceId,
      asOf: "2026-01-02T00:00:00.000Z",
      revision: 3,
      page: { maximumDepth: 3, maximumNodes: 1, truncated: true },
      relationPage: { maximumRelations: 250, truncated: false },
      safeWarnings: ["Product graph results were truncated at the authorized query bound."],
    });
  });

  it("uses business valid time for historical graph queries", async () => {
    const events: string[] = [];
    const service = createProductModelQueryService(allowedAuthorizer(events), repository(events));

    const result = await Effect.runPromise(
      service.getProductGraphAtTime(context, { validAt: "2025-06-01T00:00:00.000Z" }),
    );

    expect(events).toEqual([
      "authorize:get-historical-graph",
      "revision:valid_time",
      "traverse:descendants:valid_time",
      "relations:valid_time",
    ]);
    expect(result.asOf).toBe("2025-06-01T00:00:00.000Z");
  });

  it("authorizes before resolving a bounded ancestor and descendant subgraph", async () => {
    const events: string[] = [];
    const service = createProductModelQueryService(allowedAuthorizer(events), repository(events));

    const result = await Effect.runPromise(
      service.getCapabilitySubgraph(context, {
        rootEntityId,
        at: "2026-01-02T00:00:00.000Z",
        maximumAncestorDepth: 2,
        maximumDescendantDepth: 3,
        maximumNodesPerDirection: 10,
      }),
    );

    expect(events[0]).toBe("authorize:get-subgraph");
    expect(events[1]).toBe("revision:current");
    expect(events.slice(2, 4).sort()).toEqual([
      "traverse:ancestors:current",
      "traverse:descendants:current",
    ]);
    expect(events[4]).toBe("relations:current");
    expect(result).toMatchObject({
      workspaceId,
      revision: 3,
      rootEntityId,
      pages: {
        ancestors: { maximumDepth: 2, maximumNodes: 10, truncated: false },
        descendants: { maximumDepth: 3, maximumNodes: 10, truncated: false },
        relations: { maximumRelations: 250, truncated: false },
      },
    });
  });

  it("stops before traversal when the authorized revision is unavailable", async () => {
    const traverseHierarchy = vi.fn();
    const service = createProductModelQueryService(allowedAuthorizer([]), {
      resolveRevision: () => Effect.succeed(undefined),
      readRelations: () => Effect.succeed({ relations: [], truncated: false }),
      traverseHierarchy,
    });

    const result = await Effect.runPromise(
      Effect.either(service.getProductMap(context, { at: "2026-01-02T00:00:00.000Z" })),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left).toBeInstanceOf(ProductModelQueryUnavailable);
    expect(traverseHierarchy).not.toHaveBeenCalled();
  });
});

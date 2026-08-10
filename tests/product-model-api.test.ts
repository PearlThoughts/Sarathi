import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import {
  ProductModelAccessDenied,
  type ProductModelApiDependencies,
  type ProductModelDetailQueryService,
  type ProductModelQueryService,
  type ProductModelRequestContext,
  parseProductEntityId,
} from "../src/modules/product-model/index.ts";
import { makeSarathiRuntime } from "../src/platform/runtime.ts";

const workspaceId = "workspace-synthetic";
const entityId = Effect.runSync(parseProductEntityId("00000000-0000-4000-8000-000000000201"));
const at = "2026-01-02T00:00:00.000Z";

const context: ProductModelRequestContext = {
  organizationId: "organization-synthetic",
  workspaceId,
  actorId: "actor-from-session",
  trustTier: "trusted",
  effectiveAudience: ["workspace:synthetic"],
  maximumSensitivity: "internal",
  modelEgress: "block",
  permittedCorpusScopes: ["product-model"],
  requestId: "request-synthetic",
  surface: "api",
};

const entity = {
  entityId,
  kind: "feature" as const,
  canonicalName: "Synthetic Feature",
  registration: "ratified" as const,
  lifecycle: "available" as const,
  sensitivity: "internal" as const,
  audience: ["workspace:synthetic"],
  revision: 4,
  depth: 0,
};

const graph = {
  workspaceId,
  asOf: at,
  revision: 4,
  entities: [entity],
  relations: [],
  page: { maximumDepth: 4, maximumNodes: 250, truncated: false },
  relationPage: { maximumRelations: 250, truncated: false },
  safeWarnings: [],
};

const dossier = {
  workspaceId,
  asOf: at,
  revision: 4,
  entity: {
    id: entityId,
    workspaceId,
    kind: "feature" as const,
    canonicalName: "Synthetic Feature",
    registration: "ratified" as const,
    lifecycle: "available" as const,
    sensitivity: "internal" as const,
    audience: ["workspace:synthetic"],
    createdRevision: 1,
    updatedRevision: 4,
  },
  aliases: [],
  variants: [],
  claims: [],
  externalReferences: [],
  proposals: [],
  relations: [],
  safeWarnings: [],
};

const queries = (overrides: Partial<ProductModelQueryService> = {}): ProductModelQueryService => ({
  getProductMap: () => Effect.succeed(graph),
  getProductGraphAtTime: () => Effect.die("not used"),
  getCapabilitySubgraph: () =>
    Effect.succeed({
      workspaceId,
      asOf: at,
      revision: 4,
      rootEntityId: entityId,
      ancestors: [entity],
      descendants: [entity],
      relations: [],
      pages: {
        ancestors: { maximumDepth: 4, maximumNodes: 100, truncated: false },
        descendants: { maximumDepth: 4, maximumNodes: 100, truncated: false },
        relations: { maximumRelations: 250, truncated: false },
      },
      safeWarnings: [],
    }),
  ...overrides,
});

const details = (
  overrides: Partial<ProductModelDetailQueryService> = {},
): ProductModelDetailQueryService => ({
  getFeatureDossier: () => Effect.succeed(dossier),
  getProductCoverage: () =>
    Effect.succeed({
      workspaceId,
      asOf: at,
      revision: 4,
      items: [],
      page: { maximumItems: 250, truncated: false },
      safeWarnings: [],
    }),
  getProductAvailability: (_context, request) =>
    Effect.succeed({
      workspaceId,
      asOf: at,
      revision: 4,
      entityId,
      lifecycle: "available",
      resolvedVariant: {
        entityId,
        qualifiers: request.qualifiers,
        appliedVariantIds: [],
        appliedVariants: [],
        delta: {},
      },
      availabilityClaims: [],
      availabilityReferences: [],
      deliveryStages: [],
      safeWarnings: [],
    }),
  ...overrides,
});

const dependencies = (
  overrides: Partial<ProductModelApiDependencies> = {},
): ProductModelApiDependencies => ({
  queries: queries(),
  details: details(),
  context: { resolve: () => Effect.succeed(context) },
  now: () => at,
  ...overrides,
});

const runtime = (productModelApi?: ProductModelApiDependencies) =>
  makeSarathiRuntime({
    config: {
      serviceName: "sarathi",
      environment: "test",
      http: { port: 0 },
      overlayPath: "unused",
      auth: { provider: "static" },
    },
    productModelApi,
    clock: { now: () => at },
  });

describe("product-model HTTP API", () => {
  it("resolves server-owned context before the authorized map service", async () => {
    const events: string[] = [];
    const getProductMap = vi.fn((requestContext: ProductModelRequestContext) =>
      Effect.sync(() => {
        events.push(`query:${requestContext.actorId}`);
        return graph;
      }),
    );
    const app = createApp(
      runtime(
        dependencies({
          queries: queries({ getProductMap }),
          context: {
            resolve: (request, requestedWorkspaceId, surface) =>
              Effect.sync(() => {
                events.push(`context:${requestedWorkspaceId}:${surface}`);
                expect(request.headers.get("x-actor-id")).toBe("browser-claim");
                return context;
              }),
          },
        }),
      ),
    );

    const response = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/map?maximumDepth=4`,
      { headers: { "x-actor-id": "browser-claim" } },
    );

    expect(response.status).toBe(200);
    expect(events).toEqual([`context:${workspaceId}:api`, "query:actor-from-session"]);
    await expect(response.json()).resolves.toMatchObject({
      data: { workspaceId, revision: 4, entities: [{ entityId }] },
    });
  });

  it("denies before map, dossier, or repository-adjacent service access", async () => {
    const getProductMap = vi.fn();
    const getFeatureDossier = vi.fn();
    const app = createApp(
      runtime(
        dependencies({
          queries: queries({ getProductMap }),
          details: details({ getFeatureDossier }),
          context: {
            resolve: () => Effect.fail(new ProductModelAccessDenied("Session denied.", "get-map")),
          },
        }),
      ),
    );

    const response = await app.request(`/v1/workspaces/${workspaceId}/product-model/map`);

    expect(response.status).toBe(403);
    expect(getProductMap).not.toHaveBeenCalled();
    expect(getFeatureDossier).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: { code: "PRODUCT_MODEL_ACCESS_DENIED", message: "Access denied." },
    });
  });

  it("rejects a resolver context for a different workspace before query access", async () => {
    const getProductMap = vi.fn();
    const app = createApp(
      runtime(
        dependencies({
          queries: queries({ getProductMap }),
          context: {
            resolve: () => Effect.succeed({ ...context, workspaceId: "workspace-not-requested" }),
          },
        }),
      ),
    );

    const response = await app.request(`/v1/workspaces/${workspaceId}/product-model/map`);

    expect(response.status).toBe(403);
    expect(getProductMap).not.toHaveBeenCalled();
  });

  it("serves dossiers and bounded subgraphs without exposing repository parameters", async () => {
    const app = createApp(runtime(dependencies()));

    const dossierResponse = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/entities/${entityId}`,
    );
    const subgraphResponse = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/entities/${entityId}/subgraph?maximumDescendantDepth=3`,
    );

    expect(dossierResponse.status).toBe(200);
    await expect(dossierResponse.json()).resolves.toMatchObject({
      data: { entity: { id: entityId }, claims: [], externalReferences: [] },
    });
    expect(subgraphResponse.status).toBe(200);
    await expect(subgraphResponse.json()).resolves.toMatchObject({
      data: { rootEntityId: entityId, descendants: [{ entityId }] },
    });
  });

  it("exposes bounded valid-time history through the authorized query service", async () => {
    const getProductGraphAtTime = vi.fn(() => Effect.succeed(graph));
    const app = createApp(runtime(dependencies({ queries: queries({ getProductGraphAtTime }) })));

    const response = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/history?validAt=${encodeURIComponent(at)}&maximumRelations=500`,
    );

    expect(response.status).toBe(200);
    expect(getProductGraphAtTime).toHaveBeenCalledWith(context, {
      validAt: at,
      maximumDepth: 4,
      maximumNodes: 250,
      maximumRelations: 500,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { workspaceId, revision: 4 },
    });
  });

  it("requires a valid history instant before historical graph access", async () => {
    const getProductGraphAtTime = vi.fn();
    const app = createApp(runtime(dependencies({ queries: queries({ getProductGraphAtTime }) })));

    const missing = await app.request(`/v1/workspaces/${workspaceId}/product-model/history`);
    const invalid = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/history?validAt=not-an-instant`,
    );

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(getProductGraphAtTime).not.toHaveBeenCalled();
  });

  it("validates traversal bounds after context resolution and before graph access", async () => {
    const events: string[] = [];
    const getProductMap = vi.fn();
    const app = createApp(
      runtime(
        dependencies({
          queries: queries({ getProductMap }),
          context: {
            resolve: () =>
              Effect.sync(() => {
                events.push("context");
                return context;
              }),
          },
        }),
      ),
    );

    const response = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/map?maximumNodes=5000`,
    );

    expect(response.status).toBe(400);
    expect(events).toEqual(["context"]);
    expect(getProductMap).not.toHaveBeenCalled();
  });

  it("rejects invalid temporal inputs before query access", async () => {
    const getProductMap = vi.fn();
    const app = createApp(runtime(dependencies({ queries: queries({ getProductMap }) })));

    const response = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/map?at=not-an-instant`,
    );

    expect(response.status).toBe(400);
    expect(getProductMap).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_REQUEST", message: "at must be an ISO-8601 instant." },
    });
  });

  it("accepts only typed, unique availability qualifiers", async () => {
    const getProductAvailability = vi.fn(details().getProductAvailability);
    const app = createApp(runtime(dependencies({ details: details({ getProductAvailability }) })));

    const valid = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/availability/${entityId}?qualifier=environment:test&qualifier=build:42`,
    );
    const invalid = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/availability/${entityId}?qualifier=unknown:test`,
    );

    expect(valid.status).toBe(200);
    expect(getProductAvailability).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ qualifiers: { environment: "test", build: "42" } }),
    );
    expect(invalid.status).toBe(400);
  });

  it("keeps platform health available when Product Studio dependencies are absent", async () => {
    const app = createApp(runtime());

    const productResponse = await app.request(`/v1/workspaces/${workspaceId}/product-model/map`);
    const healthResponse = await app.request("/health");

    expect(productResponse.status).toBe(503);
    await expect(productResponse.json()).resolves.toEqual({
      error: {
        code: "PRODUCT_MODEL_UNAVAILABLE",
        message: "The product-model service is unavailable.",
      },
    });
    expect(healthResponse.status).toBe(200);
  });
});

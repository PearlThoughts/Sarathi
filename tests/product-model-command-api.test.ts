import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import {
  ProductCommandPersistenceError,
  ProductModelAccessDenied,
  type ProductModelApiDependencies,
  type ProductModelCommandService,
  type ProductModelDetailQueryService,
  type ProductModelQueryService,
  type ProductModelRequestContext,
  parseProductEntityId,
} from "../src/modules/product-model/index.ts";
import { makeSarathiRuntime } from "../src/platform/runtime.ts";

const workspaceId = "workspace-synthetic";
const entityId = Effect.runSync(parseProductEntityId("00000000-0000-4000-8000-000000000201"));
const now = "2026-01-02T00:00:00.000Z";

const requestContext: ProductModelRequestContext = {
  organizationId: "organization-synthetic",
  workspaceId,
  actorId: "actor-from-server-session",
  trustTier: "trusted",
  effectiveAudience: ["workspace:synthetic"],
  maximumSensitivity: "internal",
  modelEgress: "block",
  permittedCorpusScopes: ["product-model"],
  requestId: "request-synthetic-command",
  surface: "product-studio",
};

const unusedQueries: ProductModelQueryService = {
  getProductMap: () => Effect.die("not used"),
  getProductGraphAtTime: () => Effect.die("not used"),
  getCapabilitySubgraph: () => Effect.die("not used"),
};

const unusedDetails: ProductModelDetailQueryService = {
  getFeatureDossier: () => Effect.die("not used"),
  getProductCoverage: () => Effect.die("not used"),
  getProductAvailability: () => Effect.die("not used"),
};

const renameCommand = {
  type: "RenameEntity",
  workspaceId,
  targetId: entityId,
  expectedRevision: 4,
  idempotencyKey: "synthetic-command-api-0001",
  justification: "The product owner approved the clearer canonical name.",
  validFrom: now,
  payload: {
    canonicalName: "Synthetic Capability",
    canonicalAliasId: "alias-synthetic-command",
  },
} as const;

const commandService = (
  overrides: Partial<ProductModelCommandService> = {},
): ProductModelCommandService => ({
  preview: () =>
    Effect.succeed({
      status: "previewed",
      workspaceId,
      expectedRevision: 4,
      resultingRevision: 5,
      commandHash: "sha256-synthetic-command",
      previewToken: "preview-synthetic-command",
      expiresAt: "2026-01-02T00:05:00.000Z",
      policyVersion: "policy-synthetic-v1",
      impact: {
        changedEntityIds: [entityId],
        hiddenEntityImpactCount: 0,
        changedCollections: { entities: 2, aliases: 2 },
      },
      invariantResults: [{ status: "passed", name: "product-model-domain-invariants" }],
    }),
  execute: () =>
    Effect.succeed({
      status: "committed",
      revision: 5,
      eventId: "event-synthetic-command",
      changedEntityIds: [entityId],
      replayed: false,
      projectionState: "pending",
    }),
  ...overrides,
});

const dependencies = (
  commands: ProductModelCommandService | undefined,
  resolve: ProductModelApiDependencies["context"]["resolve"] = () => Effect.succeed(requestContext),
): ProductModelApiDependencies => ({
  queries: unusedQueries,
  details: unusedDetails,
  ...(commands === undefined ? {} : { commands }),
  context: { resolve },
  now: () => now,
});

const runtime = (productModelApi: ProductModelApiDependencies) =>
  makeSarathiRuntime({
    config: {
      serviceName: "sarathi",
      environment: "test",
      http: { port: 0 },
      overlayPath: "unused",
      auth: { provider: "static" },
    },
    productModelApi,
    clock: { now: () => now },
  });

describe("product-model command HTTP API", () => {
  it("resolves a server-owned Product Studio context before preview", async () => {
    const events: string[] = [];
    const preview = vi.fn((context: ProductModelRequestContext) =>
      Effect.sync(() => {
        events.push(`preview:${context.actorId}`);
        return {
          status: "previewed" as const,
          workspaceId,
          expectedRevision: 4,
          resultingRevision: 5,
          commandHash: "sha256-synthetic-command",
          previewToken: "preview-synthetic-command",
          expiresAt: "2026-01-02T00:05:00.000Z",
          policyVersion: "policy-synthetic-v1",
          impact: {
            changedEntityIds: [entityId],
            hiddenEntityImpactCount: 0,
            changedCollections: { entities: 2 },
          },
          invariantResults: [
            { status: "passed" as const, name: "product-model-domain-invariants" },
          ] as const,
        };
      }),
    );
    const app = createApp(
      runtime(
        dependencies(commandService({ preview }), (request, requestedWorkspaceId, surface) =>
          Effect.sync(() => {
            events.push(`context:${requestedWorkspaceId}:${surface}`);
            expect(request.headers.get("x-actor-id")).toBe("browser-claim");
            return requestContext;
          }),
        ),
      ),
    );

    const response = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/changes/preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-actor-id": "browser-claim" },
        body: JSON.stringify(renameCommand),
      },
    );

    expect(response.status).toBe(200);
    expect(events).toEqual([
      `context:${workspaceId}:product-studio`,
      "preview:actor-from-server-session",
    ]);
    expect(preview).toHaveBeenCalledWith(requestContext, renameCommand);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "previewed", expectedRevision: 4, resultingRevision: 5 },
    });
  });

  it("denies before parsing or command-service access", async () => {
    const preview = vi.fn();
    const app = createApp(
      runtime(
        dependencies(commandService({ preview }), () =>
          Effect.fail(new ProductModelAccessDenied("Session denied.", "get-map")),
        ),
      ),
    );

    const response = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/changes/preview`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "not-json" },
    );

    expect(response.status).toBe(403);
    expect(preview).not.toHaveBeenCalled();
  });

  it("rejects browser-selected actor fields and unknown command properties", async () => {
    const preview = vi.fn();
    const app = createApp(runtime(dependencies(commandService({ preview }))));

    const response = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/changes/preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...renameCommand, actorId: "browser-selected-actor" }),
      },
    );

    expect(response.status).toBe(400);
    expect(preview).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_REQUEST", message: "Product command body is invalid." },
    });
  });

  it("returns a typed conflict for stale execute revisions", async () => {
    const execute = vi.fn(() =>
      Effect.fail(
        new ProductCommandPersistenceError(
          "stale_revision",
          "Expected product-model revision 4; current revision is 5.",
        ),
      ),
    );
    const app = createApp(runtime(dependencies(commandService({ execute }))));

    const response = await app.request(`/v1/workspaces/${workspaceId}/product-model/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...renameCommand, previewToken: "preview-synthetic-command" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "stale_revision",
        message: "Expected product-model revision 4; current revision is 5.",
      },
    });
  });

  it("requires a bound preview before Product Studio execution", async () => {
    const execute = vi.fn();
    const app = createApp(runtime(dependencies(commandService({ execute }))));

    const response = await app.request(`/v1/workspaces/${workspaceId}/product-model/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(renameCommand),
    });

    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "previewToken is required for Product Studio commands.",
      },
    });
  });

  it("keeps platform health available when command dependencies are absent", async () => {
    const app = createApp(runtime(dependencies(undefined)));

    const commandResponse = await app.request(
      `/v1/workspaces/${workspaceId}/product-model/commands`,
      { method: "POST" },
    );
    const healthResponse = await app.request("/health");

    expect(commandResponse.status).toBe(503);
    expect(healthResponse.status).toBe(200);
  });
});

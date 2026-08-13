import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  createProductModelDetailQueryService,
  type ProductDossierSnapshot,
  ProductModelAccessDenied,
  type ProductModelDetailRepository,
  type ProductModelGraphRepository,
  type ProductModelQueryAuthorizer,
  type ProductModelRequestContext,
  parseProductEntityId,
} from "../src/modules/product-model/index.ts";

const workspaceId = "workspace-synthetic";
const entityId = Effect.runSync(parseProductEntityId("00000000-0000-4000-8000-000000000003"));
const at = "2026-01-02T00:00:00.000Z";

const context: ProductModelRequestContext = {
  organizationId: "organization-synthetic",
  workspaceId,
  actorId: "actor-synthetic",
  trustTier: "trusted",
  effectiveAudience: ["workspace:synthetic"],
  maximumSensitivity: "internal",
  modelEgress: "block",
  permittedCorpusScopes: ["product-model"],
  requestId: "request-synthetic",
  surface: "product-studio",
};

const dossier: ProductDossierSnapshot = {
  entity: {
    id: entityId,
    workspaceId,
    kind: "feature",
    canonicalName: "Synthetic Feature",
    registration: "ratified",
    lifecycle: "available",
    sensitivity: "internal",
    audience: ["workspace:synthetic"],
    createdRevision: 1,
    updatedRevision: 4,
  },
  aliases: [],
  variants: [
    {
      id: "variant-synthetic",
      workspaceId,
      baseEntityId: entityId,
      qualifiers: { environment: "test" },
      delta: { hostname: "synthetic.test" },
      precedence: 10,
      registration: "ratified",
      sourceClass: "fixture",
      sensitivity: "internal",
      audience: ["workspace:synthetic"],
      validFrom: "2026-01-01T00:00:00.000Z",
      createdRevision: 3,
    },
  ],
  claims: [
    {
      id: "claim-synthetic",
      entityId,
      type: "availability",
      predicate: "available_in",
      value: { environment: "test" },
      evidenceReferenceCount: 1,
      registration: "ratified",
      sourceClass: "fixture",
      sensitivity: "internal",
      audience: ["workspace:synthetic"],
      validFrom: "2026-01-01T00:00:00.000Z",
      createdRevision: 4,
    },
  ],
  externalReferences: [
    {
      id: "reference-synthetic",
      entityId,
      kind: "runtime",
      sourceClass: "fixture",
      externalId: "runtime-synthetic",
      sensitivity: "internal",
      audience: ["workspace:synthetic"],
      modelEgress: "block",
      validFrom: "2026-01-01T00:00:00.000Z",
      createdRevision: 4,
    },
  ],
  proposals: [
    {
      id: "proposal-synthetic",
      commandType: "RenameEntity",
      targetEntityIds: [entityId],
      expectedRevision: 4,
      state: "pending",
      sourceClass: "fixture",
      sensitivity: "internal",
      audience: ["workspace:synthetic"],
      proposedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-08T00:00:00.000Z",
    },
  ],
};

const authorizer = (events: string[]): ProductModelQueryAuthorizer => ({
  authorize: (_context, operation) =>
    Effect.sync(() => {
      events.push(`authorize:${operation}`);
      return { allowed: true, reason: "Allowed.", policyVersion: "policy-1" };
    }),
});

const graphRepository = (events: string[]): ProductModelGraphRepository => ({
  resolveRevision: () =>
    Effect.sync(() => {
      events.push("revision");
      return 4;
    }),
  readRelations: () =>
    Effect.sync(() => {
      events.push("relations");
      return { relations: [], truncated: false };
    }),
  traverseHierarchy: () => Effect.die("not used"),
});

const detailRepository = (events: string[]): ProductModelDetailRepository => ({
  readDossier: () =>
    Effect.sync(() => {
      events.push("dossier");
      return dossier;
    }),
  readCoverage: () =>
    Effect.sync(() => {
      events.push("coverage");
      return {
        items: [
          {
            entityId,
            canonicalName: "Synthetic Feature",
            kind: "feature",
            flags: ["stale" as const, "weakly_evidenced" as const],
            claimCount: 0,
            referenceCount: 0,
            variantCount: 1,
            updatedRevision: 4,
          },
        ],
        truncated: false,
      };
    }),
  readEntityHistory: () =>
    Effect.sync(() => {
      events.push("history");
      return {
        events: [
          {
            id: "event-synthetic",
            revision: 3,
            type: "renamed" as const,
            validFrom: "2026-01-01T00:00:00.000Z",
            recordedAt: "2026-01-01T00:01:00.000Z",
          },
        ],
        truncated: false,
      };
    }),
});

describe("product-model detail queries", () => {
  it("denies dossier access before revision, detail, relation, or evidence-adjacent access", async () => {
    const resolveRevision = vi.fn();
    const readRelations = vi.fn();
    const readDossier = vi.fn();
    const readCoverage = vi.fn();
    const service = createProductModelDetailQueryService(
      {
        authorize: () =>
          Effect.succeed({
            allowed: false,
            reason: "Workspace denied.",
            policyVersion: "policy-1",
          }),
      },
      { resolveRevision, readRelations } as unknown as ProductModelGraphRepository,
      { readDossier, readCoverage } as unknown as ProductModelDetailRepository,
    );

    const result = await Effect.runPromise(
      Effect.either(service.getFeatureDossier(context, { entityId, at })),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left).toBeInstanceOf(ProductModelAccessDenied);
    expect(resolveRevision).not.toHaveBeenCalled();
    expect(readDossier).not.toHaveBeenCalled();
    expect(readRelations).not.toHaveBeenCalled();
    expect(readCoverage).not.toHaveBeenCalled();
  });

  it("returns an authorized metadata-only dossier in strict access order", async () => {
    const events: string[] = [];
    const service = createProductModelDetailQueryService(
      authorizer(events),
      graphRepository(events),
      detailRepository(events),
    );

    const result = await Effect.runPromise(service.getFeatureDossier(context, { entityId, at }));

    expect(events).toEqual(["authorize:get-dossier", "revision", "dossier", "relations"]);
    expect(result).toMatchObject({
      workspaceId,
      revision: 4,
      entity: { id: entityId, canonicalName: "Synthetic Feature" },
      proposals: [{ id: "proposal-synthetic", state: "pending" }],
    });
    expect(result.proposals[0]).not.toHaveProperty("payload");
    expect(result.proposals[0]).not.toHaveProperty("evidenceReferenceIds");
  });

  it("returns bounded coverage flags without a raw evidence inventory", async () => {
    const events: string[] = [];
    const service = createProductModelDetailQueryService(
      authorizer(events),
      graphRepository(events),
      detailRepository(events),
    );

    const result = await Effect.runPromise(
      service.getProductCoverage(context, {
        at,
        staleBefore: "2025-12-01T00:00:00.000Z",
        maximumItems: 20,
      }),
    );

    expect(events).toEqual(["authorize:get-coverage", "revision", "coverage"]);
    expect(result.items[0]).toMatchObject({ flags: ["stale", "weakly_evidenced"] });
    expect(result.items[0]).not.toHaveProperty("evidenceReferenceIds");
  });

  it("resolves the exact variant while leaving delivery stages on the existing projection path", async () => {
    const events: string[] = [];
    const service = createProductModelDetailQueryService(
      authorizer(events),
      graphRepository(events),
      detailRepository(events),
    );

    const result = await Effect.runPromise(
      service.getProductAvailability(context, {
        entityId,
        at,
        qualifiers: { environment: "test" },
      }),
    );

    expect(events).toEqual(["authorize:get-availability", "revision", "dossier"]);
    expect(result.resolvedVariant).toMatchObject({
      appliedVariantIds: ["variant-synthetic"],
      delta: { hostname: "synthetic.test" },
    });
    expect(result.availabilityClaims).toHaveLength(1);
    expect(result.availabilityReferences).toHaveLength(1);
    expect(result.deliveryStages).toEqual([]);
    expect(result.safeWarnings).toEqual([
      "Delivery and verification stages are supplied by the existing delivery-intelligence projection.",
    ]);
  });

  it("authorizes and proves entity visibility before returning privacy-safe history metadata", async () => {
    const events: string[] = [];
    const service = createProductModelDetailQueryService(
      authorizer(events),
      graphRepository(events),
      detailRepository(events),
    );

    const result = await Effect.runPromise(
      service.getEntityHistory(context, { entityId, at, maximumItems: 20 }),
    );

    expect(events).toEqual(["authorize:get-historical-graph", "revision", "dossier", "history"]);
    expect(result.events).toEqual([
      {
        id: "event-synthetic",
        revision: 3,
        type: "renamed",
        validFrom: "2026-01-01T00:00:00.000Z",
        recordedAt: "2026-01-01T00:01:00.000Z",
      },
    ]);
    expect(result.events[0]).not.toHaveProperty("actorId");
    expect(result.events[0]).not.toHaveProperty("details");
  });
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createProductDeliveryExplorationProjection } from "../src/modules/delivery-intelligence/index.ts";
import {
  type ProductFeatureDossier,
  type ProductModelDetailQueryService,
  type ProductModelRequestContext,
  parseProductEntityId,
} from "../src/modules/product-model/index.ts";

const workspaceId = "workspace-synthetic";
const entityId = Effect.runSync(parseProductEntityId("00000000-0000-4000-8000-000000000801"));
const at = "2026-08-13T00:00:00.000Z";
const context: ProductModelRequestContext = {
  organizationId: "organization-synthetic",
  workspaceId,
  actorId: "actor-synthetic",
  trustTier: "trusted",
  effectiveAudience: ["workspace:synthetic"],
  maximumSensitivity: "internal",
  modelEgress: "block",
  permittedCorpusScopes: ["product-model", "delivery"],
  requestId: "request-synthetic",
  surface: "product-studio",
};

const dossier: ProductFeatureDossier = {
  workspaceId,
  asOf: at,
  revision: 7,
  entity: {
    id: entityId,
    workspaceId,
    kind: "feature",
    canonicalName: "Synthetic Storage Migration",
    registration: "ratified",
    lifecycle: "available",
    sensitivity: "internal",
    audience: ["workspace:synthetic"],
    createdRevision: 1,
    updatedRevision: 7,
  },
  aliases: [
    {
      id: "alias-synthetic",
      entityId,
      value: "Storage transition",
      normalizedValue: "storage transition",
      kind: "alternate",
      createdRevision: 2,
    },
  ],
  variants: [],
  claims: [],
  externalReferences: [],
  proposals: [],
  relations: [],
  safeWarnings: [],
};

const details: ProductModelDetailQueryService = {
  getFeatureDossier: () => Effect.succeed(dossier),
  getProductCoverage: () => Effect.die("not used"),
  getProductAvailability: () => Effect.die("not used"),
  getEntityHistory: () => Effect.die("not used"),
};

const census = {
  version: 1 as const,
  boundary: {
    kind: "absolute" as const,
    fromInclusive: "2026-05-15T00:00:00.000Z",
    toExclusive: at,
  },
  timeZone: "UTC",
  examinedCandidateCount: 1,
  candidateCount: 1,
  deliveredCandidateCount: 1,
  excludedCandidateCount: 0,
  duplicateCandidateCount: 0,
  unmappedCandidateCount: 0,
  exclusions: {},
  unavailableSources: [],
  sourceCoverage: [
    { source: "github" as const, available: true, checkpointAt: at, candidateCount: 1 },
  ],
  pagination: { pageSize: 200, pagesRead: 1, exhausted: true, maximumCandidates: 2_000 },
  complete: true,
  replayChecksum: "sha256-synthetic",
};

describe("product delivery exploration", () => {
  it("projects matching delivery work while keeping deployed, verified, and accepted distinct", async () => {
    const projection = createProductDeliveryExplorationProjection({
      details,
      timeZone: "UTC",
      source: {
        source: "projection",
        selectors: ["objects", "relations", "observations", "period_census"],
        execute: () =>
          Effect.succeed({
            items: [
              {
                id: "delivery-synthetic",
                workspaceId,
                source: "github" as const,
                selector: "observations" as const,
                intent: "delivered" as const,
                title: "Synthetic Storage Migration deployed",
                summary: "Storage transition deployed to the synthetic environment.",
                citationUrl: "https://example.invalid/delivery/synthetic",
                sensitivity: "internal" as const,
                authority: 90,
                observedAt: at,
                subjectAliases: ["Synthetic Storage Migration"],
                lifecycleState: "done" as const,
                completionStage: "deployed" as const,
                dedupeKey: "synthetic-delivery",
              },
            ],
            conflicts: [],
            unavailableSources: [],
            complete: true,
            periodCensus: census,
          }),
      },
    });

    const result = await Effect.runPromise(
      projection.getProductDelivery(context, { entityId, at, lookbackDays: 90, maximumItems: 20 }),
    );

    expect(result.availability).toBe("available");
    expect(result.supportingWork).toHaveLength(1);
    expect(result.stages.find(({ stage }) => stage === "deployed")?.state).toBe("observed");
    expect(result.stages.find(({ stage }) => stage === "verified")?.state).toBe("not_observed");
    expect(result.stages.find(({ stage }) => stage === "accepted")?.state).toBe("not_observed");
    expect(result.safeWarnings.at(-1)).toContain(
      "deployment does not imply verification or acceptance",
    );
  });

  it("returns an explicit unavailable projection when the delivery census is absent", async () => {
    const projection = createProductDeliveryExplorationProjection({
      details,
      timeZone: "UTC",
      source: {
        source: "projection",
        selectors: [],
        execute: () =>
          Effect.succeed({
            items: [],
            conflicts: [],
            unavailableSources: ["jira"],
            complete: false,
          }),
      },
    });

    const result = await Effect.runPromise(
      projection.getProductDelivery(context, { entityId, at, lookbackDays: 90, maximumItems: 20 }),
    );

    expect(result.availability).toBe("unavailable");
    expect(result.supportingWork).toEqual([]);
    expect(result.stages.every(({ state }) => state === "not_observed")).toBe(true);
  });
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createProductDeliveryExplorationProjection } from "../src/modules/delivery-intelligence/index.ts";
import {
  type ProductCompletionContract,
  type ProductFeatureDossier,
  type ProductGraphEnvelope,
  type ProductModelDetailQueryService,
  type ProductModelQueryService,
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

const queries = (graph: ProductGraphEnvelope): ProductModelQueryService => ({
  getProductMap: () => Effect.succeed(graph),
  getProductGraphAtTime: () => Effect.die("not used"),
  getProductGraphAtRevision: () => Effect.die("not used"),
  getCapabilitySubgraph: () => Effect.die("not used"),
});

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
    {
      source: "github" as const,
      available: true,
      checkpointAt: "2026-08-13T05:30:00+05:30",
      candidateCount: 1,
    },
  ],
  pagination: {
    pageSize: 200,
    pagesRead: 1,
    exhausted: true,
    maximumCandidates: 2_000,
  },
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
                planning: {
                  externalKey: "SYN-801",
                  status: "Done",
                  hasDependency: false,
                  hasAcceptanceInformation: false,
                  currentSprint: {
                    id: "sprint-synthetic-current",
                    name: "Synthetic sprint",
                    state: "active" as const,
                  },
                  sprintClassifications: ["current_sprint" as const],
                },
                dedupeKey: "synthetic-delivery",
              },
              {
                id: "initiative-synthetic",
                workspaceId,
                source: "strategy" as const,
                selector: "objects" as const,
                intent: "goals" as const,
                title: "Synthetic Storage Migration Q3",
                summary: "Governed current-quarter initiative.",
                citationUrl: "https://example.invalid/strategy/synthetic",
                sensitivity: "internal" as const,
                authority: 90,
                observedAt: at,
                subjectAliases: ["Synthetic Storage Migration"],
                strategy: { kind: "initiative" as const, state: "active" },
                dedupeKey: "initiative-synthetic",
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
      projection.getProductDelivery(context, {
        entityId,
        at,
        lookbackDays: 90,
        maximumItems: 20,
      }),
    );

    expect(result.availability).toBe("available");
    expect(result.supportingWork).toHaveLength(1);
    expect(result.supportingWork[0]?.currentSprint).toBe(true);
    expect(result.supportingWork[0]?.quarterRelevant).toBe(true);
    expect(result.sourceCoverage[0]?.checkpointAt).toBe(at);
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
      projection.getProductDelivery(context, {
        entityId,
        at,
        lookbackDays: 90,
        maximumItems: 20,
      }),
    );

    expect(result.availability).toBe("unavailable");
    expect(result.supportingWork).toEqual([]);
    expect(result.stages.every(({ state }) => state === "not_observed")).toBe(true);
  });

  it("projects governed migration, compatibility, verification, and acceptance facets independently", async () => {
    const deliveryChangeId = "synthetic-storage-transition";
    const citationByFacet = {
      migrated_population: "https://example.invalid/evidence/migration",
      application_deployment: "https://example.invalid/evidence/deployment",
      hostname_compatibility: "https://example.invalid/evidence/compatibility",
      regression_verification: "https://example.invalid/evidence/verification",
      human_acceptance: "https://example.invalid/evidence/acceptance",
    } as const;
    const completionContract: ProductCompletionContract = {
      id: "synthetic-storage-transition-v1",
      deliveryChange: {
        id: deliveryChangeId,
        canonicalName: "Synthetic Storage Transition",
        aliases: [],
      },
      affectedEntityIds: [entityId],
      defaultScope: {
        description: "the synthetic environment",
        qualifiers: {},
      },
      criteria: Object.keys(citationByFacet).map((facet) => ({
        id: facet,
        title: facet.replaceAll("_", " "),
        facet: facet as keyof typeof citationByFacet,
        required: true,
      })),
      evidenceBindings: Object.entries(citationByFacet).map(([facet, citationUrl]) => ({
        source: "github" as const,
        reference: { kind: "citation_url" as const, value: citationUrl },
        subjectId: deliveryChangeId,
        assertionType: facet,
        criterionId: facet,
        relevance: "supports" as const,
        authority:
          facet === "human_acceptance" ? ("acceptance" as const) : ("runtime_behavior" as const),
      })),
    };
    const deliveryRelation = {
      id: "relation-synthetic-delivery",
      workspaceId,
      type: "affected_by" as const,
      source: { kind: "entity" as const, entityId },
      target: {
        kind: "external" as const,
        referenceKind: "delivery" as const,
        referenceId: deliveryChangeId,
      },
      registration: "ratified" as const,
      sourceClass: "synthetic",
      sensitivity: "internal" as const,
      audience: ["workspace:synthetic"],
      validFrom: at,
      createdRevision: 7,
    };
    const graph: ProductGraphEnvelope = {
      workspaceId,
      asOf: at,
      revision: 7,
      entities: [
        {
          entityId,
          kind: "feature",
          canonicalName: dossier.entity.canonicalName,
          registration: "ratified",
          lifecycle: "available",
          sensitivity: "internal",
          audience: ["workspace:synthetic"],
          revision: 7,
          depth: 3,
        },
      ],
      relations: [deliveryRelation],
      page: { maximumDepth: 4, maximumNodes: 250, truncated: false },
      relationPage: { maximumRelations: 250, truncated: false },
      safeWarnings: [],
    };
    const governedDossier = { ...dossier, relations: [deliveryRelation] };
    const governedDetails: ProductModelDetailQueryService = {
      ...details,
      getFeatureDossier: () => Effect.succeed(governedDossier),
    };
    const items = Object.entries(citationByFacet).map(([facet, citationUrl]) => ({
      id: `evidence-${facet}`,
      workspaceId,
      source: "github" as const,
      selector: "observations" as const,
      intent: "delivered" as const,
      title: `Synthetic ${facet}`,
      summary: "Governed synthetic completion evidence.",
      citationUrl,
      sensitivity: "internal" as const,
      authority: 90,
      observedAt: at,
      subjectAliases: [dossier.entity.canonicalName],
      lifecycleState: "done" as const,
      dedupeKey: `synthetic-${facet}`,
    }));
    const projection = createProductDeliveryExplorationProjection({
      details: governedDetails,
      queries: queries(graph),
      completionContracts: [completionContract],
      timeZone: "UTC",
      source: {
        source: "projection",
        selectors: ["observations", "period_census"],
        execute: () =>
          Effect.succeed({
            items,
            conflicts: [],
            unavailableSources: [],
            complete: true,
            periodCensus: {
              ...census,
              examinedCandidateCount: items.length,
              candidateCount: items.length,
            },
          }),
      },
    });

    const result = await Effect.runPromise(
      projection.getProductDelivery(context, {
        entityId,
        at,
        lookbackDays: 90,
        maximumItems: 20,
      }),
    );

    for (const stage of ["migrated", "deployed", "compatible", "verified", "accepted"] as const)
      expect(result.stages.find((candidate) => candidate.stage === stage)?.state).toBe("observed");
  });
});

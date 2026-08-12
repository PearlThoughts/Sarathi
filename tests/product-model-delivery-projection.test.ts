import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { RepositoryError } from "../src/domain/errors.ts";
import {
  buildPeriodDeliveryReport,
  type CapabilityLedger,
  createProductCapabilityLedgerProjection,
  createRegistryBackedDeliveryAssistant,
  type DeliveryAssistantRequest,
  type DeliveryQuerySource,
} from "../src/modules/delivery-intelligence/index.ts";
import {
  type ProductCompletionContract,
  type ProductFeatureDossier,
  type ProductGraphEnvelope,
  type ProductModelDetailQueryService,
  type ProductModelQueryService,
  type ProductModelRequestContext,
  parseProductEntityId,
} from "../src/modules/product-model/index.ts";

const at = "2026-01-02T00:00:00.000Z";
const workspaceId = "workspace-synthetic";
const actorId = "actor-synthetic";
const entityId = Effect.runSync(parseProductEntityId("00000000-0000-4000-8000-000000000101"));
const candidateId = Effect.runSync(parseProductEntityId("00000000-0000-4000-8000-000000000102"));
const retiredId = Effect.runSync(parseProductEntityId("00000000-0000-4000-8000-000000000103"));

const request: DeliveryAssistantRequest = {
  workspaceId,
  actorId,
  audienceIds: ["workspace:synthetic"],
  maximumSensitivity: "internal",
  financeAccess: false,
  requestedAt: at,
  timeZone: "UTC",
  question: "Give me the leadership delivery report.",
  responseProduct: "leadership_report",
};

const context: ProductModelRequestContext = {
  organizationId: "organization-synthetic",
  workspaceId,
  actorId,
  trustTier: "trusted",
  effectiveAudience: ["workspace:synthetic"],
  maximumSensitivity: "internal",
  modelEgress: "block",
  permittedCorpusScopes: ["product-model"],
  requestId: "request-synthetic",
  surface: "internal",
};

const node = (
  id: typeof entityId,
  registration: "candidate" | "ratified",
  lifecycle: "available" | "retired",
) => ({
  entityId: id,
  kind: "capability" as const,
  canonicalName: `Capability ${id.slice(-3)}`,
  registration,
  lifecycle,
  sensitivity: "internal" as const,
  audience: ["workspace:synthetic"],
  revision: 4,
  depth: 2,
});

const graph: ProductGraphEnvelope = {
  workspaceId,
  asOf: at,
  revision: 4,
  entities: [
    node(entityId, "ratified", "available"),
    node(candidateId, "candidate", "available"),
    node(retiredId, "ratified", "retired"),
  ],
  relations: [],
  page: { maximumDepth: 4, maximumNodes: 250, truncated: false },
  relationPage: { maximumRelations: 250, truncated: false },
  safeWarnings: [],
};

const dossier: ProductFeatureDossier = {
  workspaceId,
  asOf: at,
  revision: 4,
  entity: {
    id: entityId,
    workspaceId,
    kind: "capability",
    canonicalName: "Registry Capability",
    registration: "ratified",
    lifecycle: "available",
    sensitivity: "internal",
    audience: ["workspace:synthetic"],
    createdRevision: 1,
    updatedRevision: 4,
  },
  aliases: [
    {
      id: "alias-synthetic",
      entityId,
      value: "Registry shorthand",
      normalizedValue: "registry shorthand",
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

const queryService = (getProductMap: ProductModelQueryService["getProductMap"]) =>
  ({
    getProductMap,
    getProductGraphAtTime: () => Effect.die("not used"),
    getCapabilitySubgraph: () => Effect.die("not used"),
  }) satisfies ProductModelQueryService;

const detailService = (getFeatureDossier: ProductModelDetailQueryService["getFeatureDossier"]) =>
  ({
    getFeatureDossier,
    getProductCoverage: () => Effect.die("not used"),
    getProductAvailability: () => Effect.die("not used"),
  }) satisfies ProductModelDetailQueryService;

const legacyLedger: CapabilityLedger = {
  version: 1,
  capabilities: [
    {
      key: "legacy-capability",
      title: "Legacy capability",
      aliases: [{ value: "legacy signal", source: "jira" }],
      alignment: "governed_initiative",
    },
    {
      key: "legacy-unmapped",
      title: "Unmapped compatibility capability",
      aliases: [{ value: "unmapped signal" }],
    },
  ],
};

describe("product-model delivery compatibility projection", () => {
  it("projects only ratified visible registry identity and migrates explicit legacy aliases additively", async () => {
    const events: string[] = [];
    const projection = createProductCapabilityLedgerProjection({
      queries: queryService(() =>
        Effect.sync(() => {
          events.push("map");
          return graph;
        }),
      ),
      details: detailService((_context, query) =>
        Effect.sync(() => {
          events.push(`dossier:${query.entityId}`);
          return dossier;
        }),
      ),
      contextFor: () => context,
      legacyLedger,
      compatibilityMappings: [
        {
          legacyKey: "legacy-capability",
          entityId,
          additionalAliases: [{ value: "corrected signal", source: "jira" }],
        },
      ],
    });

    const ledger = await Effect.runPromise(projection.project(request));

    expect(events).toEqual(["map", `dossier:${entityId}`]);
    expect(ledger.capabilities).toHaveLength(2);
    expect(ledger.capabilities[0]).toMatchObject({
      key: entityId,
      title: "Registry Capability",
      alignment: "governed_initiative",
    });
    expect(ledger.capabilities[0]?.aliases).toEqual(
      expect.arrayContaining([
        { value: "Registry Capability" },
        { value: "Registry shorthand" },
        { value: "legacy-capability" },
        { value: "legacy signal", source: "jira" },
        { value: "corrected signal", source: "jira" },
      ]),
    );
    expect(ledger.capabilities[1]?.key).toBe("legacy-unmapped");
  });

  it("implicitly preserves legacy aliases when a legacy key already is the stable registry id", async () => {
    const projection = createProductCapabilityLedgerProjection({
      queries: queryService(() => Effect.succeed(graph)),
      details: detailService(() => Effect.succeed(dossier)),
      contextFor: () => context,
      legacyLedger: {
        version: 1,
        capabilities: [
          {
            key: entityId,
            title: "Prior display title",
            aliases: [{ value: "prior alias" }],
          },
        ],
      },
    });

    const ledger = await Effect.runPromise(projection.project(request));

    expect(ledger.capabilities).toHaveLength(1);
    expect(ledger.capabilities[0]?.aliases).toEqual(
      expect.arrayContaining([
        { value: entityId },
        { value: "Prior display title" },
        { value: "prior alias" },
      ]),
    );
  });

  it("keeps report population and citations stable while replacing a legacy key with registry identity", async () => {
    const projection = createProductCapabilityLedgerProjection({
      queries: queryService(() => Effect.succeed(graph)),
      details: detailService(() => Effect.succeed(dossier)),
      contextFor: () => context,
      legacyLedger,
      compatibilityMappings: [{ legacyKey: "legacy-capability", entityId }],
    });
    const projectedLedger = await Effect.runPromise(projection.project(request));
    const census = {
      version: 1 as const,
      boundary: {
        kind: "absolute" as const,
        fromInclusive: "2026-01-01T00:00:00.000Z",
        toExclusive: "2026-01-08T00:00:00.000Z",
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
      sourceCoverage: [],
      pagination: {
        pageSize: 100,
        pagesRead: 1,
        exhausted: true,
        maximumCandidates: 100,
      },
      complete: true,
      replayChecksum: "sha256-synthetic",
    };
    const items = [
      {
        title: "Legacy signal delivered",
        summary: "The legacy signal was deployed.",
        citationUrl: "https://example.com/delivery/synthetic",
        source: "jira" as const,
        selector: "objects",
        intent: "delivered",
        dedupeKey: "delivery-synthetic",
        observedAt: at,
        completionStage: "deployed" as const,
      },
    ];
    const legacyReport = buildPeriodDeliveryReport({
      census,
      items,
      capabilityLedger: {
        version: 1,
        capabilities: legacyLedger.capabilities.filter(({ key }) => key === "legacy-capability"),
      },
    });
    const projectedReport = buildPeriodDeliveryReport({
      census,
      items,
      capabilityLedger: projectedLedger,
    });

    expect(projectedReport.capsules.map(({ id }) => id)).toEqual(
      legacyReport.capsules.map(({ id }) => id),
    );
    expect(projectedReport.capsules[0]?.citations).toEqual(legacyReport.capsules[0]?.citations);
    expect(projectedReport.unmappedCapsules).toEqual([]);
    expect(projectedReport.capsules[0]?.capabilityKeys).toEqual([entityId]);
  });

  it("rejects widened request context before graph or dossier access", async () => {
    const getProductMap = vi.fn(() => Effect.succeed(graph));
    const getFeatureDossier = vi.fn(() => Effect.succeed(dossier));
    const projection = createProductCapabilityLedgerProjection({
      queries: queryService(getProductMap),
      details: detailService(getFeatureDossier),
      contextFor: () => ({
        ...context,
        effectiveAudience: [...context.effectiveAudience, "audience:not-requested"],
      }),
    });

    const result = await Effect.runPromise(Effect.either(projection.project(request)));

    expect(result._tag).toBe("Left");
    expect(getProductMap).not.toHaveBeenCalled();
    expect(getFeatureDossier).not.toHaveBeenCalled();
  });

  it("rejects truncated maps before dossier expansion", async () => {
    const getFeatureDossier = vi.fn(() => Effect.succeed(dossier));
    const projection = createProductCapabilityLedgerProjection({
      queries: queryService(() =>
        Effect.succeed({ ...graph, page: { ...graph.page, truncated: true } }),
      ),
      details: detailService(getFeatureDossier),
      contextFor: () => context,
    });

    const result = await Effect.runPromise(Effect.either(projection.project(request)));

    expect(result._tag).toBe("Left");
    expect(getFeatureDossier).not.toHaveBeenCalled();
  });

  it("fails closed before delivery sources or composition when registry projection fails", async () => {
    const execute = vi.fn<DeliveryQuerySource["execute"]>(() =>
      Effect.die("delivery source must not run"),
    );
    const compose = vi.fn(() => Effect.die("composer must not run"));
    const assistant = createRegistryBackedDeliveryAssistant(
      {
        sources: [{ source: "projection", selectors: ["objects"], execute }],
        answerComposer: { compose },
      },
      {
        project: () =>
          Effect.fail(
            new RepositoryError({
              message: "Projection unavailable.",
              operation: "delivery-capability-ledger-projection",
            }),
          ),
      },
    );

    const result = await Effect.runPromise(Effect.either(assistant.answer(request)));

    expect(result._tag).toBe("Left");
    expect(execute).not.toHaveBeenCalled();
    expect(compose).not.toHaveBeenCalled();
  });

  it("resolves named operational completion through ratified registry identity before retrieval", async () => {
    const relationGraph: ProductGraphEnvelope = {
      ...graph,
      relations: [
        {
          id: "relation-delivery-change",
          workspaceId,
          type: "affected_by",
          source: { kind: "entity", entityId },
          target: {
            kind: "external",
            referenceKind: "delivery",
            referenceId: "object-storage-change",
          },
          registration: "ratified",
          sourceClass: "synthetic",
          sensitivity: "internal",
          audience: ["workspace:synthetic"],
          validFrom: at,
          createdRevision: 4,
        },
      ],
    };
    const completionContract: ProductCompletionContract = {
      id: "object-storage-change-v1",
      deliveryChange: {
        id: "object-storage-change",
        canonicalName: "Object Storage Migration",
        aliases: [{ value: "Object Store Migration", authority: "ratified_alias" }],
      },
      affectedEntityIds: [entityId],
      defaultScope: { description: "the governed environment", qualifiers: {} },
      criteria: [
        {
          id: "deployment",
          title: "Application deployment",
          facet: "application_deployment",
          required: true,
          acceptableAuthorities: ["deployment"],
        },
      ],
      evidenceBindings: [
        {
          source: "github",
          reference: { kind: "citation_url", value: "https://example.com/change" },
          subjectId: "object-storage-change",
          assertionType: "deployed-change",
          criterionId: "deployment",
          relevance: "supports",
          authority: "deployment",
        },
      ],
    };
    const sourceExecute = vi.fn<DeliveryQuerySource["execute"]>(() =>
      Effect.succeed({
        items: [
          {
            id: "deployed-change",
            workspaceId,
            source: "github",
            selector: "observations",
            intent: "delivered",
            title: "Object Store Migration deployed",
            summary: "The governed change is deployed.",
            citationUrl: "https://example.com/change",
            sensitivity: "internal",
            authority: 0.9,
            observedAt: at,
            subjectAliases: ["Object Store Migration"],
            dedupeKey: "deployed-change",
          },
          {
            id: "status-change",
            workspaceId,
            source: "github",
            selector: "observations",
            intent: "status",
            title: "Object Store Migration deployed",
            summary: "The governed change is deployed.",
            citationUrl: "https://example.com/change",
            sensitivity: "internal",
            authority: 0.9,
            observedAt: at,
            subjectAliases: ["Object Store Migration"],
            dedupeKey: "status-change",
          },
        ],
        conflicts: [],
        unavailableSources: [],
        complete: true,
      }),
    );
    const compose = vi.fn(({ completionAssessment, items }) =>
      Effect.succeed({
        text: [
          "## Completion",
          `- Yes: ${completionAssessment?.requestedScope?.description}.`,
          ...(completionAssessment !== undefined &&
          "affectedEntities" in completionAssessment.subject
            ? completionAssessment.subject.affectedEntities.map(
                ({ canonicalName }: { readonly canonicalName: string }) =>
                  `- ${canonicalName} is in scope.`,
              )
            : []),
          "- Application deployment: satisfied.",
          "### References",
          `- [GitHub](${items[0]?.citationUrl})`,
        ].join("\n"),
        citations: [{ label: "GitHub", url: items[0]?.citationUrl ?? "" }],
      }),
    );
    const projection = createProductCapabilityLedgerProjection({
      queries: queryService(() => Effect.succeed(relationGraph)),
      details: detailService(() => Effect.succeed(dossier)),
      contextFor: () => ({
        ...context,
        actorId: "product-owner-synthetic",
        effectiveAudience: ["product-review-synthetic"],
      }),
      completionContracts: [completionContract],
      authorizeContextDelegation: (assistantRequest, productContext) =>
        assistantRequest.actorId === actorId &&
        productContext.actorId === "product-owner-synthetic" &&
        productContext.effectiveAudience.includes("product-review-synthetic"),
    });
    const assistant = createRegistryBackedDeliveryAssistant(
      {
        sources: [{ source: "github", selectors: ["observations"], execute: sourceExecute }],
        answerComposer: { compose },
      },
      projection,
    );

    const answer = await Effect.runPromise(
      assistant.answer({
        ...request,
        question: "Is Object Store Migration fully done?",
        responseProduct: "operational_answer",
      }),
    );

    expect(sourceExecute).toHaveBeenCalledOnce();
    expect(compose).toHaveBeenCalledOnce();
    expect(answer.completionAssessment).toMatchObject({
      disposition: "complete",
      subject: { deliveryChangeId: "object-storage-change", matchedBy: "ratified_alias" },
      criteria: [{ id: "deployment", disposition: "satisfied" }],
    });
    expect(answer.acceptance.semanticCompletionPassed).toBe(true);
  });

  it("does not access the registry for non-report delivery questions", async () => {
    const project = vi.fn(() => Effect.succeed(legacyLedger));
    const assistant = createRegistryBackedDeliveryAssistant({ sources: [] }, { project });

    await Effect.runPromise(
      assistant.answer({
        ...request,
        question: "What is the current status?",
        responseProduct: "operational_answer",
      }),
    );

    expect(project).not.toHaveBeenCalled();
  });
});

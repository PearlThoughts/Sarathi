import { describe, expect, it } from "vitest";
import {
  type DeliveryQueryResult,
  type DeliveryResultItem,
  reconcileProductCompletion,
} from "../src/modules/delivery-intelligence/index.ts";
import {
  type ProductCompletionContract,
  type ProductEntityId,
  parseProductCompletionContracts,
  resolveProductCompletionContract,
} from "../src/modules/product-model/index.ts";

const entityId = "00000000-0000-4000-8000-000000000111" as ProductEntityId;
const requestedAt = "2026-08-12T00:00:00.000Z";

const rawContract = {
  id: "object-storage-change-v1",
  deliveryChange: {
    id: "object-storage-change",
    canonicalName: "Object Storage Migration",
    aliases: [
      { value: "A1 to B2 migration", authority: "ratified_alias" },
      { value: "object-store change", authority: "external_mapping" },
    ],
  },
  affectedEntityIds: [entityId],
  defaultScope: { description: "all governed environments", qualifiers: {} },
  separateDeliveryChangeIds: ["legacy-retirement"],
  criteria: [
    {
      id: "deployment",
      title: "Application deployment",
      facet: "application_deployment",
      required: true,
      acceptableAuthorities: ["deployment", "runtime_behavior"],
    },
    {
      id: "retirement",
      title: "Legacy retirement",
      facet: "legacy_retirement",
      required: true,
      acceptableAuthorities: ["scope_authority", "runtime_behavior"],
    },
  ],
  evidenceBindings: [
    {
      source: "github",
      reference: { kind: "citation_url", value: "https://example.test/change" },
      subjectId: "object-storage-change",
      assertionType: "merged-change",
      criterionId: "deployment",
      relevance: "mentions",
      authority: "implementation",
    },
    {
      source: "jira",
      reference: { kind: "external_key", value: "DEMO-2" },
      subjectId: "legacy-retirement",
      assertionType: "open-retirement",
      criterionId: "retirement",
      relevance: "contradicts",
      authority: "plan_commitment",
    },
    {
      source: "teams",
      reference: { kind: "source_id", value: "unrelated-asset" },
      subjectId: "third-party-asset",
      assertionType: "investigated-defect",
      relevance: "excluded",
      authority: "informal_claim",
      exclusionReason: "The asset is not attributable to the resolved migration boundary.",
    },
  ],
} as const;

const contracts = parseProductCompletionContracts([rawContract]);
const contract = contracts[0] as ProductCompletionContract;

const resolved = (phrase = "Object Storage Migration") =>
  resolveProductCompletionContract({
    phrase,
    requestedAt,
    contracts,
    visibleEntities: [
      {
        entityId,
        canonicalName: "Public Asset Delivery",
        registration: "ratified",
        lifecycle: "available",
      },
    ],
    ratifiedDeliveryRelations: [{ deliveryChangeId: "object-storage-change", entityId }],
  });

const item = (
  source: DeliveryResultItem["source"],
  id: string,
  citationUrl: string,
  externalKey?: string,
): DeliveryResultItem => ({
  id,
  workspaceId: "workspace-test",
  source,
  selector: "objects",
  intent: "status",
  title: id,
  summary: id,
  citationUrl,
  sensitivity: "internal",
  authority: 0.9,
  observedAt: requestedAt,
  dedupeKey: `${source}:${id}`,
  ...(externalKey === undefined
    ? {}
    : {
        planning: {
          externalKey,
          status: "Open",
          hasDependency: false,
          hasAcceptanceInformation: false,
        },
      }),
});

const result = (items: readonly DeliveryResultItem[]): DeliveryQueryResult => ({
  items,
  conflicts: [],
  unavailableSources: [],
  complete: true,
});

describe("named product completion", () => {
  it("resolves canonical identity, case and punctuation, ratified aliases, and external mappings", () => {
    expect(resolved(" object STORAGE migration!!! ")).toMatchObject({
      kind: "resolved",
      subject: { matchedBy: "canonical_identity" },
    });
    expect(resolved("A1 to B2 migration")).toMatchObject({
      kind: "resolved",
      subject: { matchedBy: "ratified_alias" },
    });
    expect(resolved("object-store change")).toMatchObject({
      kind: "resolved",
      subject: { matchedBy: "external_mapping" },
    });
  });

  it("returns scope ambiguous for equal-priority duplicate mappings", () => {
    const duplicate = { ...contract, id: "duplicate-contract" };
    expect(
      resolveProductCompletionContract({
        phrase: "object-store change",
        requestedAt,
        contracts: [contract, duplicate],
        visibleEntities: [
          {
            entityId,
            canonicalName: "Public Asset Delivery",
            registration: "ratified",
            lifecycle: "available",
          },
        ],
        ratifiedDeliveryRelations: [{ deliveryChangeId: "object-storage-change", entityId }],
      }),
    ).toMatchObject({
      kind: "scope_ambiguous",
      candidateContractIds: ["duplicate-contract", "object-storage-change-v1"],
    });
  });

  it("keeps merged implementation below deployment, detects open retirement, and excludes unrelated defects", () => {
    const reconciliation = reconcileProductCompletion({
      resolution: resolved(),
      requestedAt,
      result: result([
        item("github", "merged", "https://example.test/change"),
        item("jira", "retirement", "https://example.test/retirement", "DEMO-2"),
        item("teams", "unrelated-asset", "https://example.test/unrelated"),
      ]),
    });

    expect(reconciliation.assessment).toMatchObject({
      disposition: "incomplete",
      criteria: [
        { id: "deployment", disposition: "unknown" },
        { id: "retirement", disposition: "contradicted" },
      ],
      excludedObservations: [
        expect.objectContaining({ reason: expect.stringContaining("not attributable") }),
      ],
    });
    expect(reconciliation.assessment.conflicts).toEqual([
      expect.objectContaining({ id: "separate-delivery-change-state" }),
    ]);
    expect(reconciliation.selectedItems.map(({ id }) => id)).toEqual(["merged", "retirement"]);
  });

  it("uses not established for missing required evidence and complete only when all criteria satisfy", () => {
    expect(
      reconcileProductCompletion({ resolution: resolved(), requestedAt, result: result([]) })
        .assessment.disposition,
    ).toBe("not_established");

    const satisfiedContract: ProductCompletionContract = {
      ...contract,
      evidenceBindings: contract.evidenceBindings.map((binding) =>
        binding.relevance === "excluded"
          ? binding
          : {
              ...binding,
              relevance: "supports" as const,
              authority:
                binding.criterionId === "deployment"
                  ? ("deployment" as const)
                  : ("scope_authority" as const),
            },
      ),
    };
    const resolution = resolveProductCompletionContract({
      phrase: "Object Storage Migration",
      requestedAt,
      contracts: [satisfiedContract],
      visibleEntities: [
        {
          entityId,
          canonicalName: "Public Asset Delivery",
          registration: "ratified",
          lifecycle: "available",
        },
      ],
      ratifiedDeliveryRelations: [{ deliveryChangeId: "object-storage-change", entityId }],
    });
    expect(
      reconcileProductCompletion({
        resolution,
        requestedAt,
        result: result([
          item("github", "deployed", "https://example.test/change"),
          item("jira", "retired", "https://example.test/retirement", "DEMO-2"),
        ]),
      }).assessment.disposition,
    ).toBe("complete");
  });
});

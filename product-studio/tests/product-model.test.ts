import { describe, expect, it } from "vitest";
import {
  productDossierSchema,
  productExplorerProjection,
  productExplorerSearch,
  productMapMatching,
  productMapRows,
  productMapSchema,
} from "../src/domain/product-model";

const rootId = "00000000-0000-4000-8000-000000000301";
const childId = "00000000-0000-4000-8000-000000000302";
const areaId = "00000000-0000-4000-8000-000000000303";
const capabilityId = "00000000-0000-4000-8000-000000000304";
const relatedAreaId = "00000000-0000-4000-8000-000000000305";
const relatedCapabilityId = "00000000-0000-4000-8000-000000000306";

const node = (entityId: string, canonicalName: string, parentId?: string) => ({
  entityId,
  ...(parentId === undefined ? {} : { parentId }),
  kind: parentId === undefined ? ("product" as const) : ("feature" as const),
  canonicalName,
  registration: "ratified" as const,
  lifecycle: "available" as const,
  sensitivity: "internal" as const,
  audience: ["workspace:synthetic"],
  revision: 4,
  depth: parentId === undefined ? 0 : 1,
});

const map = {
  workspaceId: "workspace-synthetic",
  asOf: "2026-01-02T00:00:00.000Z",
  revision: 4,
  entities: [node(childId, "Child", rootId), node(rootId, "Root")],
  relations: [],
  page: { maximumDepth: 4, maximumNodes: 250, truncated: false },
  relationPage: { maximumRelations: 250, truncated: false },
  safeWarnings: [],
};

const hierarchyNode = (
  entityId: string,
  canonicalName: string,
  kind: "product" | "area" | "capability" | "feature",
  depth: number,
  parentId?: string,
) => ({
  entityId,
  ...(parentId === undefined ? {} : { parentId }),
  kind,
  canonicalName,
  description: `${canonicalName} definition`,
  registration: "ratified" as const,
  lifecycle: "available" as const,
  sensitivity: "internal" as const,
  audience: ["workspace:synthetic"],
  revision: 4,
  depth,
});

const explorerMap = productMapSchema.parse({
  ...map,
  entities: [
    hierarchyNode(rootId, "Synthetic Product", "product", 0),
    hierarchyNode(areaId, "Experience", "area", 1, rootId),
    hierarchyNode(capabilityId, "Composition", "capability", 2, areaId),
    hierarchyNode(relatedAreaId, "Insights", "area", 1, rootId),
    hierarchyNode(relatedCapabilityId, "Measurement", "capability", 2, relatedAreaId),
  ],
  relations: [
    {
      id: "relation-synthetic",
      workspaceId: "workspace-synthetic",
      type: "informs",
      source: { kind: "entity", entityId: capabilityId },
      target: { kind: "entity", entityId: relatedCapabilityId },
      registration: "ratified",
      sourceClass: "fixture",
      sensitivity: "internal",
      audience: ["workspace:synthetic"],
      validFrom: "2026-01-01T00:00:00.000Z",
      createdRevision: 4,
    },
  ],
});

describe("Product Studio product-model contract", () => {
  it("parses the bounded Sarathi map envelope and derives a stable reading path", () => {
    const parsed = productMapSchema.parse(map);

    expect(productMapRows(parsed)).toEqual([
      expect.objectContaining({ entityId: rootId, path: ["Root"] }),
      expect.objectContaining({ entityId: childId, path: ["Root", "Child"] }),
    ]);
  });

  it("marks invalid cycles instead of recursively expanding them", () => {
    const parsed = productMapSchema.parse({
      ...map,
      entities: [node(rootId, "Root", childId), node(childId, "Child", rootId)],
    });

    expect(productMapRows(parsed).every(({ path }) => path[0] === "Invalid hierarchy")).toBe(true);
  });

  it("rejects unexpected map fields instead of rendering an expanded API payload", () => {
    expect(() => productMapSchema.parse({ ...map, evidenceBodies: ["must not render"] })).toThrow();
  });

  it("filters authorized metadata while retaining hierarchy context", () => {
    const parsed = productMapSchema.parse(map);

    expect(productMapMatching(parsed, "child").entities.map(({ entityId }) => entityId)).toEqual([
      childId,
      rootId,
    ]);
    expect(productMapMatching(parsed, "root").entities).toHaveLength(2);
    expect(productMapMatching(parsed, "unavailable term").entities).toEqual([]);
  });

  it("projects one semantic drill level with ancestors and related entities", () => {
    const projection = productExplorerProjection(explorerMap, { focusEntityId: areaId });

    expect(projection.focus?.entityId).toBe(areaId);
    expect(projection.ancestors.map(({ entityId }) => entityId)).toEqual([rootId]);
    expect(projection.children.map(({ entityId }) => entityId)).toEqual([capabilityId]);
    expect(projection.relatedEntities).toEqual([
      expect.objectContaining({ entityId: relatedCapabilityId, label: "Measurement" }),
    ]);
    expect(projection.relations.map(({ id }) => id)).toEqual(["relation-synthetic"]);
  });

  it("supports relationship visibility and exact type filtering", () => {
    expect(
      productExplorerProjection(explorerMap, {
        focusEntityId: areaId,
        includeRelations: false,
      }).relations,
    ).toEqual([]);
    expect(
      productExplorerProjection(explorerMap, {
        focusEntityId: areaId,
        relationType: "unrelated",
      }).relatedEntities,
    ).toEqual([]);
  });

  it("searches authorized names and definitions for instant constellation jumps", () => {
    expect(productExplorerSearch(explorerMap, "measure").map(({ entityId }) => entityId)).toEqual([
      relatedCapabilityId,
    ]);
    expect(productExplorerSearch(explorerMap, "definition", 2)).toHaveLength(2);
    expect(productExplorerSearch(explorerMap, "   ")).toEqual([]);
  });

  it("rejects evidence bodies attached to dossier claim summaries", () => {
    expect(() =>
      productDossierSchema.parse({
        workspaceId: "workspace-synthetic",
        asOf: "2026-01-02T00:00:00.000Z",
        revision: 4,
        entity: {
          id: childId,
          workspaceId: "workspace-synthetic",
          kind: "feature",
          canonicalName: "Child",
          registration: "ratified",
          lifecycle: "available",
          sensitivity: "internal",
          audience: ["workspace:synthetic"],
          createdRevision: 1,
          updatedRevision: 4,
        },
        aliases: [],
        variants: [],
        claims: [
          {
            id: "claim-synthetic",
            entityId: childId,
            type: "definition",
            predicate: "means",
            value: "Synthetic meaning",
            evidenceReferenceCount: 1,
            registration: "ratified",
            sourceClass: "fixture",
            sensitivity: "internal",
            audience: ["workspace:synthetic"],
            validFrom: "2026-01-01T00:00:00.000Z",
            createdRevision: 4,
            evidenceBody: "must not render",
          },
        ],
        externalReferences: [],
        proposals: [],
        relations: [],
        safeWarnings: [],
      }),
    ).toThrow();
  });
});

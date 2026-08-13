import { describe, expect, it } from "vitest";
import {
  createProductLensCatalog,
  findProductRelationPath,
  type ProductExplorationState,
  productExplorationFromUrl,
  productExplorationUrl,
  productLensIds,
  reduceProductExploration,
} from "../src/domain/product-exploration";
import {
  productDeliverySchema,
  productExplorerSearch,
  productMapSchema,
  productRelationCatalogSchema,
} from "../src/domain/product-model";

const first = "00000000-0000-4000-8000-000000000101";
const second = "00000000-0000-4000-8000-000000000102";
const third = "00000000-0000-4000-8000-000000000103";
const base: ProductExplorationState = {
  focusId: first,
  selectedEntityId: first,
  compareIds: [],
  lens: "constellation",
  view: "graph",
  query: "",
  dossierOpen: false,
};

describe("Product Studio exploration state", () => {
  it("keeps selection separate from explicit exploration and bounds comparison to two", () => {
    const selected = reduceProductExploration(base, { type: "select-entity", entityId: second });
    expect(selected.focusId).toBe(first);
    expect(selected.selectedEntityId).toBe(second);

    const explored = reduceProductExploration(selected, { type: "explore", entityId: second });
    expect(explored.focusId).toBe(second);

    const compared = [first, second, third].reduce(
      (state, entityId) =>
        reduceProductExploration(state, { type: "select-entity", entityId, compare: true }),
      base,
    );
    expect(compared.compareIds).toEqual([second, third]);
  });

  it("round-trips deep-link focus, selection, edge, lens, view, revision, and dossier state", () => {
    const state: ProductExplorationState = {
      focusId: first,
      selectedRelationId: "relation-synthetic",
      compareIds: [second, third],
      lens: "history",
      view: "revision-diff",
      revision: 7,
      query: "storage",
      relationType: "depends_on",
      dossierOpen: true,
    };
    const path = productExplorationUrl(state);
    const restored = productExplorationFromUrl(new URL(path, "https://studio.example.test"));
    expect(restored).toEqual(state);
  });

  it("declares all eleven reusable lenses and keeps customer journey empty without governed flow", () => {
    const relations = productRelationCatalogSchema.parse({
      workspaceId: "workspace-synthetic",
      relations: [
        {
          type: "depends_on",
          label: "depends on",
          reverseLabel: "is depended on by",
          family: "product",
          definition: "The source requires the target.",
          directional: true,
          lenses: ["relationships", "dependencies"],
        },
      ],
    });
    const lenses = createProductLensCatalog(relations);

    expect(lenses.map(({ id }) => id)).toEqual(productLensIds);
    expect(lenses.find(({ id }) => id === "dependencies")?.relationTypes).toEqual(["depends_on"]);
    expect(lenses.find(({ id }) => id === "customer-journey")?.relationTypes).toEqual([]);
  });

  it("finds only directed typed bounded paths", () => {
    const node = (entityId: string) => ({
      entityId,
      kind: "feature" as const,
      canonicalName: entityId,
      registration: "ratified" as const,
      lifecycle: "available" as const,
      sensitivity: "internal" as const,
      audience: ["workspace:synthetic"],
      revision: 4,
      depth: 0,
    });
    const relation = (id: string, source: string, target: string, type: string) => ({
      id,
      workspaceId: "workspace-synthetic",
      type,
      source: { kind: "entity" as const, entityId: source },
      target: { kind: "entity" as const, entityId: target },
      registration: "ratified" as const,
      sourceClass: "fixture",
      sensitivity: "internal" as const,
      audience: ["workspace:synthetic"],
      validFrom: "2026-01-01T00:00:00.000Z",
      createdRevision: 4,
    });
    const map = productMapSchema.parse({
      workspaceId: "workspace-synthetic",
      asOf: "2026-01-02T00:00:00.000Z",
      revision: 4,
      entities: [node(first), node(second), node(third)],
      relations: [
        relation("r1", first, second, "depends_on"),
        relation("r2", second, third, "depends_on"),
        relation("r3", first, third, "observed_by"),
      ],
      page: { maximumDepth: 4, maximumNodes: 100, truncated: false },
      relationPage: { maximumRelations: 100, truncated: false },
      safeWarnings: [],
    });

    expect(findProductRelationPath(map, first, third, ["depends_on"], 2)).toEqual(["r1", "r2"]);
    expect(findProductRelationPath(map, third, first, ["depends_on"], 2)).toEqual([]);
    expect(findProductRelationPath(map, first, third, ["depends_on"], 1)).toEqual([]);
  });

  it("preserves quarter relevance and every distinct completion stage in the studio contract", () => {
    const delivery = productDeliverySchema.parse({
      workspaceId: "workspace-synthetic",
      entityId: first,
      asOf: "2026-08-13T00:00:00.000Z",
      availability: "available",
      stages: ["migrated", "deployed", "compatible", "verified", "accepted"].map((stage) => ({
        stage,
        state: "observed",
        supportingWorkCount: 1,
      })),
      supportingWork: [
        {
          title: "Synthetic transition",
          summary: "Governed synthetic delivery evidence.",
          latestActivityAt: "2026-08-13T00:00:00.000Z",
          lifecycle: "production",
          blocked: false,
          currentSprint: true,
          recentlyCompletedSprint: false,
          quarterRelevant: true,
          sources: ["github"],
          citations: [{ source: "github", url: "https://example.invalid/synthetic" }],
        },
      ],
      sourceCoverage: [],
      truncated: false,
      safeWarnings: [],
    });

    expect(delivery.supportingWork[0]?.quarterRelevant).toBe(true);
    expect(delivery.stages.map(({ stage }) => stage)).toEqual([
      "migrated",
      "deployed",
      "compatible",
      "verified",
      "accepted",
    ]);
  });

  it("searches three independent deep capability slices without promoting work-system distractors", () => {
    const root = "00000000-0000-4000-8000-000000000200";
    const node = (
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
      registration: "ratified" as const,
      lifecycle: "available" as const,
      sensitivity: "internal" as const,
      audience: ["workspace:synthetic"],
      revision: 4,
      depth,
    });
    const map = productMapSchema.parse({
      workspaceId: "workspace-synthetic",
      asOf: "2026-08-13T00:00:00.000Z",
      revision: 4,
      entities: [
        node(root, "Synthetic Product", "product", 0),
        node("00000000-0000-4000-8000-000000000201", "Storage Area", "area", 1, root),
        node(
          "00000000-0000-4000-8000-000000000202",
          "Storage Transition",
          "feature",
          2,
          "00000000-0000-4000-8000-000000000201",
        ),
        node("00000000-0000-4000-8000-000000000203", "Identity Area", "area", 1, root),
        node(
          "00000000-0000-4000-8000-000000000204",
          "Delegated Access",
          "capability",
          2,
          "00000000-0000-4000-8000-000000000203",
        ),
        node("00000000-0000-4000-8000-000000000205", "Assurance Area", "area", 1, root),
        node(
          "00000000-0000-4000-8000-000000000206",
          "Regression Verification",
          "feature",
          2,
          "00000000-0000-4000-8000-000000000205",
        ),
      ],
      relations: [
        {
          id: "relation-work-system-distractor",
          workspaceId: "workspace-synthetic",
          type: "realized_by",
          source: { kind: "entity", entityId: "00000000-0000-4000-8000-000000000202" },
          target: { kind: "external", referenceKind: "repository", referenceId: "synthetic-repo" },
          registration: "ratified",
          sourceClass: "synthetic",
          sensitivity: "internal",
          audience: ["workspace:synthetic"],
          validFrom: "2026-08-13T00:00:00.000Z",
          createdRevision: 4,
        },
      ],
      page: { maximumDepth: 4, maximumNodes: 250, truncated: false },
      relationPage: { maximumRelations: 250, truncated: false },
      safeWarnings: [],
    });

    expect(productExplorerSearch(map, "area")).toHaveLength(3);
    expect(productExplorerSearch(map, "storage transition")[0]?.depth).toBe(2);
    expect(map.entities.some(({ canonicalName }) => canonicalName.includes("repo"))).toBe(false);
  });
});

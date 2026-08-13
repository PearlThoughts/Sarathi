import type { ProductMap, ProductRelationCatalog } from "./product-model";

export const productLensIds = [
  "constellation",
  "hierarchy",
  "dependencies",
  "relationships",
  "customer-journey",
  "delivery",
  "realization",
  "variants",
  "assurance",
  "coverage",
  "history",
] as const;

export type ProductLensId = (typeof productLensIds)[number];
export type ProductViewId =
  | "graph"
  | "hierarchy"
  | "matrix"
  | "landscape"
  | "timeline"
  | "revision-diff"
  | "list";

export type ProductLensDefinition = {
  readonly id: ProductLensId;
  readonly label: string;
  readonly description: string;
  readonly direction: "outgoing" | "incoming" | "both" | "hierarchy";
  readonly maximumDepth: number;
  readonly relationFamilies: readonly string[];
  readonly relationTypes: readonly string[];
  readonly grouping: string;
  readonly encoding: string;
  readonly legend: readonly string[];
  readonly actions: readonly string[];
  readonly defaultView: ProductViewId;
};

export const createProductLensCatalog = (
  relations: ProductRelationCatalog,
): readonly ProductLensDefinition[] => {
  const typesFor = (...lenses: readonly string[]) =>
    relations.relations
      .filter((relation) => lenses.some((lens) => relation.lenses.includes(lens)))
      .map(({ type }) => type);
  const definition = (
    value: Omit<ProductLensDefinition, "maximumDepth" | "legend"> & {
      readonly maximumDepth?: number;
      readonly legend?: readonly string[];
    },
  ): ProductLensDefinition => ({
    maximumDepth: value.id === "constellation" || value.id === "hierarchy" ? 4 : 2,
    legend: ["Color: stable product area", "Outline: registration", "Opacity: relevance"],
    ...value,
  });
  return [
    definition({
      id: "constellation",
      label: "Constellation",
      description: "Product structure with selected semantic neighbours.",
      direction: "both",
      relationFamilies: ["product"],
      relationTypes: typesFor("constellation"),
      grouping: "Product area",
      encoding: "3D text constellation",
      actions: ["Explore", "Compare", "Expand one hop"],
      defaultView: "graph",
    }),
    definition({
      id: "hierarchy",
      label: "Hierarchy",
      description: "Primary parent-child structure only.",
      direction: "hierarchy",
      relationFamilies: [],
      relationTypes: [],
      grouping: "Parent path",
      encoding: "Structural depth",
      actions: ["Explore", "Collapse branch", "Product home"],
      defaultView: "hierarchy",
    }),
    definition({
      id: "dependencies",
      label: "Dependencies",
      description: "Prerequisites, enabling relations, constraints, and conflicts.",
      direction: "both",
      relationFamilies: ["product", "assurance"],
      relationTypes: typesFor("dependencies"),
      grouping: "Direction",
      encoding: "Directed relationship family",
      actions: ["Find path", "Show impact", "Show prerequisites"],
      defaultView: "matrix",
    }),
    definition({
      id: "relationships",
      label: "Relationships",
      description: "General semantic neighbourhood around the selected entity.",
      direction: "both",
      relationFamilies: ["product", "delivery", "realization", "assurance", "variation"],
      relationTypes: relations.relations.map(({ type }) => type),
      grouping: "Semantic family",
      encoding: "Typed directional edges",
      actions: ["Select edge", "Explore related entity"],
      defaultView: "graph",
    }),
    definition({
      id: "customer-journey",
      label: "Customer journey",
      description: "Only explicitly governed journey or flow relations.",
      direction: "outgoing",
      relationFamilies: [],
      relationTypes: [],
      grouping: "Governed flow",
      encoding: "Ordered governed relations",
      actions: ["Explore"],
      defaultView: "list",
    }),
    definition({
      id: "delivery",
      label: "Delivery",
      description: "Current and recent delivery evidence without changing product identity.",
      direction: "both",
      relationFamilies: ["delivery"],
      relationTypes: typesFor("delivery"),
      grouping: "Delivery stage",
      encoding: "Stage ring and active halo",
      actions: ["Inspect supporting work"],
      defaultView: "timeline",
    }),
    definition({
      id: "realization",
      label: "Realization",
      description: "Technical references as supporting nodes.",
      direction: "outgoing",
      relationFamilies: ["realization"],
      relationTypes: typesFor("realization"),
      grouping: "Reference class",
      encoding: "Supporting-node type",
      actions: ["Inspect relation"],
      defaultView: "graph",
    }),
    definition({
      id: "variants",
      label: "Variants",
      description: "Base behavior and qualifier-scoped differences.",
      direction: "both",
      relationFamilies: ["variation"],
      relationTypes: typesFor("variants"),
      grouping: "Variant axis",
      encoding: "Qualifier badges",
      actions: ["Resolve qualifiers"],
      defaultView: "list",
    }),
    definition({
      id: "assurance",
      label: "Assurance",
      description: "Invariants, constraints, compatibility, verification, and acceptance.",
      direction: "both",
      relationFamilies: ["assurance"],
      relationTypes: typesFor("assurance"),
      grouping: "Assurance state",
      encoding: "Non-color state marks",
      actions: ["Inspect evidence coverage"],
      defaultView: "list",
    }),
    definition({
      id: "coverage",
      label: "Coverage",
      description: "Weak, stale, contested, ambiguous, and unmapped areas.",
      direction: "both",
      relationFamilies: ["assurance"],
      relationTypes: typesFor("coverage"),
      grouping: "Coverage flag",
      encoding: "Landscape intensity and warning marks",
      actions: ["Open dossier"],
      defaultView: "landscape",
    }),
    definition({
      id: "history",
      label: "History",
      description: "Registry revisions and temporal changes.",
      direction: "both",
      relationFamilies: ["product", "variation"],
      relationTypes: typesFor("history"),
      grouping: "Revision",
      encoding: "Before/after state",
      actions: ["View revision", "Compare revisions"],
      defaultView: "revision-diff",
    }),
  ];
};

export type ProductExplorationState = {
  readonly focusId?: string | undefined;
  readonly selectedEntityId?: string | undefined;
  readonly selectedRelationId?: string | undefined;
  readonly compareIds: readonly string[];
  readonly lens: ProductLensId;
  readonly view: ProductViewId;
  readonly revision?: number | undefined;
  readonly query: string;
  readonly relationType?: string | undefined;
  readonly dossierOpen: boolean;
};

export type ProductExplorationAction =
  | { readonly type: "select-entity"; readonly entityId: string; readonly compare?: boolean }
  | { readonly type: "select-relation"; readonly relationId: string }
  | { readonly type: "explore"; readonly entityId: string }
  | { readonly type: "set-lens"; readonly lens: ProductLensId; readonly view: ProductViewId }
  | { readonly type: "set-view"; readonly view: ProductViewId }
  | { readonly type: "set-query"; readonly query: string }
  | { readonly type: "set-relation-type"; readonly relationType?: string }
  | { readonly type: "set-revision"; readonly revision?: number }
  | { readonly type: "open-dossier" }
  | { readonly type: "close-dossier" }
  | { readonly type: "restore"; readonly state: ProductExplorationState };

export const reduceProductExploration = (
  state: ProductExplorationState,
  action: ProductExplorationAction,
): ProductExplorationState => {
  if (action.type === "restore") return action.state;
  if (action.type === "select-entity") {
    if (action.compare !== true)
      return { ...state, selectedEntityId: action.entityId, selectedRelationId: undefined };
    const without = state.compareIds.filter((id) => id !== action.entityId);
    return {
      ...state,
      selectedEntityId: action.entityId,
      selectedRelationId: undefined,
      compareIds:
        without.length !== state.compareIds.length
          ? without
          : [...state.compareIds, action.entityId].slice(-2),
    };
  }
  if (action.type === "select-relation")
    return { ...state, selectedRelationId: action.relationId, selectedEntityId: undefined };
  if (action.type === "explore")
    return {
      ...state,
      focusId: action.entityId,
      selectedEntityId: action.entityId,
      selectedRelationId: undefined,
      query: "",
    };
  if (action.type === "set-lens")
    return { ...state, lens: action.lens, view: action.view, selectedRelationId: undefined };
  if (action.type === "set-view") return { ...state, view: action.view };
  if (action.type === "set-query") return { ...state, query: action.query };
  if (action.type === "set-relation-type") return { ...state, relationType: action.relationType };
  if (action.type === "set-revision") return { ...state, revision: action.revision };
  if (action.type === "open-dossier") return { ...state, dossierOpen: true };
  return { ...state, dossierOpen: false };
};

export const productExplorationFromUrl = (
  url: URL,
  fallbackFocusId?: string,
): ProductExplorationState => {
  const lensValue = url.searchParams.get("lens");
  const lens = productLensIds.includes(lensValue as ProductLensId)
    ? (lensValue as ProductLensId)
    : "constellation";
  const viewValue = url.searchParams.get("view");
  const views: readonly ProductViewId[] = [
    "graph",
    "hierarchy",
    "matrix",
    "landscape",
    "timeline",
    "revision-diff",
    "list",
  ];
  const revisionValue = Number(url.searchParams.get("revision"));
  return {
    focusId: url.searchParams.get("focus") ?? url.searchParams.get("entity") ?? fallbackFocusId,
    selectedEntityId: url.searchParams.get("selected") ?? undefined,
    selectedRelationId: url.searchParams.get("edge") ?? undefined,
    compareIds: url.searchParams.getAll("compare").slice(0, 2),
    lens,
    view: views.includes(viewValue as ProductViewId) ? (viewValue as ProductViewId) : "graph",
    revision: Number.isSafeInteger(revisionValue) && revisionValue >= 0 ? revisionValue : undefined,
    query: url.searchParams.get("q") ?? "",
    relationType: url.searchParams.get("relation") ?? undefined,
    dossierOpen: url.searchParams.get("dossier") === "open",
  };
};

export const productExplorationUrl = (state: ProductExplorationState): string => {
  const query = new URLSearchParams();
  if (state.focusId !== undefined) query.set("focus", state.focusId);
  if (state.selectedEntityId !== undefined) query.set("selected", state.selectedEntityId);
  if (state.selectedRelationId !== undefined) query.set("edge", state.selectedRelationId);
  for (const entityId of state.compareIds) query.append("compare", entityId);
  if (state.lens !== "constellation") query.set("lens", state.lens);
  if (state.view !== "graph") query.set("view", state.view);
  if (state.revision !== undefined) query.set("revision", String(state.revision));
  if (state.query !== "") query.set("q", state.query);
  if (state.relationType !== undefined) query.set("relation", state.relationType);
  if (state.dossierOpen) query.set("dossier", "open");
  const serialized = query.toString();
  return `/admin/product-map${serialized === "" ? "" : `?${serialized}`}`;
};

export const findProductRelationPath = (
  map: ProductMap,
  sourceId: string,
  targetId: string,
  relationTypes: readonly string[],
  maximumDepth = 4,
): readonly string[] => {
  const allowed = new Set(relationTypes);
  const neighbours = new Map<string, { readonly id: string; readonly relationId: string }[]>();
  for (const relation of map.relations) {
    if (!allowed.has(relation.type)) continue;
    if (relation.source.kind !== "entity" || relation.target.kind !== "entity") continue;
    neighbours.set(relation.source.entityId, [
      ...(neighbours.get(relation.source.entityId) ?? []),
      { id: relation.target.entityId, relationId: relation.id },
    ]);
  }
  const queue: { readonly id: string; readonly path: readonly string[]; readonly depth: number }[] =
    [{ id: sourceId, path: [], depth: 0 }];
  const visited = new Set([sourceId]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current.depth >= maximumDepth) continue;
    for (const neighbour of neighbours.get(current.id) ?? []) {
      const path = [...current.path, neighbour.relationId];
      if (neighbour.id === targetId) return path;
      if (visited.has(neighbour.id)) continue;
      visited.add(neighbour.id);
      queue.push({ id: neighbour.id, path, depth: current.depth + 1 });
    }
  }
  return [];
};

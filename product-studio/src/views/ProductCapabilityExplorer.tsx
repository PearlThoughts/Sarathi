"use client";

import type { ForceGraph3DInstance, LinkObject, NodeObject } from "3d-force-graph";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  createProductLensCatalog,
  findProductRelationPath,
  type ProductLensDefinition,
  type ProductLensId,
  type ProductViewId,
  productExplorationFromUrl,
  productExplorationUrl,
  reduceProductExploration,
} from "../domain/product-exploration";
import {
  type ProductAvailability,
  type ProductCoverage,
  type ProductDelivery,
  type ProductDossier,
  type ProductEntityHistory,
  type ProductHierarchyNode,
  type ProductMap,
  type ProductRelation,
  type ProductRelationCatalog,
  productExplorerProjection,
  productExplorerSearch,
} from "../domain/product-model";
import { ProductAlternativeViews } from "./ProductAlternativeViews";
import { CompactInspector, FullDossier } from "./ProductInspectors";
import { productModelBrowserClient } from "./product-model-browser-client";

type GraphNodeRole = "focus" | "child" | "related";
type CapabilityGraphNode = NodeObject & {
  readonly id: string;
  readonly entityId?: string;
  readonly kind: ProductHierarchyNode["kind"] | "external";
  readonly label: string;
  readonly description?: string;
  readonly childCount: number;
  readonly role: GraphNodeRole;
  readonly color: string;
};
type CapabilityGraphLink = LinkObject<CapabilityGraphNode> & {
  readonly id: string;
  readonly relationId?: string;
  readonly label: string;
  readonly role: "hierarchy" | "relation";
  readonly color: string;
  readonly registration: string;
};
type CapabilityGraph = ForceGraph3DInstance<CapabilityGraphNode, CapabilityGraphLink>;
type CapabilityGraphConstructor = new (
  element: HTMLElement,
  options?: {
    readonly controlType?: "trackball" | "orbit" | "fly";
    readonly rendererConfig?: { readonly alpha?: boolean; readonly antialias?: boolean };
  },
) => CapabilityGraph;

const kindLabel: Readonly<Record<CapabilityGraphNode["kind"], string>> = {
  product: "Product",
  area: "Product area",
  capability: "Capability",
  feature: "Feature",
  external: "Supporting reference",
};
const areaPalette = ["#4ee7d0", "#7dd3fc", "#fbbf24", "#a7f3d0", "#fda4af", "#c4b5fd"] as const;
const relationPalette: Readonly<Record<string, string>> = {
  product: "#2dd4bf",
  delivery: "#fbbf24",
  realization: "#7dd3fc",
  assurance: "#c4b5fd",
  variation: "#fda4af",
};
const endpointId = (endpoint: ProductRelation["source"]): string =>
  endpoint.kind === "entity"
    ? endpoint.entityId
    : `external:${endpoint.referenceKind}:${endpoint.referenceId}`;
const focusCamera = (graph: CapabilityGraph, node: CapabilityGraphNode, reducedMotion: boolean) => {
  const distance = 110;
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const z = node.z ?? 0;
  const ratio = 1 + distance / (Math.hypot(x, y, z) || 1);
  graph.cameraPosition(
    { x: x * ratio, y: y * ratio, z: z * ratio },
    { x, y, z },
    reducedMotion ? 0 : 650,
  );
};

const GraphCanvas = ({
  highlightedRelationIds,
  links,
  nodes,
  onExplore,
  onSelectEntity,
  onSelectRelation,
  prefersReducedMotion,
  relevantEntityIds,
  selectedEntityId,
  selectedRelationId,
}: {
  readonly highlightedRelationIds: ReadonlySet<string>;
  readonly links: readonly CapabilityGraphLink[];
  readonly nodes: readonly CapabilityGraphNode[];
  readonly onExplore: (entityId: string) => void;
  readonly onSelectEntity: (entityId: string, compare: boolean) => void;
  readonly onSelectRelation: (relationId: string) => void;
  readonly prefersReducedMotion: boolean;
  readonly relevantEntityIds: ReadonlySet<string>;
  readonly selectedEntityId?: string | undefined;
  readonly selectedRelationId?: string | undefined;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<CapabilityGraph | undefined>(undefined);
  const callbacksRef = useRef({ onExplore, onSelectEntity, onSelectRelation });
  const visualRef = useRef({
    highlightedRelationIds,
    prefersReducedMotion,
    relevantEntityIds,
    selectedEntityId,
    selectedRelationId,
  });
  const sceneRef = useRef({ links, nodes });
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string>();
  const sceneSignature = useMemo(
    () => `${nodes.map(({ id }) => id).join("|")}::${links.map(({ id }) => id).join("|")}`,
    [links, nodes],
  );

  useEffect(() => {
    callbacksRef.current = { onExplore, onSelectEntity, onSelectRelation };
  }, [onExplore, onSelectEntity, onSelectRelation]);
  useEffect(() => {
    visualRef.current = {
      highlightedRelationIds,
      prefersReducedMotion,
      relevantEntityIds,
      selectedEntityId,
      selectedRelationId,
    };
    graphRef.current?.refresh();
  }, [
    highlightedRelationIds,
    prefersReducedMotion,
    relevantEntityIds,
    selectedEntityId,
    selectedRelationId,
  ]);
  useEffect(() => {
    sceneRef.current = { links, nodes };
  }, [links, nodes]);

  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    void Promise.all([import("3d-force-graph"), import("three-spritetext")])
      .then(([forceGraphModule, spriteTextModule]) => {
        if (disposed) return;
        const graph = new (forceGraphModule.default as unknown as CapabilityGraphConstructor)(
          element,
          { controlType: "orbit", rendererConfig: { alpha: true, antialias: true } },
        );
        const SpriteText = spriteTextModule.default;
        graph
          .backgroundColor("#080a0d")
          .showNavInfo(false)
          .enableNodeDrag(false)
          .nodeColor((node) => {
            const selected = visualRef.current.selectedEntityId;
            if (node.entityId === selected) return "#ffffff";
            if (selected !== undefined && !visualRef.current.relevantEntityIds.has(node.id))
              return "#44403c";
            return node.color;
          })
          .nodeVal((node) =>
            node.role === "focus" ? 11 : Math.max(2.5, Math.min(7, 2.5 + node.childCount * 0.65)),
          )
          .nodeLabel(
            (node) =>
              `${kindLabel[node.kind]}: ${node.label}${node.childCount === 0 ? "" : ` · ${node.childCount} below`}`,
          )
          .nodeThreeObject((node) => {
            const sprite = new SpriteText(node.label);
            sprite.material.depthWrite = false;
            sprite.color = node.color;
            sprite.textHeight = node.role === "focus" ? 9 : node.kind === "feature" ? 5.2 : 6.6;
            sprite.fontFace = "IBM Plex Sans";
            sprite.fontWeight = node.role === "focus" ? "600" : "400";
            sprite.strokeColor = "#080a0d";
            sprite.strokeWidth = 0.65;
            sprite.padding = 2;
            sprite.center.y = -0.7;
            return sprite;
          })
          .nodeThreeObjectExtend(true)
          .linkColor((link) =>
            link.relationId === visualRef.current.selectedRelationId ||
            (link.relationId !== undefined &&
              visualRef.current.highlightedRelationIds.has(link.relationId))
              ? "#ffffff"
              : link.color,
          )
          .linkOpacity(0.42)
          .linkWidth((link) =>
            link.relationId === visualRef.current.selectedRelationId
              ? 3
              : link.role === "relation"
                ? 1.25
                : 0.45,
          )
          .linkCurvature((link) => (link.role === "relation" ? 0.14 : 0))
          .linkLabel((link) => link.label)
          .linkDirectionalArrowLength((link) => (link.role === "relation" ? 3.5 : 0))
          .linkDirectionalArrowColor((link) => link.color)
          .linkDirectionalParticles((link) =>
            !visualRef.current.prefersReducedMotion &&
            link.relationId !== undefined &&
            (link.relationId === visualRef.current.selectedRelationId ||
              visualRef.current.highlightedRelationIds.has(link.relationId))
              ? 2
              : 0,
          )
          .linkDirectionalParticleColor(() => "#ffffff")
          .linkDirectionalParticleWidth(1.4)
          .linkDirectionalParticleSpeed(0.004)
          .onNodeClick((node, event) => {
            if (node.entityId === undefined) return;
            callbacksRef.current.onSelectEntity(node.entityId, event.shiftKey);
            if (event.detail >= 2) {
              focusCamera(graph, node, visualRef.current.prefersReducedMotion);
              callbacksRef.current.onExplore(node.entityId);
            }
          })
          .onLinkClick((link) => {
            if (link.relationId !== undefined)
              callbacksRef.current.onSelectRelation(link.relationId);
          })
          .onNodeHover((node) => {
            element.style.cursor = node?.entityId === undefined ? "grab" : "pointer";
          })
          .onLinkHover((link) => {
            if (link !== null && link.role === "relation") element.style.cursor = "pointer";
          })
          .warmupTicks(60)
          .cooldownTicks(140);
        const charge = graph.d3Force("charge") as
          | { readonly strength?: (value: number) => unknown }
          | undefined;
        charge?.strength?.(-190);
        graphRef.current = graph;
        resizeObserver = new ResizeObserver(([entry]) => {
          if (entry !== undefined) {
            graph.width(Math.max(1, entry.contentRect.width));
            graph.height(Math.max(1, entry.contentRect.height));
          }
        });
        resizeObserver.observe(element);
        graph.graphData({ nodes: [...sceneRef.current.nodes], links: [...sceneRef.current.links] });
        setReady(true);
      })
      .catch(
        () =>
          !disposed &&
          setFailure(
            "The 3D renderer could not start. The structured hierarchy and relationship views remain operational.",
          ),
      );
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      graphRef.current?._destructor();
      graphRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    void sceneSignature;
    if (!ready || graphRef.current === undefined) return;
    graphRef.current.graphData({
      nodes: [...sceneRef.current.nodes],
      links: [...sceneRef.current.links],
    });
    graphRef.current.d3ReheatSimulation();
    const graph = graphRef.current;
    const refit = window.setTimeout(
      () => graph.zoomToFit(prefersReducedMotion ? 0 : 500, 110),
      prefersReducedMotion ? 0 : 350,
    );
    return () => window.clearTimeout(refit);
  }, [prefersReducedMotion, ready, sceneSignature]);

  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        data-scene-signature={sceneSignature}
        data-testid="product-capability-graph"
        ref={containerRef}
      />
      <p className="sr-only" role="status">
        {failure ?? (ready ? "Interactive 3D product capability graph ready." : "Loading graph.")}
      </p>
      {failure === undefined ? null : (
        <p
          className="absolute left-1/2 top-1/2 z-20 max-w-lg -translate-x-1/2 rounded-xl border border-amber-300 bg-stone-950 p-4 text-sm text-amber-100"
          role="alert"
        >
          {failure}
        </p>
      )}
    </>
  );
};

const mergeMap = (
  current: ProductMap,
  subgraph: Awaited<ReturnType<typeof productModelBrowserClient.getSubgraph>>,
): ProductMap => {
  const entities = new Map(current.entities.map((entity) => [entity.entityId, entity]));
  for (const entity of [...subgraph.ancestors, ...subgraph.descendants])
    entities.set(entity.entityId, entity);
  const relations = new Map(current.relations.map((relation) => [relation.id, relation]));
  for (const relation of subgraph.relations) relations.set(relation.id, relation);
  return {
    ...current,
    asOf: subgraph.asOf,
    revision: subgraph.revision,
    entities: [...entities.values()],
    relations: [...relations.values()],
    safeWarnings: [...new Set([...current.safeWarnings, ...subgraph.safeWarnings])],
  };
};

export const ProductCapabilityExplorer = ({
  canMutate,
  coverage: initialCoverage,
  initialFocusId,
  initialQuery = "",
  initialRelationType,
  map: initialMap,
  relationCatalog,
}: {
  readonly canMutate: boolean;
  readonly coverage: ProductCoverage;
  readonly initialFocusId?: string;
  readonly initialQuery?: string;
  readonly initialRelationType?: string;
  readonly map: ProductMap;
  readonly relationCatalog: ProductRelationCatalog;
}) => {
  const fallbackFocus = productExplorerProjection(
    initialMap,
    initialFocusId === undefined ? {} : { focusEntityId: initialFocusId },
  ).focus?.entityId;
  const initialState = useMemo(
    () => ({
      focusId: fallbackFocus,
      selectedEntityId: initialFocusId ?? fallbackFocus,
      compareIds: [],
      lens: "constellation" as const,
      view: "graph" as const,
      query: initialQuery,
      relationType: initialRelationType,
      dossierOpen: false,
    }),
    [fallbackFocus, initialFocusId, initialQuery, initialRelationType],
  );
  const [state, dispatch] = useReducer(reduceProductExploration, initialState);
  const [map, setMap] = useState(initialMap);
  const coverage = initialCoverage;
  const [dossier, setDossier] = useState<ProductDossier>();
  const [availability, setAvailability] = useState<ProductAvailability>();
  const [delivery, setDelivery] = useState<ProductDelivery>();
  const [history, setHistory] = useState<ProductEntityHistory>();
  const [historicalMap, setHistoricalMap] = useState<ProductMap>();
  const [loading, setLoading] = useState(false);
  const [safeError, setSafeError] = useState<string>();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(true);
  const [highlightedRelationIds, setHighlightedRelationIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<ReadonlySet<string>>(new Set());
  const lenses = useMemo(() => createProductLensCatalog(relationCatalog), [relationCatalog]);
  const lens = lenses.find(({ id }) => id === state.lens) ?? (lenses[0] as ProductLensDefinition);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  const lastUrlRef = useRef(productExplorationUrl(initialState));
  const restoringUrlRef = useRef(false);
  useEffect(() => {
    const restored = productExplorationFromUrl(new URL(window.location.href), fallbackFocus);
    lastUrlRef.current = productExplorationUrl(restored);
    restoringUrlRef.current = true;
    dispatch({ type: "restore", state: restored });
  }, [fallbackFocus]);
  useEffect(() => {
    if (restoringUrlRef.current) {
      restoringUrlRef.current = false;
      return;
    }
    const path = productExplorationUrl(state);
    if (path === lastUrlRef.current) return;
    lastUrlRef.current = path;
    window.history.pushState({ productExploration: state }, "", path);
  }, [state]);
  useEffect(() => {
    const restore = () => {
      const restored = productExplorationFromUrl(new URL(window.location.href), fallbackFocus);
      lastUrlRef.current = productExplorationUrl(restored);
      restoringUrlRef.current = true;
      dispatch({ type: "restore", state: restored });
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [fallbackFocus]);

  const selectedId = state.selectedEntityId ?? state.focusId;
  useEffect(() => {
    if (selectedId === undefined) return;
    let active = true;
    setLoading(true);
    setSafeError(undefined);
    void Promise.allSettled([
      productModelBrowserClient.getDossier(selectedId),
      productModelBrowserClient.getAvailability(selectedId),
      productModelBrowserClient.getDelivery(selectedId),
      productModelBrowserClient.getEntityHistory(selectedId),
    ]).then(([dossierResult, availabilityResult, deliveryResult, historyResult]) => {
      if (!active) return;
      if (dossierResult.status === "fulfilled") setDossier(dossierResult.value);
      else {
        setDossier(undefined);
        setSafeError("The selected entity details are no longer available to this session.");
      }
      setAvailability(
        availabilityResult.status === "fulfilled" ? availabilityResult.value : undefined,
      );
      setDelivery(deliveryResult.status === "fulfilled" ? deliveryResult.value : undefined);
      setHistory(historyResult.status === "fulfilled" ? historyResult.value : undefined);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const explore = useCallback((entityId: string) => {
    dispatch({ type: "explore", entityId });
    void productModelBrowserClient
      .getSubgraph(entityId)
      .then((subgraph) => setMap((current) => mergeMap(current, subgraph)))
      .catch(() =>
        setSafeError(
          "The bounded neighbourhood could not be expanded. The current authorized scene remains available.",
        ),
      );
  }, []);
  const selectEntity = useCallback(
    (entityId: string, compare = false) => dispatch({ type: "select-entity", entityId, compare }),
    [],
  );
  const selectRelation = useCallback(
    (relationId: string) => dispatch({ type: "select-relation", relationId }),
    [],
  );
  const projection = useMemo(
    () =>
      productExplorerProjection(map, {
        ...(state.focusId === undefined ? {} : { focusEntityId: state.focusId }),
        includeRelations: state.lens !== "hierarchy",
        ...(state.relationType === undefined ? {} : { relationType: state.relationType }),
      }),
    [map, state.focusId, state.lens, state.relationType],
  );
  const entities = useMemo(
    () => new Map(map.entities.map((entity) => [entity.entityId, entity])),
    [map.entities],
  );
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entity of map.entities)
      if (entity.parentId !== undefined)
        counts.set(entity.parentId, (counts.get(entity.parentId) ?? 0) + 1);
    return counts;
  }, [map.entities]);
  const areaTones = useMemo(
    () =>
      new Map(
        map.entities
          .filter(({ kind }) => kind === "area")
          .toSorted((left, right) => left.canonicalName.localeCompare(right.canonicalName))
          .map(({ entityId }, index) => [entityId, index]),
      ),
    [map.entities],
  );
  const colorFor = useCallback(
    (entity: ProductHierarchyNode) => {
      let current: ProductHierarchyNode | undefined = entity;
      const visited = new Set<string>();
      while (current !== undefined && !visited.has(current.entityId)) {
        visited.add(current.entityId);
        if (current.kind === "area")
          return (
            areaPalette[(areaTones.get(current.entityId) ?? 0) % areaPalette.length] ??
            areaPalette[0]
          );
        current = current.parentId === undefined ? undefined : entities.get(current.parentId);
      }
      return "#f5f5f4";
    },
    [areaTones, entities],
  );
  const visibleRelationTypes = new Set(lens.relationTypes);
  const projectedRelations = projection.relations.filter((relation) =>
    state.lens === "relationships" || state.lens === "constellation"
      ? lens.relationTypes.length === 0 || visibleRelationTypes.has(relation.type)
      : visibleRelationTypes.has(relation.type),
  );
  const graphNodes = useMemo<readonly CapabilityGraphNode[]>(() => {
    if (projection.focus === undefined) return [];
    const nodeFor = (entity: ProductHierarchyNode, role: GraphNodeRole): CapabilityGraphNode => ({
      id: entity.entityId,
      entityId: entity.entityId,
      kind: entity.kind,
      label: entity.canonicalName,
      ...(entity.description === undefined ? {} : { description: entity.description }),
      childCount: childCounts.get(entity.entityId) ?? 0,
      role,
      color: role === "focus" ? "#ffffff" : colorFor(entity),
    });
    return [
      nodeFor(projection.focus, "focus"),
      ...projection.children
        .filter(({ entityId }) => !collapsedBranchIds.has(entityId))
        .map((entity) => nodeFor(entity, "child")),
      ...projection.relatedEntities.map((related) => {
        const entity = related.entityId === undefined ? undefined : entities.get(related.entityId);
        return {
          id: related.id,
          ...(related.entityId === undefined ? {} : { entityId: related.entityId }),
          kind: related.kind,
          label: related.label,
          childCount: related.entityId === undefined ? 0 : (childCounts.get(related.entityId) ?? 0),
          role: "related" as const,
          color: entity === undefined ? "#a8a29e" : colorFor(entity),
        };
      }),
    ];
  }, [childCounts, collapsedBranchIds, colorFor, entities, projection]);
  const graphLinks = useMemo<readonly CapabilityGraphLink[]>(() => {
    if (projection.focus === undefined) return [];
    return [
      ...projection.children
        .filter(({ entityId }) => !collapsedBranchIds.has(entityId))
        .map((child) => ({
          id: `hierarchy:${projection.focus?.entityId}:${child.entityId}`,
          source: projection.focus?.entityId ?? "",
          target: child.entityId,
          label: "contains",
          role: "hierarchy" as const,
          color: "#78716c",
          registration: child.registration,
        })),
      ...projectedRelations.map((relation) => {
        const semantics = relationCatalog.relations.find(({ type }) => type === relation.type);
        return {
          id: `relation:${relation.id}`,
          relationId: relation.id,
          source: endpointId(relation.source),
          target: endpointId(relation.target),
          label: semantics?.label ?? relation.type.replaceAll("_", " "),
          role: "relation" as const,
          color: relationPalette[semantics?.family ?? "product"] ?? "#2dd4bf",
          registration: relation.registration,
        };
      }),
    ];
  }, [
    collapsedBranchIds,
    projectedRelations,
    projection.children,
    projection.focus,
    relationCatalog.relations,
  ]);
  const selectedRelation =
    state.selectedRelationId === undefined
      ? undefined
      : map.relations.find(({ id }) => id === state.selectedRelationId);
  const relevantEntityIds = useMemo(() => {
    if (selectedId === undefined) return new Set<string>();
    const ids = new Set([selectedId]);
    const selected = entities.get(selectedId);
    if (selected?.parentId !== undefined) ids.add(selected.parentId);
    for (const entity of map.entities) if (entity.parentId === selectedId) ids.add(entity.entityId);
    for (const relation of map.relations)
      if (
        [relation.source, relation.target].some(
          (endpoint) => endpoint.kind === "entity" && endpoint.entityId === selectedId,
        )
      ) {
        ids.add(endpointId(relation.source));
        ids.add(endpointId(relation.target));
      }
    return ids;
  }, [entities, map.entities, map.relations, selectedId]);
  const searchResults = useMemo(() => productExplorerSearch(map, state.query), [map, state.query]);
  const path = projection.focus === undefined ? [] : [...projection.ancestors, projection.focus];
  const viewRevision = useCallback((revision: number) => {
    dispatch({ type: "set-revision", revision });
    dispatch({ type: "set-lens", lens: "history", view: "revision-diff" });
    void productModelBrowserClient
      .getHistory(revision)
      .then(setHistoricalMap)
      .catch(() =>
        setSafeError("The requested historical revision is unavailable to this session."),
      );
  }, []);
  const findPath = () => {
    if (state.compareIds.length !== 2) {
      setSafeError("Select exactly two entities with Shift-click before finding a path.");
      return;
    }
    const pathIds = findProductRelationPath(
      map,
      state.compareIds[0] ?? "",
      state.compareIds[1] ?? "",
      lens.relationTypes,
      lens.maximumDepth,
    );
    setHighlightedRelationIds(new Set(pathIds));
    setSafeError(
      pathIds.length === 0
        ? "No authorized typed path was found within this lens bound."
        : undefined,
    );
  };
  const dependencyRelationTypes = relationCatalog.relations
    .filter(({ lenses: relationLenses }) => relationLenses.includes("dependencies"))
    .map(({ type }) => type);
  const dependencyReach = (direction: "impact" | "prerequisites") => {
    if (selectedId === undefined) return;
    const pathMap =
      direction === "impact"
        ? map
        : {
            ...map,
            relations: map.relations.map((relation) => ({
              ...relation,
              source: relation.target,
              target: relation.source,
            })),
          };
    const ids = new Set<string>();
    for (const entity of map.entities) {
      if (entity.entityId === selectedId) continue;
      for (const relationId of findProductRelationPath(
        pathMap,
        selectedId,
        entity.entityId,
        dependencyRelationTypes,
        4,
      ))
        ids.add(relationId);
    }
    setHighlightedRelationIds(ids);
    setSafeError(
      ids.size === 0
        ? `No authorized ${direction === "impact" ? "downstream impact" : "upstream prerequisite"} was found within four hops.`
        : undefined,
    );
  };
  const focusEntity = projection.focus;
  if (focusEntity === undefined)
    return (
      <p className="min-h-dvh bg-stone-950 p-8 text-sm text-stone-300">
        No authorized entity is available for exploration.
      </p>
    );
  const rootId = path[0]?.entityId;
  const endpointDisplayName = (endpoint: ProductRelation["source"]): string =>
    endpoint.kind === "entity"
      ? (entities.get(endpoint.entityId)?.canonicalName ?? "Authorized entity")
      : `${endpoint.referenceKind.replaceAll("_", " ")} reference`;
  const textNavigatorEntities = [
    { entity: focusEntity, role: "focus" as const },
    ...projection.children.map((entity) => ({ entity, role: "child" as const })),
    ...projection.relatedEntities.flatMap((related) => {
      const entity = related.entityId === undefined ? undefined : entities.get(related.entityId);
      return entity === undefined ? [] : [{ entity, role: "related" as const }];
    }),
  ].filter(
    ({ entity }, index, candidates) =>
      candidates.findIndex(({ entity: candidate }) => candidate.entityId === entity.entityId) ===
      index,
  );

  return (
    <section
      aria-label="Interactive 3D product capability graph"
      className="relative h-dvh min-h-[42rem] overflow-hidden bg-stone-950 text-stone-100"
      data-compare-count={state.compareIds.length}
      data-depth={focusEntity.depth}
      data-lens={state.lens}
      data-reduced-motion={prefersReducedMotion}
      data-renderer="3d-force-graph"
      data-selected-entity={state.selectedEntityId}
      data-selected-relation={state.selectedRelationId}
      data-testid="product-capability-explorer"
      data-view={state.view}
    >
      {state.view === "graph" ? (
        <GraphCanvas
          highlightedRelationIds={highlightedRelationIds}
          links={graphLinks}
          nodes={graphNodes}
          onExplore={explore}
          onSelectEntity={selectEntity}
          onSelectRelation={selectRelation}
          prefersReducedMotion={prefersReducedMotion}
          relevantEntityIds={relevantEntityIds}
          selectedEntityId={state.selectedEntityId}
          selectedRelationId={state.selectedRelationId}
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_30%,rgba(20,184,166,0.08),transparent_38%),linear-gradient(#080a0d,#0c0a09)]" />
      )}
      <ProductAlternativeViews
        coverage={coverage}
        delivery={delivery}
        historicalMap={historicalMap}
        lens={lens}
        map={map}
        onSelectEntity={selectEntity}
        onSelectRelation={selectRelation}
        relationCatalog={relationCatalog}
        selectedEntityId={state.selectedEntityId}
        selectedRelationId={state.selectedRelationId}
        view={state.view}
      />
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-3 p-4 sm:p-6">
        <div className="pointer-events-auto max-w-2xl rounded-2xl border border-stone-800 bg-stone-950/92 p-4 shadow-2xl backdrop-blur">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-teal-300">
            Sarathi registry · revision {map.revision}
          </p>
          <h1
            className="mt-1 text-balance text-2xl font-semibold sm:text-3xl"
            id="product-map-title"
          >
            Product Capability Graph
          </h1>
          <ol
            aria-label="Current product path"
            className="mt-3 flex flex-wrap items-center gap-1 text-xs"
          >
            {path.map((entity, index) => (
              <li className="flex items-center gap-1" key={entity.entityId}>
                {index === 0 ? null : (
                  <span aria-hidden="true" className="text-stone-600">
                    /
                  </span>
                )}
                <button
                  aria-current={entity.entityId === state.focusId ? "page" : undefined}
                  className="rounded-md px-2 py-1 text-stone-300 hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 aria-[current=page]:bg-teal-300 aria-[current=page]:font-semibold aria-[current=page]:text-stone-950"
                  onClick={() => explore(entity.entityId)}
                  type="button"
                >
                  {entity.canonicalName}
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="pointer-events-auto flex max-w-[34rem] flex-wrap justify-end gap-2 rounded-2xl border border-stone-800 bg-stone-950/92 p-2 shadow-2xl backdrop-blur">
          <label className="sr-only" htmlFor="product-lens">
            Visual lens
          </label>
          <select
            className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            id="product-lens"
            onChange={(event) => {
              const next = lenses.find(({ id }) => id === (event.target.value as ProductLensId));
              if (next !== undefined)
                dispatch({ type: "set-lens", lens: next.id, view: next.defaultView });
            }}
            value={state.lens}
          >
            {lenses.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="product-view">
            Synchronized view
          </label>
          <select
            className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            id="product-view"
            onChange={(event) =>
              dispatch({ type: "set-view", view: event.target.value as ProductViewId })
            }
            value={state.view}
          >
            {(
              [
                "graph",
                "hierarchy",
                "matrix",
                "landscape",
                "timeline",
                "revision-diff",
                "list",
              ] as const
            ).map((view) => (
              <option key={view} value={view}>
                {view.replaceAll("-", " ")}
              </option>
            ))}
          </select>
          <button
            className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:opacity-40"
            disabled={state.compareIds.length !== 2}
            onClick={findPath}
            type="button"
          >
            Find path ({state.compareIds.length}/2)
          </button>
          <button
            className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            onClick={() => dependencyReach("impact")}
            type="button"
          >
            Show impact
          </button>
          <button
            className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            onClick={() => dependencyReach("prerequisites")}
            type="button"
          >
            Show prerequisites
          </button>
          <button
            className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            onClick={() =>
              state.focusId !== undefined &&
              void productModelBrowserClient
                .getSubgraph(state.focusId)
                .then((subgraph) => setMap((current) => mergeMap(current, subgraph)))
                .catch(() => setSafeError("One-hop expansion is unavailable to this session."))
            }
            type="button"
          >
            Expand one hop
          </button>
          <button
            className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            onClick={() =>
              selectedId !== undefined &&
              setCollapsedBranchIds((current) => new Set([...current, selectedId]))
            }
            type="button"
          >
            Collapse branch
          </button>
          <button
            className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:opacity-40"
            disabled={rootId === undefined || rootId === state.focusId}
            onClick={() => rootId !== undefined && explore(rootId)}
            type="button"
          >
            Product home
          </button>
        </div>
      </header>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-wrap items-end justify-between gap-3 p-4 sm:p-6">
        <div aria-live="polite" className="pointer-events-auto">
          {safeError === undefined ? null : (
            <p
              className="mb-3 max-w-md rounded-xl border border-amber-300 bg-stone-950 p-3 text-xs text-amber-100"
              role="status"
            >
              {safeError}
            </p>
          )}
          <CompactInspector
            dossier={dossier}
            loading={loading}
            map={map}
            onExplore={explore}
            onOpenDossier={() => dispatch({ type: "open-dossier" })}
            onSelectEntity={selectEntity}
            relation={selectedRelation}
            relationCatalog={relationCatalog}
            selectedEntityId={state.selectedEntityId ?? state.focusId}
          />
        </div>
        <div className="pointer-events-auto flex max-w-2xl flex-1 flex-wrap justify-end gap-2">
          <div className="relative min-w-64 flex-1 sm:max-w-sm">
            <label className="sr-only" htmlFor="capability-search">
              Find a product area, capability, or feature
            </label>
            <input
              autoComplete="off"
              className="w-full rounded-xl border border-stone-700 bg-stone-950/95 px-4 py-3 text-sm shadow-2xl placeholder:text-stone-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
              id="capability-search"
              onChange={(event) => dispatch({ type: "set-query", query: event.target.value })}
              placeholder="Find a capability or feature"
              type="search"
              value={state.query}
            />
            {state.query.trim() === "" ? null : (
              <ul className="absolute inset-x-0 bottom-full mb-2 max-h-72 overflow-y-auto rounded-xl border border-stone-700 bg-stone-950 p-2 shadow-2xl">
                {searchResults.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-stone-400">No authorized match</li>
                ) : (
                  searchResults.map((entity) => (
                    <li key={entity.entityId}>
                      <button
                        className="block w-full rounded-md px-3 py-2 text-left hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                        onClick={() => {
                          selectEntity(entity.entityId);
                          dispatch({ type: "set-query", query: "" });
                        }}
                        type="button"
                      >
                        <span className="block text-sm font-semibold">{entity.canonicalName}</span>
                        <span className="font-mono text-xs text-stone-500">
                          {kindLabel[entity.kind]}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-xl border border-stone-700 bg-stone-950/95 px-3 py-3 text-xs font-semibold shadow-2xl hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300">
              Text navigator
            </summary>
            <div className="absolute bottom-full right-0 mb-2 max-h-96 w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-stone-700 bg-stone-950 p-3 shadow-2xl">
              <p className="text-xs text-stone-400">
                Keyboard-accessible nodes in the current graph. Relationships follow below.
              </p>
              <ul className="mt-3 space-y-1">
                {textNavigatorEntities.map(({ entity, role }) => (
                  <li
                    className="grid grid-cols-[1fr_auto_auto] gap-1"
                    data-entity-id={entity.entityId}
                    data-role={role}
                    data-testid="capability-text-node"
                    key={entity.entityId}
                  >
                    <button
                      aria-current={entity.entityId === state.selectedEntityId}
                      className="block w-full rounded-md px-3 py-2 text-left hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 aria-[current=true]:bg-teal-950"
                      onClick={(event) => selectEntity(entity.entityId, event.shiftKey)}
                      type="button"
                    >
                      <span className="block text-sm font-semibold">{entity.canonicalName}</span>
                      <span className="font-mono text-xs text-stone-500">
                        {kindLabel[entity.kind]} · Enter selects
                      </span>
                    </button>
                    <button
                      aria-label={`Explore ${entity.canonicalName}`}
                      className="rounded-md border border-stone-800 px-2 text-xs hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                      onClick={() => explore(entity.entityId)}
                      type="button"
                    >
                      Explore
                    </button>
                    <button
                      aria-label={`${state.compareIds.includes(entity.entityId) ? "Remove" : "Add"} ${entity.canonicalName} ${state.compareIds.includes(entity.entityId) ? "from" : "to"} comparison`}
                      aria-pressed={state.compareIds.includes(entity.entityId)}
                      className="rounded-md border border-stone-800 px-2 text-xs hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 aria-pressed:border-teal-300 aria-pressed:bg-teal-950"
                      onClick={() => selectEntity(entity.entityId, true)}
                      type="button"
                    >
                      Compare
                    </button>
                  </li>
                ))}
              </ul>
              <h3 className="mt-5 text-sm font-semibold">Relationships</h3>
              <ul className="mt-2 space-y-1">
                {projectedRelations.map((relation) => {
                  const semantics = relationCatalog.relations.find(
                    ({ type }) => type === relation.type,
                  );
                  return (
                    <li key={relation.id}>
                      <button
                        aria-label={`${semantics?.label ?? relation.type.replaceAll("_", " ")} relationship from ${endpointDisplayName(relation.source)} to ${endpointDisplayName(relation.target)}`}
                        aria-current={relation.id === state.selectedRelationId}
                        className="block w-full rounded-md px-3 py-2 text-left text-xs hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 aria-[current=true]:bg-teal-950"
                        data-testid="capability-text-relation"
                        onClick={() => selectRelation(relation.id)}
                        type="button"
                      >
                        {semantics?.label ?? relation.type.replaceAll("_", " ")} ·{" "}
                        {relation.registration}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        </div>
      </div>
      {state.dossierOpen && dossier !== undefined ? (
        <FullDossier
          availability={availability}
          canMutate={canMutate}
          delivery={delivery}
          dossier={dossier}
          history={history}
          map={map}
          onClose={() => dispatch({ type: "close-dossier" })}
          onSelectEntity={(entityId) => {
            selectEntity(entityId);
            dispatch({ type: "close-dossier" });
          }}
          onSelectRelation={(relationId) => {
            selectRelation(relationId);
            dispatch({ type: "close-dossier" });
          }}
          onViewRevision={(revision) => {
            viewRevision(revision);
            dispatch({ type: "close-dossier" });
          }}
          relationCatalog={relationCatalog}
        />
      ) : null}
      <aside
        aria-label="Visual legend"
        className="pointer-events-none absolute left-4 top-40 z-10 hidden max-w-52 rounded-xl border border-stone-800 bg-stone-950/85 p-3 text-[0.65rem] text-stone-400 backdrop-blur xl:block"
      >
        <p className="font-semibold text-stone-200">{lens.label} lens</p>
        <p className="mt-1">{lens.description}</p>
        <ul className="mt-3 space-y-1">
          {lens.legend.map((item) => (
            <li key={item}>{item}</li>
          ))}
          <li>Dashed: candidate or contested</li>
          <li>Arrow: stored direction</li>
        </ul>
        <p className="mt-3 text-stone-500">
          Depth ≤ {lens.maximumDepth} · {lens.grouping}
        </p>
      </aside>
    </section>
  );
};

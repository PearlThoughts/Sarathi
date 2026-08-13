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
} from "../domain/product-model";
import { ProductAlternativeViews } from "./ProductAlternativeViews";
import { CompactInspector, FullDossier } from "./ProductInspectors";
import { ProductModelTree } from "./ProductModelTree";
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
type ProductLearningMode = "explore" | "explain" | "tour";
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
  const distance = node.role === "focus" ? 210 : 150;
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const z = node.z ?? 0;
  const magnitude = Math.hypot(x, y, z);
  const position =
    magnitude < 1
      ? { x, y, z: z + distance }
      : {
          x: x * (1 + distance / magnitude),
          y: y * (1 + distance / magnitude),
          z: z * (1 + distance / magnitude),
        };
  graph.cameraPosition(position, { x, y, z }, reducedMotion ? 0 : 650);
};

const frameScene = (
  graph: CapabilityGraph,
  nodes: readonly CapabilityGraphNode[],
  reducedMotion: boolean,
) => {
  const focus = nodes.find(({ role }) => role === "focus");
  if (focus === undefined) return;
  const x = focus.x ?? 0;
  const y = focus.y ?? 0;
  const z = focus.z ?? 0;
  graph.cameraPosition({ x, y, z: z + 250 }, { x, y, z }, reducedMotion ? 0 : 450);
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
  const [settled, setSettled] = useState(false);
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
            const selected = visualRef.current.selectedEntityId === node.entityId;
            const sprite = new SpriteText(node.label);
            sprite.material.depthWrite = false;
            sprite.color = selected ? "#0c0a09" : node.color;
            sprite.backgroundColor = selected ? "#f5f5f4" : "rgba(8, 10, 13, 0.82)";
            sprite.borderColor = selected ? "#ffffff" : "rgba(120, 113, 108, 0.7)";
            sprite.borderWidth = selected ? 0.7 : 0.25;
            sprite.textHeight = node.role === "focus" ? 8.5 : node.kind === "feature" ? 4.8 : 6.1;
            sprite.fontFace = "IBM Plex Sans";
            sprite.fontWeight = node.role === "focus" ? "600" : "400";
            sprite.strokeColor = "#080a0d";
            sprite.strokeWidth = selected ? 0 : 0.35;
            sprite.padding = node.role === "focus" ? 3 : 2;
            sprite.center.y = -0.82;
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
          .linkThreeObjectExtend(true)
          .linkThreeObject((link) => {
            const active =
              link.relationId !== undefined &&
              (link.relationId === visualRef.current.selectedRelationId ||
                visualRef.current.highlightedRelationIds.has(link.relationId));
            const label = new SpriteText(active ? link.label : "");
            label.material.depthWrite = false;
            label.color = "#f5f5f4";
            label.backgroundColor = "rgba(8, 10, 13, 0.92)";
            label.borderColor = link.color;
            label.borderWidth = active ? 0.35 : 0;
            label.padding = active ? 1.4 : 0;
            label.textHeight = 3.2;
            return label;
          })
          .linkPositionUpdate((label, { start, end }) => {
            label.position.set(
              start.x + (end.x - start.x) * 0.5,
              start.y + (end.y - start.y) * 0.5,
              start.z + (end.z - start.z) * 0.5,
            );
          })
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
          .onEngineStop(() => {
            frameScene(graph, sceneRef.current.nodes, visualRef.current.prefersReducedMotion);
            setSettled(true);
          })
          .warmupTicks(60)
          .cooldownTicks(140);
        const charge = graph.d3Force("charge") as
          | { readonly strength?: (value: number) => unknown }
          | undefined;
        charge?.strength?.(-235);
        const linkForce = graph.d3Force("link") as
          | { readonly distance?: (value: (link: CapabilityGraphLink) => number) => unknown }
          | undefined;
        linkForce?.distance?.((link) => (link.role === "hierarchy" ? 64 : 108));
        const controls = graph.controls() as {
          dampingFactor?: number;
          enableDamping?: boolean;
          panSpeed?: number;
          rotateSpeed?: number;
          zoomSpeed?: number;
        };
        controls.enableDamping = true;
        controls.dampingFactor = 0.11;
        controls.rotateSpeed = 0.42;
        controls.zoomSpeed = 0.62;
        controls.panSpeed = 0.55;
        graphRef.current = graph;
        resizeObserver = new ResizeObserver(([entry]) => {
          if (entry !== undefined) {
            graph.width(Math.max(1, entry.contentRect.width));
            graph.height(Math.max(1, entry.contentRect.height));
          }
        });
        resizeObserver.observe(element);
        setSettled(false);
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
    setSettled(false);
    graphRef.current.graphData({
      nodes: [...sceneRef.current.nodes],
      links: [...sceneRef.current.links],
    });
    graphRef.current.d3ReheatSimulation();
    const graph = graphRef.current;
    const refit = window.setTimeout(
      () => frameScene(graph, sceneRef.current.nodes, prefersReducedMotion),
      prefersReducedMotion ? 0 : 350,
    );
    return () => window.clearTimeout(refit);
  }, [prefersReducedMotion, ready, sceneSignature]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!ready || graph === undefined || selectedEntityId === undefined) return;
    const node = sceneRef.current.nodes.find(({ entityId }) => entityId === selectedEntityId);
    if (node === undefined || node.x === undefined) return;
    focusCamera(graph, node, prefersReducedMotion);
  }, [prefersReducedMotion, ready, selectedEntityId]);

  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        data-render-state={
          failure === undefined ? (ready && settled ? "ready" : "loading") : "failed"
        }
        data-scene-signature={sceneSignature}
        data-testid="product-capability-graph"
        ref={containerRef}
      />
      <p className="sr-only" role="status">
        {failure ??
          (ready && settled ? "Interactive 3D product capability graph ready." : "Loading graph.")}
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
  const [learningMode, setLearningMode] = useState<ProductLearningMode>("explore");
  const [tourStep, setTourStep] = useState(0);
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
    const nodeFor = (
      entity: ProductHierarchyNode,
      role: GraphNodeRole,
      index = 0,
      total = 1,
    ): CapabilityGraphNode => {
      const angle = (index / Math.max(1, total)) * Math.PI * 2;
      const radius = role === "focus" ? 0 : role === "child" ? 62 : 104;
      return {
        id: entity.entityId,
        entityId: entity.entityId,
        kind: entity.kind,
        label: entity.canonicalName,
        ...(entity.description === undefined ? {} : { description: entity.description }),
        childCount: childCounts.get(entity.entityId) ?? 0,
        role,
        color: role === "focus" ? "#ffffff" : colorFor(entity),
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.62,
        z: role === "focus" ? 0 : Math.sin(angle * 2) * radius * 0.28,
      };
    };
    const visibleChildren = projection.children.filter(
      ({ entityId }) => !collapsedBranchIds.has(entityId),
    );
    return [
      nodeFor(projection.focus, "focus"),
      ...visibleChildren.map((entity, index) =>
        nodeFor(entity, "child", index, visibleChildren.length),
      ),
      ...projection.relatedEntities.map((related, index) => {
        const entity = related.entityId === undefined ? undefined : entities.get(related.entityId);
        return {
          id: related.id,
          ...(related.entityId === undefined ? {} : { entityId: related.entityId }),
          kind: related.kind,
          label: related.label,
          childCount: related.entityId === undefined ? 0 : (childCounts.get(related.entityId) ?? 0),
          role: "related" as const,
          color: entity === undefined ? "#a8a29e" : colorFor(entity),
          x: Math.cos((index / Math.max(1, projection.relatedEntities.length)) * Math.PI * 2) * 104,
          y: Math.sin((index / Math.max(1, projection.relatedEntities.length)) * Math.PI * 2) * 64,
          z: index % 2 === 0 ? 36 : -36,
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
  const path = projection.focus === undefined ? [] : [...projection.ancestors, projection.focus];
  const tourEntities = useMemo(() => {
    const byParent = new Map<string | undefined, ProductHierarchyNode[]>();
    for (const entity of map.entities)
      byParent.set(entity.parentId, [...(byParent.get(entity.parentId) ?? []), entity]);
    for (const candidates of byParent.values())
      candidates.sort(
        (left, right) =>
          (childCounts.get(right.entityId) ?? 0) - (childCounts.get(left.entityId) ?? 0) ||
          left.canonicalName.localeCompare(right.canonicalName),
      );
    const result: ProductHierarchyNode[] = [];
    let current = (byParent.get(undefined) ?? [])[0];
    const visited = new Set<string>();
    while (current !== undefined && !visited.has(current.entityId) && result.length < 6) {
      visited.add(current.entityId);
      result.push(current);
      current = (byParent.get(current.entityId) ?? [])[0];
    }
    return result;
  }, [childCounts, map.entities]);
  const viewRevision = useCallback((revision: number) => {
    dispatch({ type: "set-revision", revision });
    dispatch({ type: "set-lens", lens: "history", view: "revision-diff" });
    dispatch({ type: "close-dossier" });
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
  const activateTourStep = (nextStep: number) => {
    const bounded = Math.max(0, Math.min(tourEntities.length - 1, nextStep));
    const entity = tourEntities[bounded];
    if (entity === undefined) return;
    setLearningMode("tour");
    setTourStep(bounded);
    selectEntity(entity.entityId);
    explore(entity.entityId);
  };
  const rootId = path[0]?.entityId;
  const actionClass =
    "rounded-md border border-stone-700 px-2.5 py-1.5 text-xs text-stone-300 hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-teal-300 disabled:opacity-40";
  const analysisActions = (
    <>
      <button
        className={actionClass}
        disabled={state.compareIds.length !== 2}
        onClick={findPath}
        type="button"
      >
        Find path ({state.compareIds.length}/2)
      </button>
      <button className={actionClass} onClick={() => dependencyReach("impact")} type="button">
        Downstream impact
      </button>
      <button
        className={actionClass}
        onClick={() => dependencyReach("prerequisites")}
        type="button"
      >
        Prerequisites
      </button>
      <button
        className={actionClass}
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
        className={actionClass}
        disabled={selectedId === undefined}
        onClick={() =>
          selectedId !== undefined &&
          setCollapsedBranchIds((current) => new Set([...current, selectedId]))
        }
        type="button"
      >
        Collapse branch
      </button>
      <button
        className={actionClass}
        disabled={rootId === undefined || rootId === state.focusId}
        onClick={() => rootId !== undefined && explore(rootId)}
        type="button"
      >
        Product home
      </button>
    </>
  );

  return (
    <section
      aria-label="Interactive product digital twin"
      className="flex h-dvh min-h-[42rem] flex-col overflow-hidden bg-stone-950 text-stone-100"
      data-compare-count={state.compareIds.length}
      data-depth={focusEntity.depth}
      data-learning-mode={learningMode}
      data-lens={state.lens}
      data-reduced-motion={prefersReducedMotion}
      data-renderer="3d-force-graph"
      data-selected-entity={state.selectedEntityId}
      data-selected-relation={state.selectedRelationId}
      data-testid="product-capability-explorer"
      data-view={state.view}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-800 bg-stone-950 px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-[0.65rem] uppercase text-teal-300">
            Sarathi Product Digital Twin · revision {map.revision}
          </p>
          <h1 className="truncate text-balance text-lg font-semibold" id="product-map-title">
            Product capability explorer
          </h1>
        </div>
        <ol
          aria-label="Current product path"
          className="hidden min-w-0 flex-1 items-center justify-center gap-1 text-xs lg:flex"
        >
          {path.map((entity, index) => (
            <li className="flex min-w-0 items-center gap-1" key={entity.entityId}>
              {index === 0 ? null : <span className="text-stone-700">/</span>}
              <button
                aria-current={entity.entityId === state.focusId ? "page" : undefined}
                className="max-w-44 truncate rounded px-2 py-1 text-stone-400 hover:bg-stone-900 hover:text-white focus-visible:outline-2 focus-visible:outline-teal-300 aria-[current=page]:text-teal-200"
                onClick={() => explore(entity.entityId)}
                type="button"
              >
                {entity.canonicalName}
              </button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <fieldset className="flex rounded-lg border border-stone-800 p-1">
            <legend className="sr-only">Learning mode</legend>
            {(["explore", "explain", "tour"] as const).map((mode) => (
              <button
                aria-pressed={learningMode === mode}
                className="rounded-md px-2.5 py-1.5 text-xs capitalize text-stone-400 hover:text-white focus-visible:outline-2 focus-visible:outline-teal-300 aria-pressed:bg-teal-300 aria-pressed:text-stone-950"
                key={mode}
                onClick={() => (mode === "tour" ? activateTourStep(0) : setLearningMode(mode))}
                type="button"
              >
                {mode}
              </button>
            ))}
          </fieldset>
          <label className="sr-only" htmlFor="product-lens">
            Visual lens
          </label>
          <select
            className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-teal-300"
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
            className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-teal-300"
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
        </div>
      </header>

      <div className="product-twin-workspace">
        <ProductModelTree
          compareIds={state.compareIds}
          coverage={coverage}
          map={map}
          onCompare={(entityId) => selectEntity(entityId, true)}
          onExplore={explore}
          onIsolate={explore}
          onSelect={selectEntity}
          query={state.query}
          selectedEntityId={state.selectedEntityId ?? state.focusId}
          setQuery={(query) => dispatch({ type: "set-query", query })}
        />

        <section
          aria-label="Product model"
          className="relative min-h-0 overflow-hidden bg-stone-950"
          data-panel="model"
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
            <div className="absolute inset-0 bg-stone-950" />
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
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-3">
            {learningMode === "explain" ? (
              <article
                className="pointer-events-auto max-w-xl rounded-xl border border-stone-700 bg-stone-950/95 p-4 shadow-lg"
                data-testid="explain-panel"
              >
                <p className="font-mono text-[0.65rem] uppercase text-teal-300">
                  Explain this capability
                </p>
                <h2 className="mt-1 text-balance text-lg font-semibold">
                  {entities.get(selectedId ?? "")?.canonicalName ?? focusEntity.canonicalName}
                </h2>
                <p className="mt-2 text-pretty text-sm text-stone-300">
                  {dossier?.entity.description ??
                    entities.get(selectedId ?? "")?.description ??
                    "No governed explanation is available yet."}
                </p>
                <p className="mt-3 text-xs text-stone-500">
                  Use the synchronized tree and inspector to inspect structure, relationships,
                  delivery, and explicit gaps.
                </p>
              </article>
            ) : null}
            {learningMode === "tour" ? (
              <article
                className="pointer-events-auto max-w-xl rounded-xl border border-teal-800 bg-stone-950/95 p-4 shadow-lg"
                data-testid="guided-tour"
              >
                <p className="font-mono text-[0.65rem] uppercase text-teal-300">
                  Product orientation · {tourStep + 1}/{tourEntities.length}
                </p>
                <h2 className="mt-1 text-balance text-lg font-semibold">
                  {tourEntities[tourStep]?.canonicalName}
                </h2>
                <p className="mt-2 text-pretty text-sm text-stone-300">
                  {tourEntities[tourStep]?.description ??
                    "This step introduces the governed structural role of the selected entity."}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    className={actionClass}
                    disabled={tourStep === 0}
                    onClick={() => activateTourStep(tourStep - 1)}
                    type="button"
                  >
                    Previous
                  </button>
                  <button
                    className={actionClass}
                    disabled={tourStep >= tourEntities.length - 1}
                    onClick={() => activateTourStep(tourStep + 1)}
                    type="button"
                  >
                    Next
                  </button>
                  <button
                    className={actionClass}
                    onClick={() => setLearningMode("explore")}
                    type="button"
                  >
                    Exit tour
                  </button>
                </div>
              </article>
            ) : null}
          </div>
          <aside
            aria-label="Visual legend"
            className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-64 rounded-lg border border-stone-800 bg-stone-950/90 p-3 text-[0.65rem] text-stone-400"
          >
            <p className="font-semibold text-stone-200">{lens.label}</p>
            <p className="mt-1 line-clamp-2">{lens.description}</p>
            <p className="mt-2">
              {lens.legend.slice(0, 2).join(" · ")} · arrows show stored direction
            </p>
          </aside>
          {safeError === undefined ? null : (
            <p
              className="absolute bottom-3 right-3 z-20 max-w-sm rounded-lg border border-amber-300 bg-stone-950 p-3 text-xs text-amber-100"
              role="status"
            >
              {safeError}
            </p>
          )}
          <p aria-live="polite" className="sr-only">
            Selected {entities.get(selectedId ?? "")?.canonicalName ?? focusEntity.canonicalName}.{" "}
            {projection.children.length} immediate children and {projectedRelations.length} governed
            relationships are visible.
          </p>
        </section>

        <aside
          aria-label="Contextual inspector"
          className="min-h-0 border-l border-stone-800 bg-stone-950"
          data-panel="inspector"
        >
          {state.dossierOpen && dossier !== undefined ? (
            <FullDossier
              availability={availability}
              canMutate={canMutate}
              delivery={delivery}
              dossier={dossier}
              embedded
              history={history}
              map={map}
              onClose={() => dispatch({ type: "close-dossier" })}
              onSelectEntity={selectEntity}
              onSelectRelation={selectRelation}
              onViewRevision={viewRevision}
              relationCatalog={relationCatalog}
            />
          ) : (
            <CompactInspector
              analysisActions={analysisActions}
              delivery={delivery}
              dossier={dossier}
              loading={loading}
              map={map}
              onExplore={explore}
              onOpenDossier={() => dispatch({ type: "open-dossier" })}
              onSelectEntity={selectEntity}
              onSelectRelation={selectRelation}
              relation={selectedRelation}
              relationCatalog={relationCatalog}
              selectedEntityId={state.selectedEntityId ?? state.focusId}
            />
          )}
        </aside>
      </div>
    </section>
  );
};

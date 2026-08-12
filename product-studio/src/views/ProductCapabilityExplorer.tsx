"use client";

import type { ForceGraph3DInstance, LinkObject, NodeObject } from "3d-force-graph";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ProductHierarchyNode,
  type ProductMap,
  productExplorerProjection,
  productExplorerSearch,
  relationTypes,
} from "../domain/product-model";

type GraphNodeRole = "focus" | "child" | "related";

type CapabilityGraphNode = NodeObject & {
  readonly id: string;
  readonly entityId?: string;
  readonly kind: ProductHierarchyNode["kind"] | "external";
  readonly label: string;
  readonly description?: string;
  readonly childCount: number;
  readonly relationCount: number;
  readonly role: GraphNodeRole;
  readonly color: string;
};

type CapabilityGraphLink = LinkObject<CapabilityGraphNode> & {
  readonly id: string;
  readonly label: string;
  readonly role: "hierarchy" | "relation";
  readonly color: string;
};

type CapabilityGraph = ForceGraph3DInstance<CapabilityGraphNode, CapabilityGraphLink>;

type CapabilityGraphConstructor = new (
  element: HTMLElement,
  options?: {
    readonly controlType?: "trackball" | "orbit" | "fly";
    readonly rendererConfig?: { readonly alpha?: boolean; readonly antialias?: boolean };
  },
) => CapabilityGraph;

type StrengthForce = {
  readonly strength: (value: number) => unknown;
};

const kindLabel: Readonly<Record<CapabilityGraphNode["kind"], string>> = {
  product: "Product",
  area: "Product area",
  capability: "Capability",
  feature: "Feature",
  external: "Supporting link",
};

const areaPalette = ["#4ee7d0", "#7dd3fc", "#fbbf24", "#a7f3d0", "#fda4af", "#c4b5fd"] as const;

const relationEndpointId = (endpoint: ProductMap["relations"][number]["source"]): string =>
  endpoint.kind === "entity"
    ? endpoint.entityId
    : `external:${endpoint.referenceKind}:${endpoint.referenceId}`;

const nodeTextHeight = (node: CapabilityGraphNode): number => {
  if (node.role === "focus") return 10;
  if (node.kind === "product" || node.kind === "area") return 8;
  if (node.kind === "capability") return 6.5;
  return 5.5;
};

const focusCamera = (graph: CapabilityGraph, node: CapabilityGraphNode, reducedMotion: boolean) => {
  const distance = 110;
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const z = node.z ?? 0;
  const magnitude = Math.hypot(x, y, z) || 1;
  const ratio = 1 + distance / magnitude;
  graph.cameraPosition(
    { x: x * ratio, y: y * ratio, z: z * ratio },
    { x, y, z },
    reducedMotion ? 0 : 700,
  );
};

const GraphCanvas = ({
  links,
  nodes,
  onExplore,
  prefersReducedMotion,
}: {
  readonly links: readonly CapabilityGraphLink[];
  readonly nodes: readonly CapabilityGraphNode[];
  readonly onExplore: (entityId: string) => void;
  readonly prefersReducedMotion: boolean;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<CapabilityGraph | undefined>(undefined);
  const exploreRef = useRef(onExplore);
  const reducedMotionRef = useRef(prefersReducedMotion);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  useEffect(() => {
    exploreRef.current = onExplore;
  }, [onExplore]);

  useEffect(() => {
    reducedMotionRef.current = prefersReducedMotion;
  }, [prefersReducedMotion]);

  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;

    void Promise.all([import("3d-force-graph"), import("three-spritetext")])
      .then(([forceGraphModule, spriteTextModule]) => {
        if (disposed) return;
        const ForceGraph3D = forceGraphModule.default as unknown as CapabilityGraphConstructor;
        const SpriteText = spriteTextModule.default;
        const graph = new ForceGraph3D(element, {
          controlType: "orbit",
          rendererConfig: { alpha: true, antialias: true },
        });

        graph
          .backgroundColor("#080a0d")
          .showNavInfo(false)
          .enableNodeDrag(false)
          .nodeColor((node) => node.color)
          .nodeVal((node) => {
            if (node.role === "focus") return 11;
            return Math.max(2.5, Math.min(7, 2.5 + node.childCount * 0.65));
          })
          .nodeLabel(
            (node) =>
              `${kindLabel[node.kind]}: ${node.label}${node.childCount === 0 ? "" : ` · ${node.childCount} below`}`,
          )
          .nodeThreeObject((node) => {
            const sprite = new SpriteText(node.label);
            sprite.material.depthWrite = false;
            sprite.color = node.role === "related" ? "#d6d3d1" : node.color;
            sprite.textHeight = nodeTextHeight(node);
            sprite.fontFace = "IBM Plex Sans";
            sprite.fontWeight = node.role === "focus" ? "600" : "400";
            sprite.strokeColor = "#080a0d";
            sprite.strokeWidth = 0.6;
            sprite.padding = 2;
            sprite.center.y = -0.65;
            return sprite;
          })
          .nodeThreeObjectExtend(true)
          .linkColor((link) => link.color)
          .linkOpacity(0.28)
          .linkWidth((link) => (link.role === "relation" ? 1.4 : 0.45))
          .linkCurvature((link) => (link.role === "relation" ? 0.16 : 0))
          .linkLabel((link) => link.label)
          .linkDirectionalArrowLength((link) => (link.role === "relation" ? 3 : 0))
          .linkDirectionalArrowColor((link) => link.color)
          .linkDirectionalParticles((link) =>
            link.role === "relation" && !reducedMotionRef.current ? 1 : 0,
          )
          .linkDirectionalParticleColor((link) => link.color)
          .linkDirectionalParticleWidth(1.3)
          .linkDirectionalParticleSpeed(0.004)
          .linkThreeObjectExtend(true)
          .linkThreeObject((link) => {
            const sprite = new SpriteText(link.role === "relation" ? link.label : "");
            sprite.material.depthWrite = false;
            sprite.color = "#99f6e4";
            sprite.textHeight = 2.2;
            sprite.fontFace = "IBM Plex Mono";
            sprite.backgroundColor = false;
            sprite.strokeColor = "#080a0d";
            sprite.strokeWidth = 0.7;
            return sprite;
          })
          .linkPositionUpdate((object, { start, end }) => {
            Object.assign(object.position, {
              x: start.x + (end.x - start.x) / 2,
              y: start.y + (end.y - start.y) / 2,
              z: start.z + (end.z - start.z) / 2,
            });
          })
          .onNodeClick((node) => {
            if (node.entityId === undefined) return;
            focusCamera(graph, node, reducedMotionRef.current);
            exploreRef.current(node.entityId);
          })
          .onNodeHover((node) => {
            element.style.cursor = node?.entityId === undefined ? "grab" : "pointer";
          })
          .warmupTicks(80)
          .cooldownTicks(160)
          .onEngineStop(() => {
            graph.zoomToFit(reducedMotionRef.current ? 0 : 650, 120);
          });

        const charge = graph.d3Force("charge") as StrengthForce | undefined;
        charge?.strength(-190);

        graphRef.current = graph;
        resizeObserver = new ResizeObserver(([entry]) => {
          if (entry === undefined) return;
          graph.width(Math.max(1, entry.contentRect.width));
          graph.height(Math.max(1, entry.contentRect.height));
        });
        resizeObserver.observe(element);
        setReady(true);
      })
      .catch(() => {
        if (disposed) return;
        setFailure(
          "The 3D renderer could not start. Use the text navigator while WebGL availability is checked.",
        );
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      graphRef.current?._destructor();
      graphRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const graph = graphRef.current;
    if (graph === undefined) return;
    graph.graphData({ nodes: [...nodes], links: [...links] });
    graph.d3ReheatSimulation();
    const refit = window.setTimeout(
      () => graph.zoomToFit(prefersReducedMotion ? 0 : 650, 120),
      prefersReducedMotion ? 0 : 500,
    );
    return () => window.clearTimeout(refit);
  }, [links, nodes, prefersReducedMotion, ready]);

  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        data-testid="product-capability-graph"
        ref={containerRef}
      />
      <p className="sr-only" role="status">
        {failure ?? (ready ? "Interactive 3D product capability graph ready." : "Loading graph.")}
      </p>
      {failure === undefined ? null : (
        <p
          className="absolute bottom-20 left-1/2 z-20 max-w-lg -translate-x-1/2 rounded-md border border-amber-300 bg-stone-950 px-4 py-3 text-pretty text-sm text-amber-100 shadow-md"
          role="alert"
        >
          {failure}
        </p>
      )}
    </>
  );
};

export const ProductCapabilityExplorer = ({
  initialFocusId,
  initialQuery = "",
  initialRelationType,
  map,
}: {
  readonly initialFocusId?: string;
  readonly initialQuery?: string;
  readonly initialRelationType?: string;
  readonly map: ProductMap;
}) => {
  const defaultProjection = productExplorerProjection(
    map,
    initialFocusId === undefined ? {} : { focusEntityId: initialFocusId },
  );
  const availableRelationTypes = useMemo(() => relationTypes(map), [map]);
  const [focusId, setFocusId] = useState(defaultProjection.focus?.entityId);
  const [query, setQuery] = useState(initialQuery);
  const [relationType, setRelationType] = useState(
    availableRelationTypes.includes(initialRelationType ?? "") ? (initialRelationType ?? "") : "",
  );
  const [showRelations, setShowRelations] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(true);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  const explore = useCallback((entityId: string) => {
    setFocusId(entityId);
    setQuery("");
  }, []);

  const projection = useMemo(
    () =>
      productExplorerProjection(map, {
        ...(focusId === undefined ? {} : { focusEntityId: focusId }),
        includeRelations: showRelations,
        ...(relationType.length === 0 ? {} : { relationType }),
      }),
    [focusId, map, relationType, showRelations],
  );
  const searchResults = useMemo(() => productExplorerSearch(map, query), [map, query]);
  const entities = useMemo(
    () => new Map(map.entities.map((entity) => [entity.entityId, entity])),
    [map],
  );
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entity of map.entities) {
      if (entity.parentId === undefined) continue;
      counts.set(entity.parentId, (counts.get(entity.parentId) ?? 0) + 1);
    }
    return counts;
  }, [map]);
  const relationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const relation of map.relations) {
      for (const endpoint of [relation.source, relation.target]) {
        if (endpoint.kind !== "entity") continue;
        counts.set(endpoint.entityId, (counts.get(endpoint.entityId) ?? 0) + 1);
      }
    }
    return counts;
  }, [map]);
  const areaTones = useMemo(
    () =>
      new Map(
        map.entities
          .filter(({ kind }) => kind === "area")
          .toSorted((left, right) => left.canonicalName.localeCompare(right.canonicalName))
          .map(({ entityId }, index) => [entityId, index]),
      ),
    [map],
  );
  const colorFor = useCallback(
    (entity: ProductHierarchyNode): string => {
      const visited = new Set<string>();
      let current: ProductHierarchyNode | undefined = entity;
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

  const graphNodes = useMemo<readonly CapabilityGraphNode[]>(() => {
    if (projection.focus === undefined) return [];
    const nodeFor = (entity: ProductHierarchyNode, role: GraphNodeRole): CapabilityGraphNode => ({
      id: entity.entityId,
      entityId: entity.entityId,
      kind: entity.kind,
      label: entity.canonicalName,
      ...(entity.description === undefined ? {} : { description: entity.description }),
      childCount: childCounts.get(entity.entityId) ?? 0,
      relationCount: relationCounts.get(entity.entityId) ?? 0,
      role,
      color: role === "focus" ? "#ffffff" : colorFor(entity),
    });

    return [
      nodeFor(projection.focus, "focus"),
      ...projection.children.map((entity) => nodeFor(entity, "child")),
      ...projection.relatedEntities.map((related): CapabilityGraphNode => {
        const entity = related.entityId === undefined ? undefined : entities.get(related.entityId);
        return {
          id: related.id,
          ...(related.entityId === undefined ? {} : { entityId: related.entityId }),
          kind: related.kind,
          label: related.label,
          childCount: related.entityId === undefined ? 0 : (childCounts.get(related.entityId) ?? 0),
          relationCount:
            related.entityId === undefined ? 0 : (relationCounts.get(related.entityId) ?? 0),
          role: "related",
          color: entity === undefined ? "#a8a29e" : colorFor(entity),
        };
      }),
    ];
  }, [childCounts, colorFor, entities, projection, relationCounts]);

  const graphLinks = useMemo<readonly CapabilityGraphLink[]>(() => {
    if (projection.focus === undefined) return [];
    return [
      ...projection.children.map(
        (child): CapabilityGraphLink => ({
          id: `hierarchy:${projection.focus?.entityId}:${child.entityId}`,
          source: projection.focus?.entityId ?? "",
          target: child.entityId,
          label: "contains",
          role: "hierarchy",
          color: "#78716c",
        }),
      ),
      ...projection.relations.map(
        (relation): CapabilityGraphLink => ({
          id: `relation:${relation.id}`,
          source: relationEndpointId(relation.source),
          target: relationEndpointId(relation.target),
          label: relation.type.replaceAll("_", " "),
          role: "relation",
          color: "#2dd4bf",
        }),
      ),
    ];
  }, [projection]);

  if (projection.focus === undefined)
    return (
      <p className="min-h-dvh bg-stone-950 p-8 text-pretty text-sm text-stone-300">
        No authorized entity is available for visual exploration.
      </p>
    );

  const path = [...projection.ancestors, projection.focus];
  const parent = projection.ancestors.at(-1);
  const root = path[0];

  return (
    <section
      aria-label="Interactive 3D product capability graph"
      className="relative h-dvh min-h-[42rem] overflow-hidden bg-stone-950 text-stone-100"
      data-depth={projection.focus.depth}
      data-renderer="3d-force-graph"
      data-testid="product-capability-explorer"
    >
      <GraphCanvas
        links={graphLinks}
        nodes={graphNodes}
        onExplore={explore}
        prefersReducedMotion={prefersReducedMotion}
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-3 p-4 sm:p-6">
        <div className="pointer-events-auto max-w-2xl rounded-xl border border-stone-800 bg-stone-950/90 p-4 shadow-md">
          <p className="font-mono text-xs text-teal-300">Sarathi / revision {map.revision}</p>
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
                  aria-current={entity.entityId === focusId ? "page" : undefined}
                  className="rounded-md px-2 py-1 text-stone-300 hover:bg-stone-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 aria-[current=page]:bg-teal-300 aria-[current=page]:font-semibold aria-[current=page]:text-stone-950"
                  onClick={() => explore(entity.entityId)}
                  type="button"
                >
                  {entity.canonicalName}
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div className="pointer-events-auto flex gap-2 rounded-xl border border-stone-800 bg-stone-950/90 p-2 shadow-md">
          <button
            className="rounded-md px-3 py-2 text-xs font-semibold hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={root === undefined || root.entityId === projection.focus.entityId}
            onClick={() => root === undefined || explore(root.entityId)}
            type="button"
          >
            Product home
          </button>
          <button
            className="rounded-md px-3 py-2 text-xs font-semibold hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={parent === undefined}
            onClick={() => parent === undefined || explore(parent.entityId)}
            type="button"
          >
            Back one level
          </button>
        </div>
      </header>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-end justify-between gap-3 p-4 sm:p-6">
        <article className="pointer-events-auto max-w-sm rounded-xl border border-stone-800 bg-stone-950/90 p-4 shadow-md">
          <p className="font-mono text-xs text-teal-300">{kindLabel[projection.focus.kind]}</p>
          <h2 className="mt-1 text-balance text-lg font-semibold">
            {projection.focus.canonicalName}
          </h2>
          {projection.focus.description === undefined ? null : (
            <p className="mt-2 line-clamp-2 text-pretty text-xs leading-relaxed text-stone-300">
              {projection.focus.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-stone-400">
            <span>{projection.children.length} below</span>
            <span>{projection.relatedEntities.length} related</span>
            <a
              className="font-semibold text-stone-100 underline decoration-stone-600 underline-offset-4 hover:decoration-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
              href={`/admin/product-map?entity=${encodeURIComponent(projection.focus.entityId)}`}
            >
              Governed details
            </a>
          </div>
        </article>

        <div className="pointer-events-auto flex max-w-2xl flex-1 flex-wrap justify-end gap-2">
          <div className="relative min-w-64 flex-1 sm:max-w-sm">
            <label className="sr-only" htmlFor="capability-search">
              Find a product area, capability, or feature
            </label>
            <input
              autoComplete="off"
              className="w-full rounded-xl border border-stone-700 bg-stone-950/95 px-4 py-3 text-sm text-white shadow-md placeholder:text-stone-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
              id="capability-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a capability or feature"
              type="search"
              value={query}
            />
            {query.trim().length === 0 ? null : (
              <ul className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-72 overflow-y-auto rounded-xl border border-stone-700 bg-stone-950 p-2 shadow-md">
                {searchResults.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-stone-400">No authorized match</li>
                ) : (
                  searchResults.map((entity) => (
                    <li key={entity.entityId}>
                      <button
                        className="block w-full rounded-md px-3 py-2 text-left hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                        onClick={() => explore(entity.entityId)}
                        type="button"
                      >
                        <span className="block text-sm font-semibold text-white">
                          {entity.canonicalName}
                        </span>
                        <span className="mt-0.5 block font-mono text-xs text-stone-400">
                          {kindLabel[entity.kind]}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          <label className="sr-only" htmlFor="capability-relation-type">
            Relationship type
          </label>
          <select
            className="rounded-xl border border-stone-700 bg-stone-950/95 px-3 py-3 text-xs text-white shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:opacity-50"
            disabled={!showRelations}
            id="capability-relation-type"
            onChange={(event) => setRelationType(event.target.value)}
            value={relationType}
          >
            <option value="">All relationships</option>
            {availableRelationTypes.map((type) => (
              <option key={type} value={type}>
                {type.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <button
            aria-pressed={showRelations}
            className="rounded-xl border border-stone-700 bg-stone-950/95 px-3 py-3 text-xs font-semibold text-white shadow-md hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 aria-pressed:border-teal-300 aria-pressed:text-teal-200"
            onClick={() => setShowRelations((visible) => !visible)}
            type="button"
          >
            Relationships {showRelations ? "on" : "off"}
          </button>
          <details className="group relative">
            <summary className="cursor-pointer list-none rounded-xl border border-stone-700 bg-stone-950/95 px-3 py-3 text-xs font-semibold shadow-md hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300">
              Text navigator
            </summary>
            <div className="absolute bottom-full right-0 mb-2 max-h-80 w-72 overflow-y-auto rounded-xl border border-stone-700 bg-stone-950 p-3 shadow-md">
              <p className="text-pretty text-xs text-stone-400">
                Keyboard-accessible nodes in the current graph.
              </p>
              <ul className="mt-3 space-y-1">
                {projection.children.map((entity) => (
                  <li data-role="child" data-testid="capability-text-node" key={entity.entityId}>
                    <button
                      className="block w-full rounded-md px-3 py-2 text-left hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                      onClick={() => explore(entity.entityId)}
                      type="button"
                    >
                      <span className="block text-sm font-semibold">{entity.canonicalName}</span>
                      <span className="font-mono text-xs text-stone-500">
                        {kindLabel[entity.kind]}
                      </span>
                    </button>
                  </li>
                ))}
                {projection.relatedEntities.map((entity) => (
                  <li data-role="related" data-testid="capability-text-node" key={entity.id}>
                    {entity.entityId === undefined ? (
                      <span className="block px-3 py-2 text-sm text-stone-400">{entity.label}</span>
                    ) : (
                      <button
                        className="block w-full rounded-md px-3 py-2 text-left hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                        onClick={() => explore(entity.entityId ?? "")}
                        type="button"
                      >
                        <span className="block text-sm font-semibold">{entity.label}</span>
                        <span className="font-mono text-xs text-stone-500">Related</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
};

"use client";

import {
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type ProductHierarchyNode,
  type ProductMap,
  productExplorerProjection,
  productExplorerSearch,
  relationTypes,
} from "../domain/product-model";

type ExplorerNodeData = {
  readonly entityId?: string;
  readonly kind: ProductHierarchyNode["kind"] | "external";
  readonly label: string;
  readonly description?: string;
  readonly childCount: number;
  readonly relationCount: number;
  readonly role: "focus" | "child" | "related";
  readonly tone: number;
  readonly onExplore?: (entityId: string) => void;
};

type ExplorerNode = Node<ExplorerNodeData, "capabilityCloud">;

const kindLabel: Readonly<Record<ExplorerNodeData["kind"], string>> = {
  product: "Product",
  area: "Product area",
  capability: "Capability",
  feature: "Feature",
  external: "Supporting link",
};

const toneClasses = [
  "border-cyan-300 bg-cyan-50 text-cyan-950 shadow-cyan-950/20",
  "border-violet-300 bg-violet-50 text-violet-950 shadow-violet-950/20",
  "border-amber-300 bg-amber-50 text-amber-950 shadow-amber-950/20",
  "border-emerald-300 bg-emerald-50 text-emerald-950 shadow-emerald-950/20",
  "border-rose-300 bg-rose-50 text-rose-950 shadow-rose-950/20",
  "border-sky-300 bg-sky-50 text-sky-950 shadow-sky-950/20",
] as const;

const cloudClass = (data: ExplorerNodeData): string => {
  if (data.role === "focus")
    return "w-72 border-teal-300 bg-stone-950 text-white shadow-teal-950/40";
  if (data.kind === "external")
    return "w-44 border-stone-500 bg-stone-800 text-stone-100 shadow-stone-950/30";
  if (data.role === "related")
    return "w-48 border-dashed border-stone-400 bg-white text-stone-900 shadow-stone-950/20";
  const width = data.childCount >= 5 ? "w-64" : data.childCount >= 2 ? "w-56" : "w-48";
  return `${width} ${toneClasses[data.tone % toneClasses.length]}`;
};

const CapabilityCloudNode = ({ data }: NodeProps<ExplorerNode>) => {
  const interactive = data.entityId !== undefined && data.role !== "focus";
  const content = (
    <>
      <span className="block font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] opacity-65">
        {data.role === "related" ? `Related ${kindLabel[data.kind]}` : kindLabel[data.kind]}
      </span>
      <span className="mt-1 block text-balance text-sm font-semibold leading-snug">
        {data.label}
      </span>
      {data.childCount === 0 && data.relationCount === 0 ? null : (
        <span className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 font-mono text-[0.62rem] opacity-70">
          {data.childCount === 0 ? null : <span>{data.childCount} below</span>}
          {data.relationCount === 0 ? null : <span>{data.relationCount} linked</span>}
        </span>
      )}
    </>
  );

  return (
    <article
      className={`relative rounded-[2rem] border px-5 py-4 text-center shadow-xl transition-[border-color,box-shadow,transform] duration-200 motion-reduce:transition-none ${cloudClass(data)}`}
      data-kind={data.kind}
      data-role={data.role}
      data-testid="capability-cloud-node"
    >
      <Handle className="!size-2 !border-0 !bg-teal-300" position={Position.Top} type="target" />
      {interactive ? (
        <button
          aria-label={`Explore ${data.label}`}
          className="nodrag block w-full rounded-[1.5rem] text-inherit focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700"
          onClick={() => data.onExplore?.(data.entityId ?? "")}
          type="button"
        >
          {content}
        </button>
      ) : (
        content
      )}
      <Handle className="!size-2 !border-0 !bg-teal-300" position={Position.Bottom} type="source" />
    </article>
  );
};

const nodeTypes = { capabilityCloud: CapabilityCloudNode } as const;

const ellipsePosition = (
  index: number,
  count: number,
  radiusX: number,
  radiusY: number,
  offset = -Math.PI / 2,
) => {
  const angle = offset + (index / Math.max(count, 1)) * Math.PI * 2;
  return { x: Math.cos(angle) * radiusX, y: Math.sin(angle) * radiusY };
};

const relationEndpointId = (endpoint: ProductMap["relations"][number]["source"]): string =>
  endpoint.kind === "entity"
    ? endpoint.entityId
    : `external:${endpoint.referenceKind}:${endpoint.referenceId}`;

const CapabilityCanvas = ({
  edges,
  focus,
  nodes,
  prefersReducedMotion,
}: {
  readonly edges: readonly Edge[];
  readonly focus: ProductHierarchyNode;
  readonly nodes: readonly ExplorerNode[];
  readonly prefersReducedMotion: boolean;
}) => {
  const { fitView } = useReactFlow();
  const layoutKey = `${focus.entityId}:${nodes.map(({ id }) => id).join(",")}:${edges
    .map(({ id }) => id)
    .join(",")}`;

  useEffect(() => {
    if (layoutKey.length === 0) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ duration: prefersReducedMotion ? 0 : 180, padding: 0.18 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, layoutKey, prefersReducedMotion]);

  return (
    <ReactFlow
      ariaLabelConfig={{
        "controls.ariaLabel": "Capability map controls",
        "minimap.ariaLabel": "Capability map overview",
      }}
      autoPanOnNodeFocus
      colorMode="dark"
      edges={[...edges]}
      edgesFocusable
      fitView
      fitViewOptions={{ padding: 0.18 }}
      maxZoom={1.6}
      minZoom={0.18}
      nodeTypes={nodeTypes}
      nodes={[...nodes]}
      nodesConnectable={false}
      nodesDraggable={false}
      nodesFocusable
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#57534e" gap={28} size={1.2} />
      <MiniMap
        maskColor="rgba(12, 10, 9, 0.72)"
        nodeColor={({ data }) =>
          data.role === "focus" ? "#2dd4bf" : data.role === "related" ? "#a8a29e" : "#f5f5f4"
        }
        pannable
        zoomable
      />
      <Controls showInteractive={false} />
      <Panel
        className="max-w-xs rounded-2xl border border-stone-700 bg-stone-950/95 p-4 text-stone-100 shadow-2xl"
        position="bottom-left"
      >
        <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-teal-300">
          Current focus / {kindLabel[focus.kind]}
        </p>
        <p className="mt-1 text-sm font-semibold">{focus.canonicalName}</p>
        {focus.description === undefined ? null : (
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-stone-300">
            {focus.description}
          </p>
        )}
        <a
          className="nodrag mt-3 inline-flex rounded-full border border-stone-600 px-3 py-1.5 text-xs font-semibold text-white hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
          href={`/admin/product-map?entity=${encodeURIComponent(focus.entityId)}#dossier-title`}
        >
          Open full dossier
        </a>
      </Panel>
    </ReactFlow>
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
  const [focusId, setFocusId] = useState(defaultProjection.focus?.entityId);
  const [query, setQuery] = useState(initialQuery);
  const [relationType, setRelationType] = useState(initialRelationType ?? "");
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
  const availableRelationTypes = useMemo(() => relationTypes(map), [map]);

  const entities = useMemo(
    () => new Map(map.entities.map((entity) => [entity.entityId, entity])),
    [map],
  );
  const directChildCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entity of map.entities) {
      if (entity.parentId === undefined) continue;
      counts.set(entity.parentId, (counts.get(entity.parentId) ?? 0) + 1);
    }
    return counts;
  }, [map]);
  const relationCount = useMemo(() => {
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
  const toneFor = useCallback(
    (entity: ProductHierarchyNode): number => {
      const visited = new Set<string>();
      let current: ProductHierarchyNode | undefined = entity;
      while (current !== undefined && !visited.has(current.entityId)) {
        visited.add(current.entityId);
        if (current.kind === "area") return areaTones.get(current.entityId) ?? 0;
        current = current.parentId === undefined ? undefined : entities.get(current.parentId);
      }
      return 0;
    },
    [areaTones, entities],
  );

  const nodes = useMemo<readonly ExplorerNode[]>(() => {
    if (projection.focus === undefined) return [];
    const focus: ExplorerNode = {
      id: projection.focus.entityId,
      type: "capabilityCloud",
      position: { x: -144, y: -72 },
      data: {
        entityId: projection.focus.entityId,
        kind: projection.focus.kind,
        label: projection.focus.canonicalName,
        ...(projection.focus.description === undefined
          ? {}
          : { description: projection.focus.description }),
        childCount: directChildCount.get(projection.focus.entityId) ?? 0,
        relationCount: relationCount.get(projection.focus.entityId) ?? 0,
        role: "focus",
        tone: toneFor(projection.focus),
      },
      ariaLabel: `Current ${kindLabel[projection.focus.kind]}: ${projection.focus.canonicalName}`,
      draggable: false,
      selectable: false,
    };

    const firstRingCount = Math.min(projection.children.length, 8);
    const childNodes = projection.children.map((entity, index): ExplorerNode => {
      const outerRing = index >= firstRingCount;
      const ringIndex = outerRing ? index - firstRingCount : index;
      const ringCount = outerRing ? projection.children.length - firstRingCount : firstRingCount;
      const position = ellipsePosition(
        ringIndex,
        ringCount,
        outerRing ? 720 : 430,
        outerRing ? 430 : 265,
      );
      return {
        id: entity.entityId,
        type: "capabilityCloud",
        position: { x: position.x - 100, y: position.y - 54 },
        data: {
          entityId: entity.entityId,
          kind: entity.kind,
          label: entity.canonicalName,
          ...(entity.description === undefined ? {} : { description: entity.description }),
          childCount: directChildCount.get(entity.entityId) ?? 0,
          relationCount: relationCount.get(entity.entityId) ?? 0,
          role: "child",
          tone: toneFor(entity),
          onExplore: explore,
        },
        ariaLabel: `${kindLabel[entity.kind]}: ${entity.canonicalName}. Activate to explore.`,
        draggable: false,
      };
    });
    const relatedNodes = projection.relatedEntities.map((entity, index): ExplorerNode => {
      const position = ellipsePosition(index, projection.relatedEntities.length, 930, 570, 0);
      const relatedEntity =
        entity.entityId === undefined ? undefined : entities.get(entity.entityId);
      return {
        id: entity.id,
        type: "capabilityCloud",
        position: { x: position.x - 88, y: position.y - 48 },
        data: {
          ...(entity.entityId === undefined ? {} : { entityId: entity.entityId }),
          kind: entity.kind,
          label: entity.label,
          childCount:
            entity.entityId === undefined ? 0 : (directChildCount.get(entity.entityId) ?? 0),
          relationCount:
            entity.entityId === undefined ? 0 : (relationCount.get(entity.entityId) ?? 0),
          role: "related",
          tone: relatedEntity === undefined ? 0 : toneFor(relatedEntity),
          ...(entity.entityId === undefined ? {} : { onExplore: explore }),
        },
        ariaLabel: `Related ${kindLabel[entity.kind]}: ${entity.label}`,
        draggable: false,
      };
    });
    return [focus, ...childNodes, ...relatedNodes];
  }, [directChildCount, entities, explore, projection, relationCount, toneFor]);

  const edges = useMemo<readonly Edge[]>(() => {
    if (projection.focus === undefined) return [];
    const hierarchyEdges: Edge[] = projection.children.map((child) => ({
      id: `hierarchy:${projection.focus?.entityId}:${child.entityId}`,
      source: projection.focus?.entityId ?? "",
      target: child.entityId,
      type: "default",
      style: { stroke: "#78716c", strokeWidth: 1.25 },
      ariaLabel: `${child.canonicalName} is contained by ${projection.focus?.canonicalName ?? "focus"}`,
      selectable: false,
    }));
    const relationEdges: Edge[] = projection.relations.map((relation) => ({
      id: `relation:${relation.id}`,
      source: relationEndpointId(relation.source),
      target: relationEndpointId(relation.target),
      label: relation.type.replaceAll("_", " "),
      type: "smoothstep",
      animated: !prefersReducedMotion,
      markerEnd: { type: "arrowclosed", color: "#2dd4bf" },
      style: { stroke: "#2dd4bf", strokeWidth: 2 },
      labelStyle: { fill: "#f5f5f4", fontFamily: "IBM Plex Mono", fontSize: 10 },
      labelBgStyle: { fill: "#1c1917", fillOpacity: 0.92 },
      ariaLabel: `${relation.type.replaceAll("_", " ")} relation`,
    }));
    return [...hierarchyEdges, ...relationEdges];
  }, [prefersReducedMotion, projection]);

  if (projection.focus === undefined)
    return (
      <p className="rounded-xl border border-stone-300 bg-white p-6 text-sm text-stone-700">
        No authorized entity is available for visual exploration.
      </p>
    );

  const path = [...projection.ancestors, projection.focus];
  const parent = projection.ancestors.at(-1);
  const root = path[0];

  return (
    <section
      aria-label="Interactive capability constellation"
      className="overflow-hidden rounded-[1.5rem] border border-stone-800 bg-stone-950 shadow-2xl"
      data-depth={projection.focus.depth}
      data-testid="product-capability-explorer"
    >
      <div className="border-b border-stone-800 bg-stone-950 px-5 py-4 text-stone-100">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-teal-300">
              Capability constellation
            </p>
            <p className="mt-1 max-w-2xl text-sm text-stone-300">
              Select a cloud to move inward. Relationship lines reveal governed cross-links beyond
              the hierarchy.
            </p>
          </div>
          <dl className="flex gap-5 text-right text-xs">
            <div>
              <dt className="text-stone-500">Below</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-white tabular-nums">
                {projection.children.length}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">Related</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-white tabular-nums">
                {projection.relatedEntities.length}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className="rounded-full border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={root === undefined || root.entityId === projection.focus.entityId}
            onClick={() => root === undefined || explore(root.entityId)}
            type="button"
          >
            Product home
          </button>
          <button
            className="rounded-full border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={parent === undefined}
            onClick={() => parent === undefined || explore(parent.entityId)}
            type="button"
          >
            Back one level
          </button>
          <ol
            aria-label="Current product path"
            className="flex flex-wrap items-center gap-1 text-xs"
          >
            {path.map((entity, index) => (
              <li className="flex items-center gap-1" key={entity.entityId}>
                {index === 0 ? null : <span className="text-stone-600">/</span>}
                <button
                  aria-current={entity.entityId === focusId ? "page" : undefined}
                  className="rounded-full px-2 py-1 text-stone-300 hover:bg-stone-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 aria-[current=page]:bg-teal-300 aria-[current=page]:font-semibold aria-[current=page]:text-stone-950"
                  onClick={() => explore(entity.entityId)}
                  type="button"
                >
                  {entity.canonicalName}
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_auto_auto]">
          <div className="relative">
            <label className="sr-only" htmlFor="capability-search">
              Find a product area, capability, or feature
            </label>
            <input
              autoComplete="off"
              className="w-full rounded-full border border-stone-700 bg-stone-900 px-4 py-2.5 text-sm text-white placeholder:text-stone-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
              id="capability-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Jump to any capability or feature"
              type="search"
              value={query}
            />
            {query.trim().length === 0 ? null : (
              <ul className="absolute inset-x-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-stone-700 bg-stone-900 p-2 shadow-2xl">
                {searchResults.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-stone-400">No authorized match</li>
                ) : (
                  searchResults.map((entity) => (
                    <li key={entity.entityId}>
                      <button
                        className="block w-full rounded-xl px-3 py-2 text-left hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                        onClick={() => explore(entity.entityId)}
                        type="button"
                      >
                        <span className="block text-sm font-semibold text-white">
                          {entity.canonicalName}
                        </span>
                        <span className="mt-0.5 block font-mono text-[0.65rem] uppercase tracking-[0.12em] text-stone-400">
                          {kindLabel[entity.kind]}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <label className="grid gap-1 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-stone-400">
            Relation type
            <select
              className="min-w-48 rounded-full border border-stone-700 bg-stone-900 px-4 py-2 text-sm font-normal normal-case tracking-normal text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
              disabled={!showRelations}
              onChange={(event) => setRelationType(event.target.value)}
              value={relationType}
            >
              <option value="">All relationship types</option>
              {availableRelationTypes.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-pressed={showRelations}
            className="self-end rounded-full border border-stone-700 px-4 py-2.5 text-sm font-semibold text-white hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 aria-pressed:border-teal-300 aria-pressed:bg-teal-300 aria-pressed:text-stone-950"
            onClick={() => setShowRelations((visible) => !visible)}
            type="button"
          >
            Relationships {showRelations ? "on" : "off"}
          </button>
        </div>
      </div>

      <div className="h-[38rem] bg-stone-950 sm:h-[44rem]">
        <ReactFlowProvider>
          <CapabilityCanvas
            edges={edges}
            focus={projection.focus}
            nodes={nodes}
            prefersReducedMotion={prefersReducedMotion}
          />
        </ReactFlowProvider>
      </div>
    </section>
  );
};

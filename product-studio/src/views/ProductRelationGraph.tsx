"use client";

import {
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";

type GraphEntity = {
  readonly id: string;
  readonly kind: "product" | "area" | "capability" | "feature" | "external";
  readonly label: string;
};

type GraphRelation = {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly type: string;
};

type ProductNodeData = {
  readonly entityId?: string;
  readonly kind: GraphEntity["kind"];
  readonly label: string;
};

type ProductGraphNode = Node<ProductNodeData, "productEntity">;

const kindLabel: Readonly<Record<GraphEntity["kind"], string>> = {
  product: "Product",
  area: "Product area",
  capability: "Capability",
  feature: "Feature",
  external: "Supporting reference",
};

const kindRank: Readonly<Record<GraphEntity["kind"], number>> = {
  product: 0,
  area: 1,
  capability: 2,
  feature: 3,
  external: 4,
};

const ProductEntityNode = ({ data }: NodeProps<ProductGraphNode>) => (
  <article className="w-56 rounded-lg border border-stone-300 bg-white px-4 py-3 text-left shadow-md">
    <Handle className="!size-2 !border-0 !bg-teal-700" position={Position.Left} type="target" />
    <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-teal-800">
      {kindLabel[data.kind]}
    </p>
    {data.entityId === undefined ? (
      <p className="mt-1 text-sm font-semibold text-stone-800">{data.label}</p>
    ) : (
      <a
        className="nodrag mt-1 block text-sm font-semibold leading-snug text-stone-950 underline decoration-stone-300 underline-offset-4 hover:decoration-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        href={`/admin/product-map?entity=${encodeURIComponent(data.entityId)}#dossier-title`}
      >
        {data.label}
      </a>
    )}
    <Handle className="!size-2 !border-0 !bg-teal-700" position={Position.Right} type="source" />
  </article>
);

const nodeTypes = { productEntity: ProductEntityNode } as const;

const graphNodes = (entities: readonly GraphEntity[]): ProductGraphNode[] => {
  const lanes = new Map<GraphEntity["kind"], GraphEntity[]>();
  for (const entity of entities) {
    const lane = lanes.get(entity.kind) ?? [];
    lane.push(entity);
    lanes.set(entity.kind, lane);
  }

  const nodes: ProductGraphNode[] = [];
  for (const [kind, lane] of lanes) {
    lane.sort(
      (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
    );
    for (const [index, entity] of lane.entries()) {
      nodes.push({
        id: entity.id,
        type: "productEntity",
        position: { x: kindRank[kind] * 320, y: index * 124 },
        data: {
          ...(kind === "external" ? {} : { entityId: entity.id }),
          kind,
          label: entity.label,
        },
        ariaLabel: `${kindLabel[kind]}: ${entity.label}`,
        draggable: false,
      });
    }
  }
  return nodes;
};

const graphEdges = (relations: readonly GraphRelation[]): Edge[] =>
  relations.map((relation) => ({
    id: relation.id,
    source: relation.sourceId,
    target: relation.targetId,
    label: relation.type.replaceAll("_", " "),
    type: "smoothstep",
    markerEnd: { type: "arrowclosed", color: "#0f766e" },
    style: { stroke: "#0f766e", strokeWidth: 1.5 },
    labelStyle: { fill: "#292524", fontFamily: "IBM Plex Mono", fontSize: 11 },
    labelBgStyle: { fill: "#fafaf9", fillOpacity: 0.94 },
    ariaLabel: `${relation.type.replaceAll("_", " ")} relation`,
    selectable: true,
  }));

export const ProductRelationGraph = ({
  entities,
  relations,
}: {
  readonly entities: readonly GraphEntity[];
  readonly relations: readonly GraphRelation[];
}) => {
  if (relations.length === 0)
    return (
      <p className="rounded-lg border border-stone-300 bg-white p-5 text-sm text-stone-700">
        No authorized relations match this view.
      </p>
    );

  return (
    <section
      aria-label="Interactive typed product relationship graph"
      className="h-[36rem] overflow-hidden rounded-xl border border-stone-300 bg-stone-50 shadow-sm"
    >
      <ReactFlow
        ariaLabelConfig={{
          "controls.ariaLabel": "Relationship graph controls",
          "minimap.ariaLabel": "Relationship graph overview",
        }}
        autoPanOnNodeFocus
        edges={graphEdges(relations)}
        edgesFocusable
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.25}
        nodeTypes={nodeTypes}
        nodes={graphNodes(entities)}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#d6d3d1" gap={22} size={1} />
        <MiniMap
          maskColor="rgba(250, 250, 249, 0.72)"
          nodeColor={({ data }) => (data.kind === "external" ? "#78716c" : "#0f766e")}
          pannable
          zoomable
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
};

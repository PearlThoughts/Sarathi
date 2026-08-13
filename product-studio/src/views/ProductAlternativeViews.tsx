"use client";

import { useMemo } from "react";
import type { ProductLensDefinition, ProductViewId } from "../domain/product-exploration";
import type {
  ProductCoverage,
  ProductDelivery,
  ProductMap,
  ProductRelationCatalog,
} from "../domain/product-model";

const buttonClass =
  "block w-full rounded-lg border border-stone-800 p-3 text-left hover:border-teal-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 aria-[current=true]:border-teal-300 aria-[current=true]:bg-teal-950/40";

export const ProductAlternativeViews = ({
  coverage,
  delivery,
  historicalMap,
  lens,
  map,
  onSelectEntity,
  onSelectRelation,
  relationCatalog,
  selectedEntityId,
  selectedRelationId,
  view,
}: {
  readonly coverage?: ProductCoverage | undefined;
  readonly delivery?: ProductDelivery | undefined;
  readonly historicalMap?: ProductMap | undefined;
  readonly lens: ProductLensDefinition;
  readonly map: ProductMap;
  readonly onSelectEntity: (entityId: string) => void;
  readonly onSelectRelation: (relationId: string) => void;
  readonly relationCatalog: ProductRelationCatalog;
  readonly selectedEntityId?: string | undefined;
  readonly selectedRelationId?: string | undefined;
  readonly view: ProductViewId;
}) => {
  if (view === "graph") return null;
  return (
    <section
      aria-label={`${view.replaceAll("-", " ")} view`}
      className="absolute inset-3 z-10 overflow-auto rounded-xl border border-stone-800 bg-stone-950 p-5 shadow-xl"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-stone-800 pb-4">
        <div>
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-teal-300">
            Synchronized analytical view
          </p>
          <h2 className="mt-1 text-2xl font-semibold capitalize">{view.replaceAll("-", " ")}</h2>
        </div>
        <p className="max-w-xl text-pretty text-sm text-stone-400">{lens.description}</p>
      </div>
      {view === "hierarchy" || view === "list" ? (
        <HierarchyList map={map} onSelect={onSelectEntity} selectedEntityId={selectedEntityId} />
      ) : null}
      {view === "matrix" ? (
        <DependencyMatrix
          lens={lens}
          map={map}
          onSelectEntity={onSelectEntity}
          onSelectRelation={onSelectRelation}
          relationCatalog={relationCatalog}
          selectedRelationId={selectedRelationId}
        />
      ) : null}
      {view === "landscape" ? (
        <CoverageLandscape coverage={coverage} map={map} onSelect={onSelectEntity} />
      ) : null}
      {view === "timeline" ? <DeliveryTimeline delivery={delivery} /> : null}
      {view === "revision-diff" ? (
        <RevisionDiff current={map} historical={historicalMap} onSelect={onSelectEntity} />
      ) : null}
    </section>
  );
};

const HierarchyList = ({
  map,
  onSelect,
  selectedEntityId,
}: {
  readonly map: ProductMap;
  readonly onSelect: (entityId: string) => void;
  readonly selectedEntityId?: string | undefined;
}) => {
  const children = useMemo(() => {
    const value = new Map<string | undefined, ProductMap["entities"][number][]>();
    for (const entity of map.entities)
      value.set(entity.parentId, [...(value.get(entity.parentId) ?? []), entity]);
    for (const entries of value.values())
      entries.sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));
    return value;
  }, [map.entities]);
  const branch = (parentId: string | undefined, depth: number): React.ReactNode => (
    <ul
      className={
        depth === 0 ? "mt-5 space-y-2" : "ml-5 mt-2 space-y-2 border-l border-stone-800 pl-4"
      }
    >
      {(children.get(parentId) ?? []).map((entity) => (
        <li key={entity.entityId}>
          <button
            aria-current={entity.entityId === selectedEntityId}
            className={buttonClass}
            onClick={() => onSelect(entity.entityId)}
            style={{ paddingLeft: `${Math.min(depth, 4) * 0.45 + 0.75}rem` }}
            type="button"
          >
            <span className="font-semibold">{entity.canonicalName}</span>
            <span className="ml-2 font-mono text-[0.65rem] uppercase tracking-wider text-stone-500">
              {entity.kind} · depth {entity.depth}
            </span>
            <span className="mt-1 block text-xs text-stone-400">
              {entity.description ?? "No concise definition available."}
            </span>
          </button>
          {branch(entity.entityId, depth + 1)}
        </li>
      ))}
    </ul>
  );
  return (
    <div>
      <p className="mt-5 text-sm text-stone-400">
        Complete keyboard-accessible authorized hierarchy. Select an entity to synchronize the graph
        and inspector.
      </p>
      {branch(undefined, 0)}
    </div>
  );
};

const DependencyMatrix = ({
  lens,
  map,
  onSelectEntity,
  onSelectRelation,
  relationCatalog,
  selectedRelationId,
}: {
  readonly lens: ProductLensDefinition;
  readonly map: ProductMap;
  readonly onSelectEntity: (entityId: string) => void;
  readonly onSelectRelation: (relationId: string) => void;
  readonly relationCatalog: ProductRelationCatalog;
  readonly selectedRelationId?: string | undefined;
}) => {
  const entities = new Map(map.entities.map((entity) => [entity.entityId, entity]));
  const relations = map.relations.filter(
    (relation) =>
      lens.relationTypes.includes(relation.type) &&
      relation.source.kind === "entity" &&
      relation.target.kind === "entity",
  );
  if (relations.length === 0)
    return (
      <p className="mt-6 rounded-xl border border-stone-800 p-5 text-stone-400">
        No governed dependency relation is visible in this bounded projection.
      </p>
    );
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[42rem] border-separate border-spacing-y-2 text-left text-sm">
        <caption className="sr-only">Directed dependency relationship matrix</caption>
        <thead>
          <tr className="text-xs text-stone-500">
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Relationship</th>
            <th className="px-3 py-2">Target</th>
            <th className="px-3 py-2">State and validity</th>
          </tr>
        </thead>
        <tbody>
          {relations.map((relation) => {
            if (relation.source.kind !== "entity" || relation.target.kind !== "entity") return null;
            const semantics = relationCatalog.relations.find(({ type }) => type === relation.type);
            const source = entities.get(relation.source.entityId);
            const target = entities.get(relation.target.entityId);
            return (
              <tr
                aria-selected={relation.id === selectedRelationId}
                className="bg-stone-900/70 aria-selected:outline aria-selected:outline-2 aria-selected:outline-teal-300"
                key={relation.id}
              >
                <td className="rounded-l-lg p-3">
                  <button
                    className="font-semibold underline decoration-stone-600 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                    onClick={() =>
                      onSelectEntity(
                        relation.source.kind === "entity" ? relation.source.entityId : "",
                      )
                    }
                    type="button"
                  >
                    {source?.canonicalName ?? "Authorized entity"}
                  </button>
                </td>
                <td className="p-3">
                  <button
                    className="rounded-md px-2 py-1 text-teal-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                    onClick={() => onSelectRelation(relation.id)}
                    type="button"
                  >
                    {semantics?.label ?? relation.type.replaceAll("_", " ")} →
                  </button>
                </td>
                <td className="p-3">
                  <button
                    className="font-semibold underline decoration-stone-600 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                    onClick={() =>
                      onSelectEntity(
                        relation.target.kind === "entity" ? relation.target.entityId : "",
                      )
                    }
                    type="button"
                  >
                    {target?.canonicalName ?? "Authorized entity"}
                  </button>
                </td>
                <td className="rounded-r-lg p-3 text-xs text-stone-400">
                  {relation.registration} · {new Date(relation.validFrom).toLocaleDateString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const CoverageLandscape = ({
  coverage,
  map,
  onSelect,
}: {
  readonly coverage?: ProductCoverage | undefined;
  readonly map: ProductMap;
  readonly onSelect: (entityId: string) => void;
}) => {
  if (coverage === undefined)
    return <p className="mt-6 text-stone-400">Loading authorized coverage projection…</p>;
  const items = new Map(coverage.items.map((item) => [item.entityId, item]));
  const areas = map.entities.filter(({ kind }) => kind === "area");
  const descendants = (areaId: string) =>
    map.entities.filter((entity) => {
      let parentId = entity.parentId;
      const seen = new Set<string>();
      while (parentId !== undefined && !seen.has(parentId)) {
        if (parentId === areaId) return true;
        seen.add(parentId);
        parentId = map.entities.find(({ entityId }) => entityId === parentId)?.parentId;
      }
      return false;
    });
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {areas.map((area) => {
        const flagged = descendants(area.entityId).flatMap(
          (entity) => items.get(entity.entityId) ?? [],
        );
        const flags = [...new Set(flagged.flatMap(({ flags: value }) => value))];
        return (
          <button
            className={`${buttonClass} min-h-36`}
            key={area.entityId}
            onClick={() => onSelect(area.entityId)}
            type="button"
          >
            <span className="font-semibold">{area.canonicalName}</span>
            <span className="mt-2 block font-mono text-3xl tabular-nums">{flagged.length}</span>
            <span className="text-xs text-stone-500">flagged descendants</span>
            <span className="mt-4 flex flex-wrap gap-1">
              {flags.map((flag) => (
                <span
                  className="rounded-full border border-amber-900 px-2 py-1 text-[0.65rem] text-amber-100"
                  key={flag}
                >
                  {flag.replaceAll("_", " ")}
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
};

const DeliveryTimeline = ({ delivery }: { readonly delivery?: ProductDelivery | undefined }) =>
  delivery === undefined ? (
    <p className="mt-6 text-stone-400">
      Select an entity to load its authorized delivery timeline.
    </p>
  ) : (
    <div className="mt-6">
      <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {delivery.stages.map((stage, index) => (
          <li
            className={`relative rounded-xl border p-4 ${stage.state === "observed" ? "border-teal-700 bg-teal-950/30" : "border-stone-800 text-stone-500"}`}
            key={stage.stage}
          >
            <span className="font-mono text-[0.65rem] text-stone-500">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="mt-2 block text-xs font-semibold capitalize">
              {stage.stage.replaceAll("_", " ")}
            </span>
            <span className="mt-2 block text-xs">
              {stage.state.replaceAll("_", " ")} · {stage.supportingWorkCount}
            </span>
          </li>
        ))}
      </ol>
      <ul className="mt-7 space-y-3">
        {delivery.supportingWork.map((work) => (
          <li
            className="rounded-xl border border-stone-800 p-4"
            key={`${work.title}:${work.latestActivityAt}`}
          >
            <span className="font-semibold">{work.title}</span>
            <span className="mt-1 block text-sm text-stone-400">{work.summary}</span>
            <span className="mt-2 block text-xs text-stone-500">
              {new Date(work.latestActivityAt).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

const RevisionDiff = ({
  current,
  historical,
  onSelect,
}: {
  readonly current: ProductMap;
  readonly historical?: ProductMap | undefined;
  readonly onSelect: (entityId: string) => void;
}) => {
  if (historical === undefined)
    return (
      <p className="mt-6 rounded-xl border border-stone-800 p-5 text-stone-400">
        Choose “view graph at this revision” from an entity dossier to compare it with revision{" "}
        {current.revision}.
      </p>
    );
  const prior = new Map(historical.entities.map((entity) => [entity.entityId, entity]));
  const now = new Map(current.entities.map((entity) => [entity.entityId, entity]));
  const ids = [...new Set([...prior.keys(), ...now.keys()])];
  const changes = ids.flatMap((entityId) => {
    const before = prior.get(entityId);
    const after = now.get(entityId);
    if (before === undefined)
      return [
        {
          entityId,
          name: after?.canonicalName ?? "Authorized entity",
          change: "Added after selected revision",
        },
      ];
    if (after === undefined)
      return [{ entityId, name: before.canonicalName, change: "Removed or no longer visible" }];
    const values = [
      before.canonicalName !== after.canonicalName
        ? `Renamed from ${before.canonicalName}`
        : undefined,
      before.parentId !== after.parentId ? "Moved" : undefined,
      before.lifecycle !== after.lifecycle
        ? `Lifecycle ${before.lifecycle} → ${after.lifecycle}`
        : undefined,
    ].filter((value): value is string => value !== undefined);
    return values.length === 0
      ? []
      : [{ entityId, name: after.canonicalName, change: values.join(" · ") }];
  });
  return (
    <div className="mt-6">
      <p className="text-sm text-stone-400">
        Revision {historical.revision} compared with current revision {current.revision}.
      </p>
      {changes.length === 0 ? (
        <p className="mt-4 rounded-xl border border-stone-800 p-5 text-stone-400">
          No visible entity difference in the bounded projections.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {changes.map((change) => (
            <li key={change.entityId}>
              <button
                className={buttonClass}
                onClick={() => onSelect(change.entityId)}
                type="button"
              >
                <span className="font-semibold">{change.name}</span>
                <span className="mt-1 block text-sm text-stone-400">{change.change}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

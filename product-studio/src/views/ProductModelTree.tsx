"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductCoverage, ProductMap } from "../domain/product-model";

const kindGlyph = {
  product: "P",
  area: "A",
  capability: "C",
  feature: "F",
} as const;

export const ProductModelTree = ({
  coverage,
  map,
  compareIds,
  onCompare,
  onExplore,
  onIsolate,
  onSelect,
  query,
  selectedEntityId,
  setQuery,
}: {
  readonly coverage: ProductCoverage;
  readonly map: ProductMap;
  readonly compareIds: readonly string[];
  readonly onCompare: (entityId: string) => void;
  readonly onExplore: (entityId: string) => void;
  readonly onIsolate: (entityId: string) => void;
  readonly onSelect: (entityId: string) => void;
  readonly query: string;
  readonly selectedEntityId?: string | undefined;
  readonly setQuery: (query: string) => void;
}) => {
  const entities = useMemo(
    () => new Map(map.entities.map((entity) => [entity.entityId, entity])),
    [map.entities],
  );
  const children = useMemo(() => {
    const result = new Map<string | undefined, ProductMap["entities"][number][]>();
    for (const entity of map.entities)
      result.set(entity.parentId, [...(result.get(entity.parentId) ?? []), entity]);
    for (const entries of result.values())
      entries.sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));
    return result;
  }, [map.entities]);
  const coverageByEntity = useMemo(
    () => new Map(coverage.items.map((item) => [item.entityId, item])),
    [coverage.items],
  );
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(map.entities.filter(({ depth }) => depth < 2).map(({ entityId }) => entityId)),
  );

  useEffect(() => {
    if (selectedEntityId === undefined) return;
    const path = new Set<string>();
    let current = entities.get(selectedEntityId);
    while (current !== undefined && !path.has(current.entityId)) {
      path.add(current.entityId);
      current = current.parentId === undefined ? undefined : entities.get(current.parentId);
    }
    setExpandedIds((previous) => new Set([...previous, ...path]));
  }, [entities, selectedEntityId]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (entityId: string, visited = new Set<string>()): boolean => {
    if (visited.has(entityId)) return false;
    visited.add(entityId);
    const entity = entities.get(entityId);
    if (entity === undefined) return false;
    if (
      normalizedQuery === "" ||
      entity.canonicalName.toLocaleLowerCase().includes(normalizedQuery) ||
      entity.description?.toLocaleLowerCase().includes(normalizedQuery)
    )
      return true;
    return (children.get(entityId) ?? []).some((child) => matches(child.entityId, visited));
  };
  const toggle = (entityId: string) =>
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  const branch = (
    parentId: string | undefined,
    ancestorIds: ReadonlySet<string> = new Set(),
  ): React.ReactNode => (
    <ul className={parentId === undefined ? "space-y-1" : "ml-4 border-l border-stone-800 pl-2"}>
      {(children.get(parentId) ?? [])
        .filter(({ entityId }) => !ancestorIds.has(entityId))
        .filter(({ entityId }) => matches(entityId))
        .map((entity) => {
          const descendants = children.get(entity.entityId) ?? [];
          const expanded = expandedIds.has(entity.entityId) || normalizedQuery !== "";
          const coverageItem = coverageByEntity.get(entity.entityId);
          return (
            <li
              data-entity-id={entity.entityId}
              data-testid="product-tree-node"
              key={entity.entityId}
            >
              <div
                className="group grid grid-cols-[1.5rem_minmax(0,1fr)] items-start rounded-lg aria-[current=true]:bg-teal-950/60"
                aria-current={entity.entityId === selectedEntityId}
              >
                {descendants.length === 0 ? (
                  <span aria-hidden="true" className="mt-2.5 text-center text-stone-700">
                    ·
                  </span>
                ) : (
                  <button
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${entity.canonicalName}`}
                    className="mt-1 rounded p-1 text-stone-500 hover:text-stone-100 focus-visible:outline-2 focus-visible:outline-teal-300"
                    onClick={() => toggle(entity.entityId)}
                    type="button"
                  >
                    <span aria-hidden="true">{expanded ? "−" : "+"}</span>
                  </button>
                )}
                <button
                  aria-current={entity.entityId === selectedEntityId}
                  className="min-w-0 rounded-md px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-300"
                  data-testid="product-tree-select"
                  onClick={() => onSelect(entity.entityId)}
                  onDoubleClick={() => onExplore(entity.entityId)}
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded border border-stone-700 font-mono text-[0.6rem] text-stone-400"
                      title={entity.kind}
                    >
                      {kindGlyph[entity.kind]}
                    </span>
                    <span className="truncate text-sm font-medium text-stone-200">
                      {entity.canonicalName}
                    </span>
                  </span>
                  <span className="mt-1 flex items-center gap-2 pl-7 font-mono text-[0.62rem] text-stone-500">
                    <span>{descendants.length} contained</span>
                    {coverageItem?.flags.length ? (
                      <span>
                        △ {coverageItem.flags.length}
                        <span className="sr-only"> coverage warnings</span>
                      </span>
                    ) : null}
                    <span>
                      {entity.registration === "ratified" ? "●" : "○"}
                      <span className="sr-only"> {entity.registration} registration</span>
                    </span>
                  </span>
                </button>
              </div>
              {expanded && descendants.length > 0
                ? branch(entity.entityId, new Set([...ancestorIds, entity.entityId]))
                : null}
            </li>
          );
        })}
    </ul>
  );

  return (
    <aside
      aria-label="Product model tree"
      className="flex min-h-0 flex-col border-r border-stone-800 bg-stone-950"
      data-testid="product-model-tree"
    >
      <div className="border-b border-stone-800 p-3">
        <label className="text-xs font-semibold text-stone-300" htmlFor="capability-search">
          Find in product
        </label>
        <input
          autoComplete="off"
          className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm placeholder:text-stone-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
          id="capability-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Capability, feature, term…"
          type="search"
          value={query}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{branch(undefined)}</div>
      <div className="border-t border-stone-800 p-3 text-xs text-stone-500">
        <p>
          {map.entities.length} authorized entities in revision {map.revision}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className="rounded-md border border-stone-700 px-2 py-1 text-stone-300 hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-teal-300 disabled:opacity-40"
            disabled={selectedEntityId === undefined}
            onClick={() => selectedEntityId !== undefined && onExplore(selectedEntityId)}
            type="button"
          >
            Zoom to selected
          </button>
          <button
            className="rounded-md border border-stone-700 px-2 py-1 text-stone-300 hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-teal-300 disabled:opacity-40"
            disabled={selectedEntityId === undefined}
            onClick={() => selectedEntityId !== undefined && onIsolate(selectedEntityId)}
            type="button"
          >
            Isolate branch
          </button>
          <button
            aria-pressed={
              selectedEntityId === undefined ? false : compareIds.includes(selectedEntityId)
            }
            className="rounded-md border border-stone-700 px-2 py-1 text-stone-300 hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-teal-300 disabled:opacity-40 aria-pressed:border-teal-300 aria-pressed:text-teal-200"
            disabled={selectedEntityId === undefined}
            onClick={() => selectedEntityId !== undefined && onCompare(selectedEntityId)}
            type="button"
          >
            {selectedEntityId !== undefined && compareIds.includes(selectedEntityId)
              ? "Remove from comparison"
              : "Add to comparison"}
          </button>
        </div>
      </div>
    </aside>
  );
};

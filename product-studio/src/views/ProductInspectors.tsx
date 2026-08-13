"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ProductAvailability,
  ProductDelivery,
  ProductDossier,
  ProductEntityHistory,
  ProductMap,
  ProductRelation,
  ProductRelationCatalog,
} from "../domain/product-model";
import { RenameEntityForm } from "./RenameEntityForm";

const kindLabel = {
  product: "Product",
  area: "Product area",
  capability: "Capability",
  feature: "Feature",
} as const;

const displayValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "None";
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  return "Structured governed value";
};

const endpointName = (map: ProductMap, endpoint: ProductRelation["source"]): string => {
  if (endpoint.kind === "external")
    return `${endpoint.referenceKind.replaceAll("_", " ")} reference`;
  return (
    map.entities.find(({ entityId }) => entityId === endpoint.entityId)?.canonicalName ??
    "Authorized entity"
  );
};

export const CompactInspector = ({
  analysisActions,
  delivery,
  dossier,
  loading,
  map,
  onExplore,
  onOpenDossier,
  onSelectEntity,
  onSelectRelation,
  relation,
  relationCatalog,
  selectedEntityId,
}: {
  readonly analysisActions?: React.ReactNode;
  readonly delivery?: ProductDelivery | undefined;
  readonly dossier?: ProductDossier | undefined;
  readonly loading: boolean;
  readonly map: ProductMap;
  readonly onExplore: (entityId: string) => void;
  readonly onOpenDossier: () => void;
  readonly onSelectEntity: (entityId: string) => void;
  readonly onSelectRelation: (relationId: string) => void;
  readonly relation?: ProductRelation | undefined;
  readonly relationCatalog: ProductRelationCatalog;
  readonly selectedEntityId?: string | undefined;
}) => {
  const [section, setSection] = useState<"about" | "contains" | "relationships" | "delivery">(
    "about",
  );
  const selected = map.entities.find(({ entityId }) => entityId === selectedEntityId);
  useEffect(() => setSection(relation === undefined ? "about" : "relationships"), [relation]);
  if (relation !== undefined) {
    const semantics = relationCatalog.relations.find(({ type }) => type === relation.type);
    const sourceName = endpointName(map, relation.source);
    const targetName = endpointName(map, relation.target);
    const observedDeliveryStages =
      delivery?.stages.filter(({ state }) => state === "observed") ?? [];
    return (
      <article
        aria-labelledby="relation-inspector-title"
        className="h-full overflow-y-auto bg-stone-950 p-4"
      >
        <p className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-teal-300">
          Selected relationship
        </p>
        <h2 className="mt-2 text-balance text-lg font-semibold" id="relation-inspector-title">
          {sourceName} {semantics?.label ?? relation.type.replaceAll("_", " ")} {targetName}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-stone-300">
          {semantics?.definition ?? "A governed typed product relationship."}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-stone-500">Family</dt>
            <dd className="mt-1 capitalize">{semantics?.family ?? "product"}</dd>
          </div>
          <div>
            <dt className="text-stone-500">State</dt>
            <dd className="mt-1 capitalize">{relation.registration}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Valid from</dt>
            <dd className="mt-1">{new Date(relation.validFrom).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Created revision</dt>
            <dd className="mt-1 font-mono">{relation.createdRevision}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Valid to</dt>
            <dd className="mt-1">
              {relation.validTo === undefined
                ? "Open-ended"
                : new Date(relation.validTo).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Provenance class</dt>
            <dd className="mt-1 capitalize">{relation.sourceClass.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Audience-safe scope</dt>
            <dd className="mt-1 capitalize">
              {relation.sensitivity} · {relation.audience.length} scope
              {relation.audience.length === 1 ? "" : "s"}
            </dd>
          </div>
        </dl>
        <p className="mt-3 rounded-lg border border-stone-800 bg-stone-900/70 p-3 text-xs text-stone-300">
          Reverse: {targetName} {semantics?.reverseLabel ?? "relates to"} {sourceName}.
        </p>
        <div className="mt-3 grid gap-2 text-xs text-stone-300 sm:grid-cols-2">
          <p className="rounded-lg border border-stone-800 p-3">
            <span className="block text-stone-500">Variant qualifiers</span>
            Base relation; no qualifier scope is registered on this visible edge.
          </p>
          <p className="rounded-lg border border-stone-800 p-3">
            <span className="block text-stone-500">Supporting evidence coverage</span>
            Privacy-safe provenance metadata only; evidence bodies and hidden identifiers are not
            exposed here.
          </p>
          <p className="rounded-lg border border-stone-800 p-3 sm:col-span-2">
            <span className="block text-stone-500">Related authorized delivery context</span>
            {observedDeliveryStages.length === 0
              ? "No delivery stage is observed for the current graph focus."
              : `${observedDeliveryStages.map(({ stage }) => stage.replaceAll("_", " ")).join(", ")} observed for the current graph focus; this does not make the edge delivery evidence.`}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[relation.source, relation.target].map((endpoint) =>
            endpoint.kind === "entity" ? (
              <button
                className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                key={endpoint.entityId}
                onClick={() => onSelectEntity(endpoint.entityId)}
                type="button"
              >
                Select {endpointName(map, endpoint)}
              </button>
            ) : null,
          )}
        </div>
      </article>
    );
  }
  if (selected === undefined) return null;
  const children = map.entities.filter(({ parentId }) => parentId === selected.entityId);
  const visibleRelations = map.relations.filter(({ source, target }) =>
    [source, target].some(
      (endpoint) => endpoint.kind === "entity" && endpoint.entityId === selected.entityId,
    ),
  );
  const observedStages = delivery?.stages.filter(({ state }) => state === "observed") ?? [];
  const currentSprintWork =
    delivery?.supportingWork.filter(({ currentSprint }) => currentSprint) ?? [];
  const recentlyCompletedWork =
    delivery?.supportingWork.filter(({ recentlyCompletedSprint }) => recentlyCompletedSprint) ?? [];
  const quarterWork =
    delivery?.supportingWork.filter(({ quarterRelevant }) => quarterRelevant) ?? [];
  const quarterDate = new Date(delivery?.asOf ?? map.asOf);
  const quarterLabel = `Q${Math.floor(quarterDate.getUTCMonth() / 3) + 1}`;
  const tabs = [
    ["about", "About"],
    ["contains", `Contains ${children.length}`],
    ["relationships", `Relations ${visibleRelations.length}`],
    ["delivery", "Delivery"],
  ] as const;
  return (
    <article
      aria-labelledby="entity-inspector-title"
      className="flex h-full min-h-0 flex-col bg-stone-950"
      data-testid="contextual-inspector"
    >
      <div className="border-b border-stone-800 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[0.68rem] uppercase text-teal-300">
              {kindLabel[selected.kind]} · revision {selected.revision}
            </p>
            <h2 className="mt-1 text-balance text-xl font-semibold" id="entity-inspector-title">
              {selected.canonicalName}
            </h2>
          </div>
          <span className="rounded-full border border-stone-700 px-2 py-1 text-[0.65rem] capitalize text-stone-300">
            {selected.registration}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[0.68rem] text-stone-400">
          <span className="rounded border border-stone-800 px-2 py-1 capitalize">
            {selected.lifecycle}
          </span>
          <span className="rounded border border-stone-800 px-2 py-1">
            {children.length} contained
          </span>
          <span className="rounded border border-stone-800 px-2 py-1">
            {visibleRelations.length} governed relations
          </span>
        </div>
      </div>
      <div
        aria-label="Inspector sections"
        className="flex gap-1 overflow-x-auto border-b border-stone-800 p-2"
        role="tablist"
      >
        {tabs.map(([id, label]) => (
          <button
            aria-selected={section === id}
            className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs text-stone-400 hover:bg-stone-900 hover:text-stone-100 focus-visible:outline-2 focus-visible:outline-teal-300 aria-selected:bg-stone-800 aria-selected:text-white"
            key={id}
            onClick={() => setSection(id)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
        {section === "about" ? (
          <div>
            <p className="text-pretty text-sm leading-relaxed text-stone-300">
              {dossier?.entity.description ??
                selected.description ??
                (loading ? "Loading governed definition…" : "No governed definition is available.")}
            </p>
            <dl className="mt-5 space-y-4 text-sm">
              <div>
                <dt className="text-xs font-semibold text-stone-500">Business boundaries</dt>
                <dd className="mt-1 text-stone-300">
                  {dossier?.claims.filter(({ type }) => type === "exclusion").length
                    ? `${dossier.claims.filter(({ type }) => type === "exclusion").length} governed exclusion claim(s). Open the dossier to review them.`
                    : "No explicit exclusion is visible in this authorized dossier."}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-stone-500">Domain architecture</dt>
                <dd className="mt-1 text-stone-300">
                  {visibleRelations.some(({ type }) => type === "governed_by")
                    ? "Governed domain context is linked through visible relationships."
                    : "No governed DDD boundary is registered for this entity; the visualization does not infer one."}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-stone-500">Terminology</dt>
                <dd className="mt-1 text-stone-300">
                  {dossier?.aliases.length
                    ? dossier.aliases.map(({ value }) => value).join(", ")
                    : "No visible aliases or former names."}
                </dd>
              </div>
            </dl>
            {(dossier?.safeWarnings.length ?? 0) > 0 ? (
              <p className="mt-5 border-l-2 border-amber-300 pl-3 text-xs text-amber-100">
                {dossier?.safeWarnings[0]}
              </p>
            ) : null}
          </div>
        ) : null}
        {section === "contains" ? (
          children.length === 0 ? (
            <p className="text-sm text-stone-400">
              No immediate child capability or feature is visible.
            </p>
          ) : (
            <ul className="space-y-2">
              {children.map((child) => (
                <li key={child.entityId}>
                  <button
                    className="w-full rounded-lg border border-stone-800 p-3 text-left hover:border-teal-400 focus-visible:outline-2 focus-visible:outline-teal-300"
                    onClick={() => onSelectEntity(child.entityId)}
                    onDoubleClick={() => onExplore(child.entityId)}
                    type="button"
                  >
                    <span className="font-semibold text-stone-200">{child.canonicalName}</span>
                    <span className="mt-1 block text-xs capitalize text-stone-500">
                      {kindLabel[child.kind]} · {child.lifecycle}
                    </span>
                    {child.description === undefined ? null : (
                      <span className="mt-2 line-clamp-2 block text-xs text-stone-400">
                        {child.description}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {section === "relationships" ? (
          visibleRelations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-stone-700 p-4 text-sm text-stone-400">
              <p>No governed cross-relationship is visible for this entity.</p>
              <p className="mt-2 text-xs">
                This is a coverage gap, not proof that the capability has no dependencies.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {visibleRelations.map((visibleRelation) => {
                const semantics = relationCatalog.relations.find(
                  ({ type }) => type === visibleRelation.type,
                );
                const outgoing =
                  visibleRelation.source.kind === "entity" &&
                  visibleRelation.source.entityId === selected.entityId;
                const other = outgoing ? visibleRelation.target : visibleRelation.source;
                return (
                  <li key={visibleRelation.id}>
                    <button
                      className="w-full rounded-lg border border-stone-800 p-3 text-left hover:border-teal-400 focus-visible:outline-2 focus-visible:outline-teal-300"
                      data-testid="inspector-relation"
                      onClick={() => onSelectRelation(visibleRelation.id)}
                      type="button"
                    >
                      <span className="text-sm text-stone-200">
                        {outgoing
                          ? (semantics?.label ?? visibleRelation.type)
                          : (semantics?.reverseLabel ?? visibleRelation.type)}{" "}
                        <strong>{endpointName(map, other)}</strong>
                      </span>
                      <span className="mt-1 block text-xs capitalize text-stone-500">
                        {semantics?.family ?? "product"} · {visibleRelation.registration}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
        {section === "delivery" ? (
          delivery === undefined ? (
            <p className="text-sm text-stone-400">Loading authorized delivery context…</p>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["Active sprint", currentSprintWork.length],
                  ["Recent sprint", recentlyCompletedWork.length],
                  [`${quarterLabel} relevance`, quarterWork.length],
                ].map(([label, count]) => (
                  <div className="rounded-lg border border-stone-800 p-2" key={label}>
                    <span className="block font-mono text-xl tabular-nums text-stone-100">
                      {count}
                    </span>
                    <span className="mt-1 block text-[0.65rem] text-stone-500">{label}</span>
                  </div>
                ))}
              </div>
              <section>
                <h3 className="text-xs font-semibold text-stone-400">Observed stages</h3>
                {observedStages.length === 0 ? (
                  <p className="mt-2 text-sm text-stone-500">No delivery stage is observed.</p>
                ) : (
                  <ol className="mt-2 flex flex-wrap gap-1.5">
                    {observedStages.map(({ stage, supportingWorkCount }) => (
                      <li
                        className="rounded border border-teal-800 bg-teal-950/40 px-2 py-1 text-xs"
                        key={stage}
                      >
                        ● {stage.replaceAll("_", " ")} · {supportingWorkCount}
                      </li>
                    ))}
                  </ol>
                )}
                <p className="mt-3 text-xs text-stone-500">
                  Deployment, compatibility, verification, and acceptance are never collapsed.
                </p>
              </section>
              <section>
                <h3 className="text-xs font-semibold text-stone-400">Relevant work</h3>
                <ul className="mt-2 space-y-2">
                  {delivery.supportingWork.slice(0, 6).map((work) => (
                    <li
                      className="rounded-lg border border-stone-800 p-3"
                      key={`${work.title}:${work.latestActivityAt}`}
                    >
                      <p className="text-sm font-semibold text-stone-200">{work.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-stone-400">{work.summary}</p>
                      <p className="mt-2 text-[0.65rem] text-stone-500">
                        {work.currentSprint ? "Active sprint · " : ""}
                        {work.recentlyCompletedSprint ? "Recent sprint · " : ""}
                        {work.quarterRelevant ? `${quarterLabel} · ` : ""}
                        {work.blocked ? "Blocked" : work.lifecycle.replaceAll("_", " ")}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-stone-800 pt-4">
          <button
            className="rounded-lg bg-teal-300 px-3 py-2 text-xs font-semibold text-stone-950 hover:bg-teal-200 focus-visible:outline-2 focus-visible:outline-white"
            onClick={() => onExplore(selected.entityId)}
            type="button"
          >
            Explore this branch
          </button>
          <button
            className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-teal-300"
            onClick={onOpenDossier}
            type="button"
          >
            Open full dossier
          </button>
        </div>
        {analysisActions === undefined ? null : (
          <details className="mt-4 border-t border-stone-800 pt-4">
            <summary className="cursor-pointer text-xs font-semibold text-stone-300 focus-visible:outline-2 focus-visible:outline-teal-300">
              Analysis tools
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">{analysisActions}</div>
          </details>
        )}
      </div>
    </article>
  );
};

const dossierSections = [
  "overview",
  "structure",
  "relationships",
  "boundaries",
  "variants",
  "delivery",
  "governance",
  "history",
] as const;
type DossierSection = (typeof dossierSections)[number];

export const FullDossier = ({
  availability,
  canMutate,
  delivery,
  dossier,
  history,
  map,
  onClose,
  onSelectEntity,
  onSelectRelation,
  onViewRevision,
  relationCatalog,
  embedded = false,
}: {
  readonly availability?: ProductAvailability | undefined;
  readonly canMutate: boolean;
  readonly delivery?: ProductDelivery | undefined;
  readonly dossier: ProductDossier;
  readonly history?: ProductEntityHistory | undefined;
  readonly map: ProductMap;
  readonly onClose: () => void;
  readonly onSelectEntity: (entityId: string) => void;
  readonly onSelectRelation: (relationId: string) => void;
  readonly onViewRevision: (revision: number) => void;
  readonly relationCatalog: ProductRelationCatalog;
  readonly embedded?: boolean;
}) => {
  const [section, setSection] = useState<DossierSection>("overview");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  const path = useMemo(() => {
    const byId = new Map(map.entities.map((entity) => [entity.entityId, entity]));
    const result = [];
    let current = byId.get(dossier.entity.id);
    const visited = new Set<string>();
    while (current !== undefined && !visited.has(current.entityId)) {
      visited.add(current.entityId);
      result.unshift(current);
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }
    return result;
  }, [dossier.entity.id, map.entities]);
  const children = map.entities.filter(({ parentId }) => parentId === dossier.entity.id);
  const siblings = map.entities.filter(
    ({ parentId, entityId }) =>
      parentId === path.at(-2)?.entityId && entityId !== dossier.entity.id,
  );
  const claims = (type: ProductDossier["claims"][number]["type"]) =>
    dossier.claims.filter((claim) => claim.type === type);
  const descendants = (() => {
    const result: Array<ProductMap["entities"][number]> = [];
    const queued = [...children];
    const visited = new Set<string>();
    while (queued.length > 0) {
      const entity = queued.shift();
      if (entity === undefined || visited.has(entity.entityId)) continue;
      visited.add(entity.entityId);
      result.push(entity);
      queued.push(...map.entities.filter(({ parentId }) => parentId === entity.entityId));
    }
    return result;
  })();
  const subfeatures = descendants.filter(({ kind }) => kind === "feature");
  const relationshipGroups = [
    ...dossier.relations.reduce((groups, relation) => {
      const semantics = relationCatalog.relations.find(({ type }) => type === relation.type);
      const outgoing =
        relation.source.kind === "entity" && relation.source.entityId === dossier.entity.id;
      const group = `${semantics?.family ?? "product"}:${outgoing ? "outgoing" : "incoming"}`;
      groups.set(group, [...(groups.get(group) ?? []), relation]);
      return groups;
    }, new Map<string, ProductDossier["relations"][number][]>()),
  ].toSorted(([left], [right]) => left.localeCompare(right));
  const canonicalAliasId = dossier.aliases.find(({ kind }) => kind === "canonical")?.id;

  const content = (
    <section
      data-testid="full-dossier"
      className={
        embedded
          ? "h-full overflow-y-auto bg-stone-950 p-4 text-stone-100"
          : "h-full w-[min(58rem,calc(100vw-1rem))] min-w-80 resize-x overflow-y-auto border-l border-stone-700 bg-stone-950 p-5 text-stone-100 shadow-2xl sm:p-7"
      }
    >
      <header className="sticky top-0 z-10 -mx-2 flex items-start justify-between gap-4 bg-stone-950/95 px-2 pb-4 backdrop-blur">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-teal-300">
            Governed entity dossier · revision {dossier.revision}
          </p>
          <h2 className="mt-1 text-balance text-3xl font-semibold" id="full-dossier-title">
            {dossier.entity.canonicalName}
          </h2>
        </div>
        <button
          aria-label="Close full dossier"
          className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          Close
        </button>
      </header>
      <nav
        aria-label="Dossier sections"
        className="sticky top-[5.2rem] z-10 -mx-2 flex gap-1 overflow-x-auto border-y border-stone-800 bg-stone-950/95 px-2 py-2 backdrop-blur"
      >
        {dossierSections.map((candidate) => (
          <button
            aria-current={candidate === section ? "page" : undefined}
            className="whitespace-nowrap rounded-md px-3 py-2 text-xs capitalize text-stone-300 hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 aria-[current=page]:bg-teal-300 aria-[current=page]:font-semibold aria-[current=page]:text-stone-950"
            key={candidate}
            onClick={() => setSection(candidate)}
            type="button"
          >
            {candidate === "boundaries" ? "Behavior & boundaries" : candidate}
          </button>
        ))}
      </nav>
      <div className="py-7">
        {section === "overview" ? (
          <div className="space-y-6">
            <p className="max-w-3xl text-pretty text-lg leading-relaxed text-stone-200">
              {dossier.entity.description ?? "No ratified concise definition is available."}
            </p>
            <dl className="grid gap-4 sm:grid-cols-3">
              {[
                ["Kind", kindLabel[dossier.entity.kind]],
                ["Lifecycle", dossier.entity.lifecycle],
                ["Registration", dossier.entity.registration],
                ["Sensitivity", dossier.entity.sensitivity],
                [
                  "Audience",
                  `${dossier.entity.audience.length} authorized scope${dossier.entity.audience.length === 1 ? "" : "s"}`,
                ],
                ["Updated revision", dossier.entity.updatedRevision],
              ].map(([term, value]) => (
                <div className="rounded-xl border border-stone-800 p-4" key={term}>
                  <dt className="text-xs text-stone-500">{term}</dt>
                  <dd className="mt-1 font-semibold capitalize">{value}</dd>
                </div>
              ))}
            </dl>
            <section>
              <h3 className="text-lg font-semibold">Aliases and former names</h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {dossier.aliases.map((alias) => (
                  <li
                    className="rounded-full border border-stone-700 px-3 py-1 text-xs"
                    key={alias.id}
                  >
                    {alias.value} · {alias.kind.replaceAll("_", " ")}
                  </li>
                ))}
              </ul>
            </section>
            {canMutate && canonicalAliasId !== undefined ? (
              <RenameEntityForm
                canonicalName={dossier.entity.canonicalName}
                entityId={dossier.entity.id}
                revision={dossier.revision}
              />
            ) : null}
          </div>
        ) : null}
        {section === "structure" ? (
          <div className="space-y-7">
            <section>
              <h3 className="text-lg font-semibold">Complete parent path</h3>
              <ol className="mt-3 flex flex-wrap gap-2">
                {path.map((entity, index) => (
                  <li className="flex items-center gap-2" key={entity.entityId}>
                    {index === 0 ? null : (
                      <span aria-hidden="true" className="text-stone-600">
                        ›
                      </span>
                    )}
                    <button
                      className="rounded-md border border-stone-700 px-3 py-2 text-sm hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                      onClick={() => onSelectEntity(entity.entityId)}
                      type="button"
                    >
                      {entity.canonicalName}
                    </button>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h3 className="text-lg font-semibold">Immediate children · {children.length}</h3>
              <EntityButtons entities={children} onSelect={onSelectEntity} />
            </section>
            <section>
              <h3 className="text-lg font-semibold">Descendants · {descendants.length}</h3>
              <p className="mt-2 text-sm text-stone-400">
                {subfeatures.length} visible subfeature{subfeatures.length === 1 ? "" : "s"} in the
                current bounded graph. Explicit skipped-level metadata is shown only when
                registered; none is present in this projection.
              </p>
              <EntityButtons entities={subfeatures} onSelect={onSelectEntity} />
            </section>
            <section>
              <h3 className="text-lg font-semibold">Siblings · {siblings.length}</h3>
              <EntityButtons entities={siblings} onSelect={onSelectEntity} />
            </section>
          </div>
        ) : null}
        {section === "relationships" ? (
          <div>
            <h3 className="text-lg font-semibold">
              Typed directional relationships · {dossier.relations.length}
            </h3>
            <div className="mt-4 space-y-6">
              {relationshipGroups.map(([group, relations]) => {
                const [family, direction] = group.split(":");
                return (
                  <section key={group}>
                    <h4 className="font-mono text-xs uppercase tracking-wider text-stone-400">
                      {family} · {direction}
                    </h4>
                    <ul className="mt-2 space-y-3">
                      {(relations ?? []).map((relation) => {
                        const semantics = relationCatalog.relations.find(
                          ({ type }) => type === relation.type,
                        );
                        const outgoing =
                          relation.source.kind === "entity" &&
                          relation.source.entityId === dossier.entity.id;
                        const target = outgoing ? relation.target : relation.source;
                        return (
                          <li key={relation.id}>
                            <button
                              className="block w-full rounded-xl border border-stone-800 p-4 text-left hover:border-teal-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                              onClick={() => onSelectRelation(relation.id)}
                              type="button"
                            >
                              <span className="font-mono text-xs uppercase tracking-wider text-teal-300">
                                {semantics?.family ?? "product"} ·{" "}
                                {outgoing ? "outgoing" : "incoming"}
                              </span>
                              <span className="mt-1 block font-semibold">
                                {outgoing ? semantics?.label : semantics?.reverseLabel}{" "}
                                {endpointName(map, target)}
                              </span>
                              <span className="mt-2 block text-xs text-stone-400">
                                {relation.registration} · valid{" "}
                                {new Date(relation.validFrom).toLocaleDateString()}
                                {relation.validTo === undefined
                                  ? " onward"
                                  : ` to ${new Date(relation.validTo).toLocaleDateString()}`}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>
        ) : null}
        {section === "boundaries" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {(["definition", "behavior", "exclusion", "invariant", "availability"] as const).map(
              (type) => (
                <section className="rounded-xl border border-stone-800 p-5" key={type}>
                  <h3 className="text-lg font-semibold capitalize">
                    {type === "exclusion" ? "Exclusions" : type}
                  </h3>
                  {claims(type).length === 0 ? (
                    <p className="mt-3 text-sm text-stone-500">No visible governed claim.</p>
                  ) : (
                    <dl className="mt-3 space-y-4">
                      {claims(type).map((claim) => (
                        <div key={claim.id}>
                          <dt className="text-xs text-stone-500">{claim.predicate}</dt>
                          <dd className="mt-1 text-sm leading-relaxed">
                            {displayValue(claim.value)}
                          </dd>
                          <dd className="mt-1 text-xs text-stone-500">
                            {claim.registration} · {claim.evidenceReferenceCount} evidence reference
                            {claim.evidenceReferenceCount === 1 ? "" : "s"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>
              ),
            )}
          </div>
        ) : null}
        {section === "variants" ? (
          <div>
            <h3 className="text-lg font-semibold">Qualifier-scoped differences</h3>
            <p className="mt-2 text-sm text-stone-400">
              Variants modify governed fields without duplicating the feature hierarchy.
            </p>
            {dossier.variants.length === 0 ? (
              <p className="mt-6 rounded-xl border border-stone-800 p-5 text-stone-400">
                No visible variants apply to this entity.
              </p>
            ) : (
              <ul className="mt-5 space-y-4">
                {dossier.variants.map((variant) => (
                  <li className="rounded-xl border border-stone-800 p-5" key={variant.id}>
                    <div className="flex flex-wrap justify-between gap-3">
                      <h4 className="font-semibold">Precedence {variant.precedence}</h4>
                      <span className="text-xs capitalize text-stone-400">
                        {variant.registration}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-teal-200">
                      {Object.entries(variant.qualifiers)
                        .map(([axis, value]) => `${axis.replaceAll("_", " ")}: ${value}`)
                        .join(" · ")}
                    </p>
                    <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                      {Object.entries(variant.delta).map(([field, value]) => (
                        <div key={field}>
                          <dt className="text-xs text-stone-500">{field}</dt>
                          <dd className="mt-1 text-sm">{displayValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
            {availability === undefined ? null : (
              <p className="mt-5 rounded-xl border border-stone-800 p-4 text-sm">
                Resolved base at this context:{" "}
                {availability.resolvedVariant.appliedVariantIds.length} variant
                {availability.resolvedVariant.appliedVariantIds.length === 1 ? "" : "s"} applied.
              </p>
            )}
          </div>
        ) : null}
        {section === "delivery" ? <DeliverySection delivery={delivery} /> : null}
        {section === "governance" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-xl border border-stone-800 p-5">
              <h3 className="text-lg font-semibold">Coverage</h3>
              <dl className="mt-4 space-y-3">
                {[
                  ["Claims", dossier.claims.length],
                  ["References", dossier.externalReferences.length],
                  ["Variants", dossier.variants.length],
                  [
                    "Pending proposals",
                    dossier.proposals.filter(({ state }) => state === "pending").length,
                  ],
                ].map(([term, value]) => (
                  <div className="flex justify-between gap-4" key={term}>
                    <dt className="text-stone-400">{term}</dt>
                    <dd className="font-mono">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="rounded-xl border border-stone-800 p-5">
              <h3 className="text-lg font-semibold">Safe warnings</h3>
              {dossier.safeWarnings.length === 0 ? (
                <p className="mt-3 text-sm text-stone-400">No authorization-safe warnings.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm text-amber-100">
                  {dossier.safeWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-xl border border-stone-800 p-5 lg:col-span-2">
              <h3 className="text-lg font-semibold">Privacy-safe references</h3>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {dossier.externalReferences.map((reference) => (
                  <li className="rounded-lg bg-stone-900 p-4" key={reference.id}>
                    <span className="font-semibold capitalize">{reference.kind}</span>
                    <span className="mt-1 block text-xs text-stone-500">
                      {reference.sourceClass} · observed validity from{" "}
                      {new Date(reference.validFrom).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
        {section === "history" ? (
          <div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Identity evolution</h3>
                <p className="mt-1 text-sm text-stone-400">
                  Choose a revision to reconstruct the authorized graph at that point.
                </p>
              </div>
              <button
                className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                onClick={() => onViewRevision(dossier.revision)}
                type="button"
              >
                View current revision
              </button>
            </div>
            {history === undefined ? (
              <p className="mt-6 text-stone-400">Loading authorized history…</p>
            ) : history.events.length === 0 ? (
              <p className="mt-6 rounded-xl border border-stone-800 p-5 text-stone-400">
                No visible identity events.
              </p>
            ) : (
              <ol className="mt-6 border-l border-stone-700 pl-6">
                {history.events.map((event) => (
                  <li className="relative pb-6" key={event.id}>
                    <span
                      aria-hidden="true"
                      className="absolute -left-[1.82rem] top-1 h-3 w-3 rounded-full border-2 border-stone-950 bg-teal-300"
                    />
                    <p className="font-semibold capitalize">{event.type.replaceAll("_", " ")}</p>
                    <p className="mt-1 text-xs text-stone-400">
                      Revision {event.revision} · valid {new Date(event.validFrom).toLocaleString()}
                    </p>
                    <button
                      className="mt-2 text-xs font-semibold text-teal-200 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                      onClick={() => onViewRevision(event.revision)}
                      type="button"
                    >
                      View graph at this revision
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
  if (embedded)
    return (
      <section aria-labelledby="full-dossier-title" className="h-full">
        {content}
      </section>
    );
  return (
    <div
      aria-labelledby="full-dossier-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-stone-950/70 backdrop-blur-sm"
      role="dialog"
    >
      {content}
    </div>
  );
};

const EntityButtons = ({
  entities,
  onSelect,
}: {
  readonly entities: ProductMap["entities"];
  readonly onSelect: (entityId: string) => void;
}) =>
  entities.length === 0 ? (
    <p className="mt-3 text-sm text-stone-500">None visible.</p>
  ) : (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
      {entities.map((entity) => (
        <li key={entity.entityId}>
          <button
            className="block w-full rounded-lg border border-stone-800 p-3 text-left hover:border-teal-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
            onClick={() => onSelect(entity.entityId)}
            type="button"
          >
            <span className="font-semibold">{entity.canonicalName}</span>
            <span className="mt-1 block text-xs text-stone-500">{kindLabel[entity.kind]}</span>
          </button>
        </li>
      ))}
    </ul>
  );

const DeliverySection = ({ delivery }: { readonly delivery?: ProductDelivery | undefined }) => {
  if (delivery === undefined)
    return <p className="text-stone-400">Loading authorized delivery projection…</p>;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Delivery stages</h3>
          <p className="mt-1 text-sm text-stone-400">
            Observed stages remain distinct. Missing evidence is shown as not observed.
          </p>
        </div>
        <span className="rounded-full border border-stone-700 px-3 py-1 text-xs capitalize">
          {delivery.availability}
        </span>
      </div>
      <ol className="mt-6 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {delivery.stages.map((stage) => (
          <li
            className={`rounded-xl border p-3 ${stage.state === "observed" ? "border-teal-700 bg-teal-950/40" : "border-stone-800 text-stone-500"}`}
            key={stage.stage}
          >
            <span aria-hidden="true">{stage.state === "observed" ? "●" : "○"}</span>
            <span className="ml-2 text-xs font-semibold capitalize">
              {stage.stage.replaceAll("_", " ")}
            </span>
            <span className="mt-2 block font-mono text-xs">
              {stage.supportingWorkCount} records
            </span>
          </li>
        ))}
      </ol>
      <section className="mt-8">
        <h3 className="text-lg font-semibold">
          Supporting work · {delivery.supportingWork.length}
        </h3>
        <ul className="mt-4 space-y-3">
          {delivery.supportingWork.map((work) => (
            <li
              className="rounded-xl border border-stone-800 p-4"
              key={`${work.title}:${work.latestActivityAt}`}
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h4 className="font-semibold">{work.title}</h4>
                <span className="text-xs capitalize text-stone-400">
                  {work.lifecycle.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-2 text-sm text-stone-300">{work.summary}</p>
              <p className="mt-2 text-xs text-stone-500">
                {work.blocked ? "Blocked · " : ""}
                {work.currentSprint ? "Active sprint · " : ""}
                {work.recentlyCompletedSprint ? "Recently completed · " : ""}
                {work.quarterRelevant ? "Current-quarter relevance · " : ""}
                {new Date(work.latestActivityAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      </section>
      {delivery.safeWarnings.map((warning) => (
        <p className="mt-4 border-l-2 border-amber-300 pl-3 text-xs text-amber-100" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  );
};

import type { AdminViewServerProps } from "payload";
import type { ReactNode } from "react";
import {
  type ProductCoverage,
  type ProductDossier,
  type ProductHierarchyNode,
  type ProductMap,
  productMapMatching,
  productMapRows,
  relationTypes,
} from "../domain/product-model";
import { createSarathiProductModelClientFromEnvironment } from "../server/sarathi-product-model-client";
import { createUserBoundSarathiCredentialProvider } from "../server/user-bound-sarathi-credentials";
import { ProductCapabilityExplorer } from "./ProductCapabilityExplorer";
import { ProductStudioLoginRedirect } from "./ProductStudioLoginRedirect";
import { RenameEntityForm } from "./RenameEntityForm";

const PRODUCT_MAP_PATH = "/admin/product-map";
const preservedProductMapParams = ["depth", "relation", "entity", "q"] as const;

const scalar = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const boundedDepth = (value: string | undefined): number => {
  const parsed = Number(value ?? "4");
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : 4;
};

const productMapReturnPath = (searchParams: AdminViewServerProps["searchParams"]): string => {
  const target = new URLSearchParams();
  for (const key of preservedProductMapParams) {
    const value = scalar(searchParams?.[key]);
    if (value !== undefined && value.length > 0) target.set(key, value);
  }
  const query = target.toString();
  return query.length === 0 ? PRODUCT_MAP_PATH : `${PRODUCT_MAP_PATH}?${query}`;
};

const loginPathFor = (returnPath: string): string =>
  `/admin/login?redirect=${encodeURIComponent(returnPath)}`;

const mutationAvailable = (payloadUserId: string): boolean => {
  try {
    createUserBoundSarathiCredentialProvider().resolve(payloadUserId);
    return true;
  } catch {
    return false;
  }
};

const labelForKind: Readonly<Record<ProductHierarchyNode["kind"], string>> = {
  product: "Product",
  area: "Product area",
  capability: "Capability",
  feature: "Feature",
};

const toneForLifecycle: Readonly<Record<ProductHierarchyNode["lifecycle"], string>> = {
  planned: "border-sky-300 bg-sky-50 text-sky-900",
  available: "border-teal-300 bg-teal-50 text-teal-900",
  deprecated: "border-amber-300 bg-amber-50 text-amber-950",
  retired: "border-stone-300 bg-stone-100 text-stone-700",
  unknown: "border-stone-300 bg-white text-stone-700",
};

const EntityLink = ({ node }: { readonly node: ProductHierarchyNode }) => (
  <a
    className="rounded-sm font-semibold text-stone-950 underline decoration-stone-400 underline-offset-4 hover:decoration-stone-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700"
    href={`/admin/product-map?entity=${encodeURIComponent(node.entityId)}`}
  >
    {node.canonicalName}
  </a>
);

const Hierarchy = ({ map }: { readonly map: ProductMap }) => {
  const children = new Map<string | undefined, ProductHierarchyNode[]>();
  for (const node of map.entities) {
    const siblings = children.get(node.parentId) ?? [];
    children.set(node.parentId, [...siblings, node]);
  }
  for (const siblings of children.values())
    siblings.sort(
      (left, right) =>
        left.canonicalName.localeCompare(right.canonicalName) ||
        left.entityId.localeCompare(right.entityId),
    );

  const branch = (parentId: string | undefined, visited: ReadonlySet<string>): ReactNode => {
    const nodes = children.get(parentId) ?? [];
    if (nodes.length === 0) return null;
    return (
      <ol
        className={
          parentId === undefined ? "space-y-3" : "mt-3 space-y-3 border-l border-stone-300 pl-5"
        }
      >
        {nodes.map((node) => {
          const cyclic = visited.has(node.entityId);
          return (
            <li
              className="rounded-md border border-stone-200 bg-white p-4 shadow-sm"
              key={node.entityId}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-stone-500">{labelForKind[node.kind]}</p>
                  <EntityLink node={node} />
                </div>
                <span
                  className={`rounded-full border px-2 py-1 text-xs font-semibold ${toneForLifecycle[node.lifecycle]}`}
                >
                  {node.lifecycle}
                </span>
              </div>
              {node.description === undefined ? null : (
                <p className="mt-2 max-w-3xl text-pretty text-sm text-stone-700">
                  {node.description}
                </p>
              )}
              {cyclic ? (
                <p className="mt-3 text-sm font-semibold text-red-800" role="alert">
                  This branch contains an invalid hierarchy cycle.
                </p>
              ) : (
                branch(node.entityId, new Set([...visited, node.entityId]))
              )}
            </li>
          );
        })}
      </ol>
    );
  };

  return branch(undefined, new Set());
};

const RegistryTable = ({ map }: { readonly map: ProductMap }) => (
  <div className="overflow-x-auto rounded-md border border-stone-300 bg-white shadow-sm">
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">
        Authorized product registry entities and their hierarchy paths
      </caption>
      <thead className="bg-stone-100 text-stone-800">
        <tr>
          <th className="px-4 py-3 font-semibold" scope="col">
            Entity
          </th>
          <th className="px-4 py-3 font-semibold" scope="col">
            Kind
          </th>
          <th className="px-4 py-3 font-semibold" scope="col">
            Path
          </th>
          <th className="px-4 py-3 font-semibold" scope="col">
            Lifecycle
          </th>
          <th className="px-4 py-3 font-semibold tabular-nums" scope="col">
            Revision
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-stone-200">
        {productMapRows(map).map((row) => (
          <tr className="align-top hover:bg-stone-50 focus-within:bg-stone-50" key={row.entityId}>
            <th className="px-4 py-3 font-normal" scope="row">
              <EntityLink node={row} />
            </th>
            <td className="px-4 py-3 text-stone-700">{labelForKind[row.kind]}</td>
            <td className="break-words px-4 py-3 text-pretty text-stone-700">
              {row.path.join(" / ")}
            </td>
            <td className="px-4 py-3 text-stone-700">{row.lifecycle}</td>
            <td className="px-4 py-3 font-mono text-stone-700 tabular-nums">{row.revision}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const RelationList = ({
  map,
  selected,
}: {
  readonly map: ProductMap;
  readonly selected?: string;
}) => {
  const entities = new Map(map.entities.map((entity) => [entity.entityId, entity.canonicalName]));
  const relations = map.relations.filter(({ type }) => selected === undefined || type === selected);
  return relations.length === 0 ? (
    <p className="rounded-md border border-stone-300 bg-white p-4 text-pretty text-sm text-stone-700">
      No authorized relations match this filter. Clear the relation filter to inspect the full map.
    </p>
  ) : (
    <ul className="space-y-2">
      {relations.map((relation) => {
        const source =
          relation.source.kind === "entity"
            ? entities.get(relation.source.entityId)
            : relation.source.referenceId;
        const target =
          relation.target.kind === "entity"
            ? entities.get(relation.target.entityId)
            : relation.target.referenceId;
        return (
          <li
            className="rounded-md border border-stone-200 bg-white px-4 py-3 text-sm shadow-sm"
            key={relation.id}
          >
            <span className="break-words font-semibold text-stone-950">
              {source ?? "Unavailable source"}
            </span>{" "}
            <span className="font-mono text-xs text-teal-800">{relation.type}</span>{" "}
            <span className="break-words font-semibold text-stone-950">
              {target ?? "Unavailable target"}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

const CoverageReview = ({ coverage }: { readonly coverage: ProductCoverage }) => (
  <details className="group rounded-xl border border-stone-300 bg-white shadow-sm">
    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 rounded-xl px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
      <span>
        <span className="block text-lg font-semibold" id="coverage-heading">
          Product-owner review queue
        </span>
        <span className="mt-1 block text-sm text-stone-600">
          Metadata gaps and unresolved coverage; evidence bodies are never shown.
        </span>
      </span>
      <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 font-mono text-xs font-semibold text-amber-950 tabular-nums">
        {coverage.items.length} items
      </span>
    </summary>
    <div className="border-t border-stone-200 p-5">
      {coverage.items.length === 0 ? (
        <p className="rounded-md border border-stone-300 bg-stone-50 p-4 text-pretty text-sm text-stone-700">
          No authorized coverage gaps were returned for this workspace revision.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {coverage.items.map((item) => (
            <li
              className="rounded-md border border-stone-300 bg-white p-4 shadow-sm"
              key={item.entityId}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <a
                  className="font-semibold text-stone-950 underline decoration-stone-400 underline-offset-4 hover:decoration-stone-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700"
                  href={`/admin/product-map?entity=${encodeURIComponent(item.entityId)}`}
                >
                  {item.canonicalName}
                </a>
                <span className="font-mono text-xs text-stone-500">{labelForKind[item.kind]}</span>
              </div>
              <ul
                aria-label={`Coverage flags for ${item.canonicalName}`}
                className="mt-3 flex flex-wrap gap-2"
              >
                {item.flags.map((flag) => (
                  <li
                    className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 font-mono text-xs text-amber-950"
                    key={flag}
                  >
                    {flag.replaceAll("_", " ")}
                  </li>
                ))}
              </ul>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-stone-500">Claims</dt>
                  <dd className="font-mono tabular-nums">{item.claimCount}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">References</dt>
                  <dd className="font-mono tabular-nums">{item.referenceCount}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Variants</dt>
                  <dd className="font-mono tabular-nums">{item.variantCount}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      {coverage.page.truncated ? (
        <p className="mt-3 text-pretty text-sm text-amber-900" role="status">
          Coverage results are bounded. Refine the review through Sarathi before making a product
          decision.
        </p>
      ) : null}
    </div>
  </details>
);

const Dossier = ({
  dossier,
  canMutate,
}: {
  readonly dossier: ProductDossier;
  readonly canMutate: boolean;
}) => {
  const canonicalAliasId = dossier.aliases.find(({ kind }) => kind === "canonical")?.id;
  return (
    <aside
      aria-labelledby="dossier-title"
      className="h-fit rounded-md border border-stone-300 bg-stone-950 p-6 text-stone-100 shadow-md xl:sticky xl:top-6"
    >
      <p className="font-mono text-xs text-teal-300">{labelForKind[dossier.entity.kind]} dossier</p>
      <h2 className="mt-2 text-balance text-2xl font-semibold" id="dossier-title">
        {dossier.entity.canonicalName}
      </h2>
      <p className="mt-3 text-pretty text-sm text-stone-300">
        {dossier.entity.description ?? "No ratified description is available."}
      </p>
      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-stone-400">Registration</dt>
          <dd className="mt-1 font-semibold">{dossier.entity.registration}</dd>
        </div>
        <div>
          <dt className="text-stone-400">Lifecycle</dt>
          <dd className="mt-1 font-semibold">{dossier.entity.lifecycle}</dd>
        </div>
        <div>
          <dt className="text-stone-400">Aliases</dt>
          <dd className="mt-1 font-mono tabular-nums">{dossier.aliases.length}</dd>
        </div>
        <div>
          <dt className="text-stone-400">Variants</dt>
          <dd className="mt-1 font-mono tabular-nums">{dossier.variants.length}</dd>
        </div>
        <div>
          <dt className="text-stone-400">Claims</dt>
          <dd className="mt-1 font-mono tabular-nums">{dossier.claims.length}</dd>
        </div>
        <div>
          <dt className="text-stone-400">References</dt>
          <dd className="mt-1 font-mono tabular-nums">{dossier.externalReferences.length}</dd>
        </div>
      </dl>
      {dossier.aliases.length === 0 ? null : (
        <div className="mt-6">
          <h3 className="font-semibold">Known Language</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {dossier.aliases.map((alias) => (
              <li className="rounded-full border border-stone-700 px-3 py-1 text-xs" key={alias.id}>
                {alias.value}
              </li>
            ))}
          </ul>
        </div>
      )}
      {canMutate && canonicalAliasId !== undefined ? (
        <RenameEntityForm
          canonicalName={dossier.entity.canonicalName}
          entityId={dossier.entity.id}
          revision={dossier.revision}
        />
      ) : null}
    </aside>
  );
};

export const ProductMapView = async ({ initPageResult, searchParams }: AdminViewServerProps) => {
  const params = searchParams ?? {};
  if (!initPageResult.req.user)
    return <ProductStudioLoginRedirect target={loginPathFor(productMapReturnPath(params))} />;

  const canMutate = mutationAvailable(String(initPageResult.req.user.id));

  const depth = boundedDepth(scalar(params.depth));
  const selectedRelation = scalar(params.relation);
  const selectedEntity = scalar(params.entity);
  const query = scalar(params.q)?.trim();

  try {
    const client = createSarathiProductModelClientFromEnvironment();
    const [map, coverage] = await Promise.all([client.getMap(depth), client.getCoverage()]);
    const availableRelationTypes = relationTypes(map);
    const relationFilter = availableRelationTypes.includes(selectedRelation ?? "")
      ? selectedRelation
      : undefined;
    const visibleMap = productMapMatching(map, query);
    const dossier =
      selectedEntity === undefined ? undefined : await client.getDossier(selectedEntity);

    return (
      <main
        className="min-h-dvh bg-stone-100 px-5 py-8 text-stone-950 sm:px-8 lg:px-12"
        id="main-content"
      >
        <a
          className="sr-only rounded-md bg-white px-4 py-2 font-semibold text-stone-950 focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          href="#product-map-title"
        >
          Skip to Product Map
        </a>
        <header className="mx-auto max-w-[96rem] border-b border-stone-300 pb-7">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-3xl">
              <p className="font-mono text-xs font-semibold text-teal-800">
                Sarathi / governed product identity
              </p>
              <h1
                className="mt-2 scroll-mt-6 text-balance text-4xl font-semibold sm:text-5xl"
                id="product-map-title"
              >
                Product Map
              </h1>
              <p className="mt-3 text-pretty text-stone-700">
                A governed view of ratified business identity. Authorized editors preview changes
                before confirmation. Delivery evidence and technical artifacts remain supporting
                links, not product boundaries.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-stone-300 bg-white p-4 text-sm shadow-sm">
              <div>
                <dt className="text-stone-500">Revision</dt>
                <dd className="font-mono font-semibold tabular-nums">{map.revision}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Entities</dt>
                <dd className="font-mono font-semibold tabular-nums">{map.entities.length}</dd>
              </div>
            </dl>
          </div>
        </header>

        <nav
          aria-label="Product map sections"
          className="mx-auto mt-5 flex max-w-[96rem] flex-wrap gap-x-5 gap-y-2 border-b border-stone-300 pb-4 text-sm font-semibold"
        >
          <a
            className="underline decoration-stone-400 underline-offset-4 hover:decoration-teal-700"
            href="#capability-map-heading"
          >
            Visual explorer
          </a>
          <a
            className="underline decoration-stone-400 underline-offset-4 hover:decoration-teal-700"
            href="#coverage-heading"
          >
            Review queue
          </a>
          <a
            className="underline decoration-stone-400 underline-offset-4 hover:decoration-teal-700"
            href="#registry-table-heading"
          >
            Registry
          </a>
        </nav>

        <div className="mx-auto mt-8 grid max-w-[96rem] gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-10">
            <details className="rounded-xl border border-stone-300 bg-white shadow-sm">
              <summary className="cursor-pointer px-5 py-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
                Advanced server view scope
              </summary>
              <form
                aria-label="Product map filters"
                className="flex flex-wrap items-end gap-4 border-t border-stone-200 p-4"
                method="get"
              >
                <label className="grid gap-1 text-sm font-semibold" htmlFor="depth">
                  Hierarchy Depth
                  <select
                    className="min-w-36 rounded-md border border-stone-400 bg-white px-3 py-2 font-normal text-stone-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                    defaultValue={String(depth)}
                    id="depth"
                    name="depth"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                      <option key={value} value={value}>
                        {value} levels
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-semibold" htmlFor="relation">
                  Relation Filter
                  <select
                    className="min-w-48 rounded-md border border-stone-400 bg-white px-3 py-2 font-normal text-stone-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                    defaultValue={relationFilter ?? ""}
                    id="relation"
                    name="relation"
                  >
                    <option value="">All relation types</option>
                    {availableRelationTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid min-w-56 flex-1 gap-1 text-sm font-semibold" htmlFor="q">
                  Find in Product Map
                  <input
                    className="rounded-md border border-stone-400 bg-white px-3 py-2 font-normal text-stone-950 placeholder:text-stone-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                    defaultValue={query ?? ""}
                    id="q"
                    name="q"
                    placeholder="Capability, feature, or definition"
                    type="search"
                  />
                </label>
                <button
                  className="rounded-md bg-teal-800 px-4 py-2 font-semibold text-white shadow-sm hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                  type="submit"
                >
                  Apply View
                </button>
                {query === undefined || query.length === 0 ? null : (
                  <a
                    className="px-2 py-2 text-sm font-semibold text-stone-700 underline decoration-stone-400 underline-offset-4 hover:decoration-teal-700"
                    href={`/admin/product-map?depth=${depth}${relationFilter === undefined ? "" : `&relation=${encodeURIComponent(relationFilter)}`}`}
                  >
                    Clear search
                  </a>
                )}
              </form>
            </details>

            {map.safeWarnings.map((warning) => (
              <p
                className="rounded-md border border-amber-400 bg-amber-50 p-4 text-pretty text-sm text-amber-950"
                key={warning}
                role="status"
              >
                {warning}
              </p>
            ))}

            {coverage.safeWarnings.map((warning) => (
              <p
                className="rounded-md border border-amber-400 bg-amber-50 p-4 text-pretty text-sm text-amber-950"
                key={warning}
                role="status"
              >
                {warning}
              </p>
            ))}

            {map.entities.length === 0 ? (
              <section className="rounded-md border border-stone-300 bg-white p-8 text-center shadow-sm">
                <h2 className="text-balance text-2xl font-semibold">
                  No authorized product entities
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-pretty text-stone-700">
                  Check the installed workspace and audience mapping, then reload this view. Product
                  Studio will not infer or create product boundaries.
                </p>
              </section>
            ) : visibleMap.entities.length === 0 ? (
              <section className="rounded-xl border border-stone-300 bg-white p-8 text-center shadow-sm">
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-teal-800">
                  No map matches
                </p>
                <h2 className="mt-2 text-balance text-2xl font-semibold">
                  No authorized entity matches “{query}”
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-pretty text-stone-700">
                  Try a broader product term or clear the search. The registry was not changed.
                </p>
              </section>
            ) : (
              <>
                <section aria-labelledby="capability-map-heading">
                  <h2
                    className="scroll-mt-6 text-balance text-2xl font-semibold"
                    id="capability-map-heading"
                  >
                    Capability Constellation
                  </h2>
                  <p className="mb-4 mt-2 max-w-4xl text-pretty text-sm leading-relaxed text-stone-700">
                    Explore from product areas into capabilities and customer-recognizable features.
                    Cloud size reflects hierarchy role and direct children; color identifies the
                    top-level product area. Neither represents priority, delivery progress, or
                    evidence volume.
                  </p>
                  {query === undefined || query.length === 0 ? null : (
                    <p className="mb-4 font-mono text-xs text-stone-600" role="status">
                      Search “{query}” is ready in the constellation jump control.
                    </p>
                  )}
                  <ProductCapabilityExplorer
                    map={map}
                    {...(selectedEntity === undefined ? {} : { initialFocusId: selectedEntity })}
                    {...(query === undefined ? {} : { initialQuery: query })}
                    {...(relationFilter === undefined
                      ? {}
                      : { initialRelationType: relationFilter })}
                  />
                  <details className="mt-4 rounded-lg border border-stone-300 bg-white">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
                      Read relationships as a list
                    </summary>
                    <div className="border-t border-stone-200 p-4">
                      <RelationList
                        map={map}
                        {...(relationFilter === undefined ? {} : { selected: relationFilter })}
                      />
                    </div>
                  </details>
                </section>
                <CoverageReview coverage={coverage} />
                <details className="rounded-xl border border-stone-300 bg-white shadow-sm">
                  <summary
                    className="cursor-pointer px-5 py-4 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                    id="hierarchy-heading"
                  >
                    Complete semantic hierarchy
                  </summary>
                  <div className="border-t border-stone-200 p-5">
                    <p className="mb-4 text-pretty text-sm text-stone-700">
                      The governed single-parent spine, readable without visual graph navigation.
                    </p>
                    <Hierarchy map={visibleMap} />
                  </div>
                </details>
                <details className="rounded-xl border border-stone-300 bg-white shadow-sm">
                  <summary
                    className="cursor-pointer px-5 py-4 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                    id="registry-table-heading"
                  >
                    Registry table
                  </summary>
                  <div className="border-t border-stone-200 p-5">
                    <p className="mb-4 text-pretty text-sm text-stone-700">
                      The complete reading order and full hierarchy path for this view.
                    </p>
                    <RegistryTable map={visibleMap} />
                  </div>
                </details>
              </>
            )}
          </div>
          {dossier === undefined ? (
            <aside className="h-fit rounded-md border border-stone-300 bg-white p-6 shadow-sm xl:sticky xl:top-6">
              <h2 className="text-balance text-xl font-semibold">Feature Dossier</h2>
              <p className="mt-3 text-pretty text-sm text-stone-700">
                Choose an entity from the hierarchy or table to inspect its authorized identity,
                aliases, variants, claims, and references.
              </p>
            </aside>
          ) : (
            <Dossier canMutate={canMutate} dossier={dossier} />
          )}
        </div>
      </main>
    );
  } catch {
    return (
      <main className="min-h-dvh bg-stone-100 p-8 text-stone-950">
        <section
          aria-labelledby="studio-unavailable"
          className="mx-auto max-w-2xl rounded-md border border-red-300 bg-white p-8 shadow-sm"
          role="alert"
        >
          <p className="font-mono text-xs text-red-800">PRODUCT STUDIO UNAVAILABLE</p>
          <h1 className="mt-2 text-balance text-3xl font-semibold" id="studio-unavailable">
            The product map could not be loaded
          </h1>
          <p className="mt-4 text-pretty text-stone-700">
            No product data was shown. Delivery reporting, Teams, and synchronization continue
            independently. Retry after the Sarathi API and Product Studio identity mapping are
            available.
          </p>
        </section>
      </main>
    );
  }
};

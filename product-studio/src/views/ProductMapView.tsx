import type { AdminViewServerProps } from "payload";
import type { ProductDossier, ProductHierarchyNode } from "../domain/product-model";
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
      className="fixed bottom-4 right-4 top-4 z-30 w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-stone-700 bg-stone-950 p-5 text-stone-100 shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-teal-300">
            {labelForKind[dossier.entity.kind]} dossier
          </p>
          <h2 className="mt-1 text-balance text-2xl font-semibold" id="dossier-title">
            {dossier.entity.canonicalName}
          </h2>
        </div>
        <a
          aria-label="Close governed details"
          className="rounded-md border border-stone-700 px-3 py-2 text-xs font-semibold hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
          href="/admin/product-map"
        >
          Close
        </a>
      </div>
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
          <h3 className="font-semibold">Known language</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {dossier.aliases.map((alias) => (
              <li className="rounded-md border border-stone-700 px-3 py-1 text-xs" key={alias.id}>
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
    const map = await client.getMap(depth);
    const dossier =
      selectedEntity === undefined ? undefined : await client.getDossier(selectedEntity);

    return (
      <main className="min-h-dvh bg-stone-950 text-stone-100" id="main-content">
        <a
          className="sr-only rounded-md bg-white px-4 py-2 font-semibold text-stone-950 focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          href="#product-map-title"
        >
          Skip to Product Map
        </a>
        {map.safeWarnings.map((warning) => (
          <p
            className="fixed left-1/2 top-4 z-30 max-w-xl -translate-x-1/2 rounded-md border border-amber-300 bg-stone-950 px-4 py-3 text-pretty text-sm text-amber-100 shadow-md"
            key={warning}
            role="status"
          >
            {warning}
          </p>
        ))}
        <ProductCapabilityExplorer
          map={map}
          {...(selectedEntity === undefined ? {} : { initialFocusId: selectedEntity })}
          {...(query === undefined ? {} : { initialQuery: query })}
          {...(selectedRelation === undefined ? {} : { initialRelationType: selectedRelation })}
        />
        {dossier === undefined ? null : <Dossier canMutate={canMutate} dossier={dossier} />}
      </main>
    );
  } catch {
    return (
      <main className="min-h-dvh bg-stone-950 p-8 text-stone-100">
        <section
          aria-labelledby="studio-unavailable"
          className="mx-auto max-w-2xl rounded-xl border border-red-400 bg-stone-950 p-8 shadow-md"
          role="alert"
        >
          <p className="font-mono text-xs text-red-300">PRODUCT STUDIO UNAVAILABLE</p>
          <h1 className="mt-2 text-balance text-3xl font-semibold" id="studio-unavailable">
            The product map could not be loaded
          </h1>
          <p className="mt-4 text-pretty text-stone-300">
            No product data was shown. Delivery reporting, Teams, and synchronization continue
            independently. Retry after the Sarathi API and Product Studio identity mapping are
            available.
          </p>
        </section>
      </main>
    );
  }
};

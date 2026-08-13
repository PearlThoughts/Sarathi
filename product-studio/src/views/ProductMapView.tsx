import type { AdminViewServerProps } from "payload";
import { createSarathiProductModelClientFromEnvironment } from "../server/sarathi-product-model-client";
import { createUserBoundSarathiCredentialProvider } from "../server/user-bound-sarathi-credentials";
import { ProductCapabilityExplorer } from "./ProductCapabilityExplorer";
import { ProductStudioLoginRedirect } from "./ProductStudioLoginRedirect";

const PRODUCT_MAP_PATH = "/admin/product-map";
const preservedProductMapParams = [
  "depth",
  "relation",
  "entity",
  "focus",
  "selected",
  "edge",
  "compare",
  "lens",
  "view",
  "revision",
  "dossier",
  "q",
] as const;

const scalar = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;
const boundedDepth = (value: string | undefined): number => {
  const parsed = Number(value ?? "4");
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : 4;
};
const productMapReturnPath = (searchParams: AdminViewServerProps["searchParams"]): string => {
  const target = new URLSearchParams();
  for (const key of preservedProductMapParams) {
    const raw = searchParams?.[key];
    for (const value of Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
      if (value.length > 0) target.append(key, value);
  }
  const query = target.toString();
  return query === "" ? PRODUCT_MAP_PATH : `${PRODUCT_MAP_PATH}?${query}`;
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

export const ProductMapView = async ({ initPageResult, searchParams }: AdminViewServerProps) => {
  const params = searchParams ?? {};
  if (!initPageResult.req.user)
    return <ProductStudioLoginRedirect target={loginPathFor(productMapReturnPath(params))} />;
  const initialFocusId = scalar(params.focus) ?? scalar(params.entity);
  const initialQuery = scalar(params.q)?.trim();
  const initialRelationType = scalar(params.relation);
  const canMutate = mutationAvailable(String(initPageResult.req.user.id));

  try {
    const client = createSarathiProductModelClientFromEnvironment();
    const [map, coverage, relationCatalog] = await Promise.all([
      client.getMap(boundedDepth(scalar(params.depth))),
      client.getCoverage(),
      client.getRelationCatalog(),
    ]);
    return (
      <main className="min-h-dvh bg-stone-950 text-stone-100" id="main-content">
        <a
          className="sr-only rounded-md bg-white px-4 py-2 font-semibold text-stone-950 focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[60] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          href="#product-map-title"
        >
          Skip to Product Map
        </a>
        {map.safeWarnings.map((warning) => (
          <p
            className="fixed left-1/2 top-4 z-40 max-w-xl -translate-x-1/2 rounded-md border border-amber-300 bg-stone-950 px-4 py-3 text-pretty text-sm text-amber-100 shadow-md"
            key={warning}
            role="status"
          >
            {warning}
          </p>
        ))}
        <ProductCapabilityExplorer
          canMutate={canMutate}
          coverage={coverage}
          map={map}
          relationCatalog={relationCatalog}
          {...(initialFocusId === undefined ? {} : { initialFocusId })}
          {...(initialQuery === undefined ? {} : { initialQuery })}
          {...(initialRelationType === undefined ? {} : { initialRelationType })}
        />
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

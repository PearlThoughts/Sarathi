import "server-only";
import {
  type ProductAvailability,
  type ProductCoverage,
  type ProductDelivery,
  type ProductDossier,
  type ProductEntityHistory,
  type ProductMap,
  type ProductRelationCatalog,
  type ProductSubgraph,
  productAvailabilitySchema,
  productCoverageSchema,
  productDeliverySchema,
  productDossierSchema,
  productEntityHistorySchema,
  productMapSchema,
  productRelationCatalogSchema,
  productSubgraphSchema,
} from "../domain/product-model";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type SarathiClientConfiguration = {
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly accessToken: string;
  readonly fetch?: Fetcher | undefined;
  readonly now?: (() => Date) | undefined;
};

class SarathiProductModelClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SarathiProductModelClientError";
  }
}

const requiredUrl = (value: string): URL => {
  const url = new URL(value);
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("Sarathi API must use HTTPS outside local development.");
  return url;
};

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required.`);
  return value;
};

const safeFailure = (status: number): SarathiProductModelClientError =>
  new SarathiProductModelClientError(status, "Product Studio data is unavailable.");

const createSarathiProductModelClient = (configuration: SarathiClientConfiguration) => {
  const baseUrl = requiredUrl(configuration.baseUrl);
  const workspaceId = required("workspaceId", configuration.workspaceId);
  const accessToken = required("accessToken", configuration.accessToken);
  const request = configuration.fetch ?? fetch;
  const now = configuration.now ?? (() => new Date());

  const read = async (path: string): Promise<unknown> => {
    const url = new URL(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/product-model/${path}`,
      baseUrl,
    );
    const response = await request(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) throw safeFailure(response.status);
    const envelope = (await response.json()) as { readonly data?: unknown };
    if (envelope.data === undefined) throw safeFailure(502);
    return envelope.data;
  };

  return {
    getMap: async (maximumDepth = 4): Promise<ProductMap> =>
      productMapSchema.parse(await read(`map?maximumDepth=${maximumDepth}`)),
    getDossier: async (entityId: string): Promise<ProductDossier> =>
      productDossierSchema.parse(await read(`entities/${encodeURIComponent(entityId)}`)),
    getSubgraph: async (entityId: string): Promise<ProductSubgraph> =>
      productSubgraphSchema.parse(
        await read(
          `entities/${encodeURIComponent(entityId)}/subgraph?maximumAncestorDepth=4&maximumDescendantDepth=4&maximumNodesPerDirection=100&maximumRelations=250`,
        ),
      ),
    getAvailability: async (
      entityId: string,
      qualifiers: Readonly<Record<string, string>> = {},
    ): Promise<ProductAvailability> => {
      const query = new URLSearchParams();
      for (const [axis, value] of Object.entries(qualifiers).toSorted(([left], [right]) =>
        left.localeCompare(right),
      ))
        query.append("qualifier", `${axis}:${value}`);
      const serialized = query.toString();
      return productAvailabilitySchema.parse(
        await read(
          `availability/${encodeURIComponent(entityId)}${serialized === "" ? "" : `?${serialized}`}`,
        ),
      );
    },
    getHistoryAtRevision: async (revision: number): Promise<ProductMap> =>
      productMapSchema.parse(
        await read(
          `history?revision=${revision}&maximumDepth=8&maximumNodes=500&maximumRelations=500`,
        ),
      ),
    getEntityHistory: async (entityId: string): Promise<ProductEntityHistory> =>
      productEntityHistorySchema.parse(
        await read(`entities/${encodeURIComponent(entityId)}/history?maximumItems=100`),
      ),
    getDelivery: async (entityId: string): Promise<ProductDelivery> =>
      productDeliverySchema.parse(
        await read(
          `entities/${encodeURIComponent(entityId)}/delivery?lookbackDays=90&maximumItems=50`,
        ),
      ),
    getRelationCatalog: async (): Promise<ProductRelationCatalog> =>
      productRelationCatalogSchema.parse(await read("relation-semantics")),
    getCoverage: async (maximumItems = 100): Promise<ProductCoverage> => {
      const staleBefore = new Date(now().getTime() - 90 * 24 * 60 * 60 * 1_000).toISOString();
      return productCoverageSchema.parse(
        await read(
          `coverage?maximumItems=${maximumItems}&staleBefore=${encodeURIComponent(staleBefore)}`,
        ),
      );
    },
  };
};

export const createSarathiProductModelClientFromEnvironment = (
  now: () => Date = () => new Date(),
) =>
  createSarathiProductModelClient({
    baseUrl: required("SARATHI_API_BASE_URL", process.env.SARATHI_API_BASE_URL),
    workspaceId: required(
      "SARATHI_PRODUCT_STUDIO_WORKSPACE_ID",
      process.env.SARATHI_PRODUCT_STUDIO_WORKSPACE_ID,
    ),
    accessToken: required(
      "SARATHI_PRODUCT_STUDIO_READ_TOKEN",
      process.env.SARATHI_PRODUCT_STUDIO_READ_TOKEN,
    ),
    now,
  });

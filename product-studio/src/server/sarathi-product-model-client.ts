import "server-only";
import {
  type ProductCoverage,
  type ProductDossier,
  type ProductMap,
  productCoverageSchema,
  productDossierSchema,
  productMapSchema,
} from "../domain/product-model";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type SarathiClientConfiguration = {
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly accessToken: string;
  readonly fetch?: Fetcher | undefined;
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
    getCoverage: async (maximumItems = 100): Promise<ProductCoverage> =>
      productCoverageSchema.parse(await read(`coverage?maximumItems=${maximumItems}`)),
  };
};

export const createSarathiProductModelClientFromEnvironment = () =>
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
  });

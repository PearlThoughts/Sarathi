import {
  type ProductAvailability,
  type ProductCoverage,
  type ProductDelivery,
  type ProductDossier,
  type ProductEntityHistory,
  type ProductMap,
  type ProductSubgraph,
  productAvailabilitySchema,
  productCoverageSchema,
  productDeliverySchema,
  productDossierSchema,
  productEntityHistorySchema,
  productMapSchema,
  productSubgraphSchema,
} from "../domain/product-model";

type ReadResource =
  | "subgraph"
  | "dossier"
  | "availability"
  | "entity-history"
  | "delivery"
  | "history";

const read = async (resource: ReadResource, options: { entityId?: string; revision?: number }) => {
  const query = new URLSearchParams({ resource });
  if (options.entityId !== undefined) query.set("entityId", options.entityId);
  if (options.revision !== undefined) query.set("revision", String(options.revision));
  const response = await fetch(`/studio-api/product-model?${query}`, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("The authorized Product Studio projection is unavailable.");
  const envelope = (await response.json()) as { readonly data?: unknown };
  if (envelope.data === undefined)
    throw new Error("The authorized Product Studio projection is unavailable.");
  return envelope.data;
};

export const productModelBrowserClient = {
  getSubgraph: async (entityId: string): Promise<ProductSubgraph> =>
    productSubgraphSchema.parse(await read("subgraph", { entityId })),
  getDossier: async (entityId: string): Promise<ProductDossier> =>
    productDossierSchema.parse(await read("dossier", { entityId })),
  getAvailability: async (entityId: string): Promise<ProductAvailability> =>
    productAvailabilitySchema.parse(await read("availability", { entityId })),
  getEntityHistory: async (entityId: string): Promise<ProductEntityHistory> =>
    productEntityHistorySchema.parse(await read("entity-history", { entityId })),
  getDelivery: async (entityId: string): Promise<ProductDelivery> =>
    productDeliverySchema.parse(await read("delivery", { entityId })),
  getHistory: async (revision: number): Promise<ProductMap> =>
    productMapSchema.parse(await read("history", { revision })),
  getCoverage: async (): Promise<ProductCoverage> => {
    const response = await fetch("/studio-api/product-model?resource=coverage", {
      credentials: "same-origin",
    });
    const envelope = (await response.json()) as { readonly data?: unknown };
    return productCoverageSchema.parse(envelope.data);
  },
};

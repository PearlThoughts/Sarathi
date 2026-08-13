import { z } from "zod";
import type { createSarathiProductModelClientFromEnvironment } from "./sarathi-product-model-client";

type ProductModelReadClient = ReturnType<typeof createSarathiProductModelClientFromEnvironment>;

type ProductModelReadHandlerDependencies = {
  readonly authenticate: (request: Request) => Promise<boolean>;
  readonly client: ProductModelReadClient;
};

const requestSchema = z
  .object({
    resource: z.enum([
      "relation-catalog",
      "subgraph",
      "dossier",
      "availability",
      "entity-history",
      "delivery",
      "history",
      "coverage",
    ]),
    entityId: z.uuid().optional(),
    revision: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

const safeError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

export const createProductModelReadHandler =
  (dependencies: ProductModelReadHandlerDependencies) =>
  async (request: Request): Promise<Response> => {
    try {
      if (!(await dependencies.authenticate(request)))
        return safeError(401, "PRODUCT_STUDIO_AUTH_REQUIRED", "Sign in required.");
      const url = new URL(request.url);
      const input = requestSchema.parse({
        resource: url.searchParams.get("resource"),
        entityId: url.searchParams.get("entityId") ?? undefined,
        revision: url.searchParams.get("revision") ?? undefined,
      });
      if (input.resource === "relation-catalog")
        return Response.json({ data: await dependencies.client.getRelationCatalog() });
      if (input.resource === "coverage")
        return Response.json({ data: await dependencies.client.getCoverage() });
      if (input.resource === "history") {
        if (input.revision === undefined)
          return safeError(400, "INVALID_REQUEST", "Product query is invalid.");
        return Response.json({
          data: await dependencies.client.getHistoryAtRevision(input.revision),
        });
      }
      if (input.entityId === undefined)
        return safeError(400, "INVALID_REQUEST", "Product query is invalid.");
      if (input.resource === "subgraph")
        return Response.json({ data: await dependencies.client.getSubgraph(input.entityId) });
      if (input.resource === "dossier")
        return Response.json({ data: await dependencies.client.getDossier(input.entityId) });
      if (input.resource === "availability")
        return Response.json({ data: await dependencies.client.getAvailability(input.entityId) });
      if (input.resource === "entity-history")
        return Response.json({ data: await dependencies.client.getEntityHistory(input.entityId) });
      return Response.json({ data: await dependencies.client.getDelivery(input.entityId) });
    } catch (error) {
      if (error instanceof z.ZodError)
        return safeError(400, "INVALID_REQUEST", "Product query is invalid.");
      return safeError(
        503,
        "PRODUCT_MODEL_UNAVAILABLE",
        "The authorized Product Studio projection is unavailable.",
      );
    }
  };

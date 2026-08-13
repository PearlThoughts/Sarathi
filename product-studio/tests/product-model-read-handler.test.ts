import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const entityId = "00000000-0000-4000-8000-000000000901";
const request = (query: string) =>
  new Request(`https://studio.example.test/studio-api/product-model?${query}`);

const client = () => ({
  getMap: vi.fn(),
  getCoverage: vi.fn(),
  getRelationCatalog: vi.fn(() => Promise.resolve({ workspaceId: "synthetic", relations: [] })),
  getSubgraph: vi.fn(() => Promise.resolve({ rootEntityId: entityId })),
  getDossier: vi.fn(() => Promise.resolve({ entity: { id: entityId } })),
  getAvailability: vi.fn(() => Promise.resolve({ entityId })),
  getEntityHistory: vi.fn(() => Promise.resolve({ entityId, events: [] })),
  getDelivery: vi.fn(() => Promise.resolve({ entityId, availability: "available" })),
  getHistoryAtRevision: vi.fn(() => Promise.resolve({ revision: 3 })),
});

describe("Product Studio product-model read handler", () => {
  it("reauthenticates before executing an allowlisted bounded entity query", async () => {
    const events: string[] = [];
    const readClient = client();
    readClient.getSubgraph.mockImplementation(() => {
      events.push("subgraph");
      return Promise.resolve({ rootEntityId: entityId });
    });
    const { createProductModelReadHandler } = await import(
      "../src/server/product-model-read-handler"
    );
    const handler = createProductModelReadHandler({
      authenticate: () => {
        events.push("authenticate");
        return Promise.resolve(true);
      },
      client: readClient as never,
    });

    const response = await handler(request(`resource=subgraph&entityId=${entityId}`));

    expect(response.status).toBe(200);
    expect(events).toEqual(["authenticate", "subgraph"]);
    expect(readClient.getSubgraph).toHaveBeenCalledWith(entityId);
  });

  it("denies before client access when the Payload session is absent", async () => {
    const readClient = client();
    const { createProductModelReadHandler } = await import(
      "../src/server/product-model-read-handler"
    );
    const handler = createProductModelReadHandler({
      authenticate: () => Promise.resolve(false),
      client: readClient as never,
    });

    const response = await handler(request(`resource=dossier&entityId=${entityId}`));

    expect(response.status).toBe(401);
    expect(readClient.getDossier).not.toHaveBeenCalled();
  });

  it("rejects arbitrary resources and malformed identifiers without calling Sarathi", async () => {
    const readClient = client();
    const { createProductModelReadHandler } = await import(
      "../src/server/product-model-read-handler"
    );
    const handler = createProductModelReadHandler({
      authenticate: () => Promise.resolve(true),
      client: readClient as never,
    });

    const [arbitrary, malformed] = await Promise.all([
      handler(request("resource=https://outside.invalid/private")),
      handler(request("resource=delivery&entityId=not-an-id")),
    ]);

    expect(arbitrary.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(readClient.getDelivery).not.toHaveBeenCalled();
  });

  it("returns one privacy-safe unavailable error", async () => {
    const readClient = client();
    readClient.getDelivery.mockRejectedValue(new Error("private source identifier"));
    const { createProductModelReadHandler } = await import(
      "../src/server/product-model-read-handler"
    );
    const handler = createProductModelReadHandler({
      authenticate: () => Promise.resolve(true),
      client: readClient as never,
    });

    const response = await handler(request(`resource=delivery&entityId=${entityId}`));

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private source identifier");
  });
});

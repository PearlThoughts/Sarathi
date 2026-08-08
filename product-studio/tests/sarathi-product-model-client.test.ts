import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const map = {
  workspaceId: "workspace-synthetic",
  asOf: "2026-01-02T00:00:00.000Z",
  revision: 4,
  entities: [],
  relations: [],
  page: { maximumDepth: 4, maximumNodes: 250, truncated: false },
  relationPage: { maximumRelations: 250, truncated: false },
  safeWarnings: [],
};

const coverage = {
  workspaceId: "workspace-synthetic",
  asOf: "2026-01-02T00:00:00.000Z",
  revision: 4,
  items: [],
  page: { maximumItems: 100, truncated: false },
  safeWarnings: [],
};

describe("Product Studio Sarathi server adapter", () => {
  let createClient: typeof import("../src/server/sarathi-product-model-client").createSarathiProductModelClientFromEnvironment;

  beforeAll(async () => {
    ({ createSarathiProductModelClientFromEnvironment: createClient } = await import(
      "../src/server/sarathi-product-model-client"
    ));
  });

  beforeEach(() => {
    process.env.SARATHI_API_BASE_URL = "https://sarathi.example.test";
    process.env.SARATHI_PRODUCT_STUDIO_WORKSPACE_ID = "workspace-synthetic";
    process.env.SARATHI_PRODUCT_STUDIO_READ_TOKEN = "read-token-synthetic";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the read token server-side and calls only the versioned workspace API", async () => {
    const request = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(Response.json({ data: map })),
    );
    vi.stubGlobal("fetch", request);
    const client = createClient();

    await expect(client.getMap(3)).resolves.toEqual(map);
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://sarathi.example.test/v1/workspaces/workspace-synthetic/product-model/map?maximumDepth=3",
    );
    expect(init).toMatchObject({
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: "Bearer read-token-synthetic",
      },
    });
  });

  it("returns one safe unavailable error without exposing Sarathi response details", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json(
          { error: { code: "INTERNAL_DETAIL", message: "sensitive repository detail" } },
          { status: 503 },
        ),
      ),
    );
    const client = createClient();

    await expect(client.getMap()).rejects.toMatchObject({
      status: 503,
      message: "Product Studio data is unavailable.",
    });
  });

  it("reads bounded metadata-only coverage through the versioned workspace API", async () => {
    const request = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(Response.json({ data: coverage })),
    );
    vi.stubGlobal("fetch", request);
    const client = createClient();

    await expect(client.getCoverage()).resolves.toEqual(coverage);
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://sarathi.example.test/v1/workspaces/workspace-synthetic/product-model/coverage?maximumItems=100",
    );
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method: "GET", cache: "no-store" });
  });

  it("requires HTTPS for non-local Sarathi endpoints", () => {
    process.env.SARATHI_API_BASE_URL = "http://sarathi.example.test";
    expect(() => createClient()).toThrow("Sarathi API must use HTTPS outside local development.");
  });

  it("rejects API envelopes that expand beyond the public map contract", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(Response.json({ data: { ...map, evidenceBodies: ["must not render"] } })),
    );
    const client = createClient();

    await expect(client.getMap()).rejects.toThrow();
  });
});

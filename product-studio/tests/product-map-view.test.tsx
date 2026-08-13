import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMap = vi.fn();
const getDossier = vi.fn();
const getCoverage = vi.fn();
const getRelationCatalog = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../src/server/sarathi-product-model-client", () => ({
  createSarathiProductModelClientFromEnvironment: () => ({
    getCoverage,
    getDossier,
    getMap,
    getRelationCatalog,
  }),
}));

const rootId = "00000000-0000-4000-8000-000000000301";
const childId = "00000000-0000-4000-8000-000000000302";

const map = {
  workspaceId: "workspace-synthetic",
  asOf: "2026-01-02T00:00:00.000Z",
  revision: 4,
  entities: [
    {
      entityId: rootId,
      kind: "product",
      canonicalName: "Synthetic product",
      registration: "ratified",
      lifecycle: "available",
      sensitivity: "internal",
      audience: ["workspace:synthetic"],
      revision: 4,
      depth: 0,
    },
    {
      entityId: childId,
      parentId: rootId,
      kind: "capability",
      canonicalName: "Synthetic capability",
      registration: "ratified",
      lifecycle: "available",
      sensitivity: "internal",
      audience: ["workspace:synthetic"],
      revision: 4,
      depth: 1,
    },
  ],
  relations: [
    {
      id: "relation-synthetic-dependency",
      workspaceId: "workspace-synthetic",
      type: "depends_on",
      source: { kind: "entity", entityId: childId },
      target: { kind: "entity", entityId: rootId },
      registration: "ratified",
      sourceClass: "user",
      sensitivity: "internal",
      audience: ["workspace:synthetic"],
      validFrom: "2026-01-01T00:00:00.000Z",
      createdRevision: 4,
    },
  ],
  page: { maximumDepth: 4, maximumNodes: 250, truncated: false },
  relationPage: { maximumRelations: 250, truncated: false },
  safeWarnings: [],
};

const dossier = {
  workspaceId: "workspace-synthetic",
  asOf: "2026-01-02T00:00:00.000Z",
  revision: 4,
  entity: {
    id: childId,
    workspaceId: "workspace-synthetic",
    kind: "capability",
    canonicalName: "Synthetic capability",
    registration: "ratified",
    lifecycle: "available",
    sensitivity: "internal",
    audience: ["workspace:synthetic"],
    createdRevision: 1,
    updatedRevision: 4,
  },
  aliases: [
    {
      id: "alias-synthetic-command",
      entityId: childId,
      value: "Synthetic capability",
      normalizedValue: "synthetic capability",
      kind: "canonical",
      createdRevision: 1,
    },
  ],
  variants: [],
  claims: [],
  externalReferences: [],
  proposals: [],
  relations: [],
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
const relationCatalog = {
  workspaceId: "workspace-synthetic",
  relations: [
    {
      type: "depends_on",
      label: "depends on",
      reverseLabel: "is depended on by",
      family: "product",
      definition: "The source requires the target.",
      directional: true,
      lenses: ["relationships", "dependencies", "constellation"],
    },
  ],
};

const viewProps = (user: unknown, searchParams: Record<string, string> = {}) =>
  ({ initPageResult: { req: { user } }, searchParams }) as never;

describe("Product Studio product map view", () => {
  beforeEach(() => {
    getMap.mockReset().mockResolvedValue(map);
    getDossier.mockReset().mockResolvedValue(dossier);
    getCoverage.mockReset().mockResolvedValue(coverage);
    getRelationCatalog.mockReset().mockResolvedValue(relationCatalog);
  });

  afterEach(() => {
    delete process.env.SARATHI_PRODUCT_STUDIO_USER_CREDENTIALS_JSON;
  });

  it("renders the 3D text graph shell, accessible navigator, and governed dossier", async () => {
    const { ProductMapView } = await import("../src/views/ProductMapView");
    const markup = renderToStaticMarkup(
      await ProductMapView(viewProps({ id: "studio-user" }, { entity: childId })),
    );

    expect(markup).toContain("<ol");
    expect(markup).toContain('href="#product-map-title"');
    expect(markup).toContain('id="main-content"');
    expect(markup).toContain('data-renderer="3d-force-graph"');
    expect(markup).toContain('data-testid="product-capability-graph"');
    expect(markup).toContain('id="entity-inspector-title"');
    expect(markup).toContain("Product Capability Graph");
    expect(markup).toContain("Interactive 3D product capability graph");
    expect(markup).toContain("Text navigator");
    expect(markup).toContain("Relationships");
    expect(markup).toContain("depends on");
    expect(markup).toContain("focus-visible:outline-2");
    expect(markup).not.toContain("<canvas");
    expect(markup).not.toContain("Product-owner review queue");
    expect(markup).not.toContain("Registry table");
    expect(markup).not.toContain("Complete semantic hierarchy");
    expect(getMap).toHaveBeenCalledOnce();
    expect(getDossier).not.toHaveBeenCalled();
  });

  it("redirects to sign-in with a safe local return before accessing Sarathi", async () => {
    const { ProductMapView } = await import("../src/views/ProductMapView");
    const externalLookingQuery = "https://outside.invalid/product";

    const markup = renderToStaticMarkup(
      await ProductMapView(viewProps(undefined, { entity: childId, q: externalLookingQuery })),
    );

    const returnPath = `/admin/product-map?entity=${encodeURIComponent(childId)}&q=${encodeURIComponent(externalLookingQuery)}`;
    const loginPath = `/admin/login?redirect=${encodeURIComponent(returnPath)}`;
    expect(markup).toContain("Continuing to secure sign-in");
    expect(markup).toContain(`href="${loginPath.replaceAll("&", "&amp;")}"`);
    expect(markup).not.toContain(`href="${externalLookingQuery}"`);
    expect(getMap).not.toHaveBeenCalled();
    expect(getDossier).not.toHaveBeenCalled();
  });

  it("keeps governed mutation availability server-resolved without exposing credentials", async () => {
    process.env.SARATHI_PRODUCT_STUDIO_USER_CREDENTIALS_JSON = JSON.stringify({
      "studio-user": {
        actorId: "sarathi-actor-synthetic",
        accessToken: "user-access-token-synthetic",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });
    const { ProductMapView } = await import("../src/views/ProductMapView");
    const markup = renderToStaticMarkup(
      await ProductMapView(viewProps({ id: "studio-user" }, { entity: childId })),
    );

    expect(markup).toContain("Full dossier");
    expect(markup).not.toContain("user-access-token-synthetic");
  });

  it("fails closed without rendering partial product data", async () => {
    getMap.mockRejectedValue(new Error("synthetic outage"));
    const { ProductMapView } = await import("../src/views/ProductMapView");
    const markup = renderToStaticMarkup(await ProductMapView(viewProps({ id: "studio-user" })));

    expect(markup).toContain("No product data was shown");
    expect(markup).toContain(
      "Delivery reporting, Teams, and synchronization continue independently",
    );
    expect(markup).not.toContain("Synthetic product");
  });
});

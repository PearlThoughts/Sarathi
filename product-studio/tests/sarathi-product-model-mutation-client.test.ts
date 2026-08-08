import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const workspaceId = "workspace-synthetic";
const entityId = "00000000-0000-4000-8000-000000000201";
const credential = {
  actorId: "sarathi-actor-synthetic",
  accessToken: "user-access-token-synthetic",
  expiresAt: "2026-01-02T01:00:00.000Z",
};
const command = {
  type: "RenameEntity" as const,
  workspaceId,
  targetId: entityId,
  expectedRevision: 4,
  idempotencyKey: "synthetic-mutation-client-0001",
  justification: "The product owner approved the canonical name.",
  validFrom: "2026-01-02T00:00:00.000Z",
  payload: {
    canonicalName: "Synthetic Capability",
    canonicalAliasId: "alias-synthetic-command",
  },
};

const preview = {
  status: "previewed",
  workspaceId,
  expectedRevision: 4,
  resultingRevision: 5,
  commandHash: "sha256-synthetic-command",
  previewToken: "preview-synthetic-command",
  expiresAt: "2026-01-02T00:05:00.000Z",
  policyVersion: "policy-synthetic-v1",
  impact: {
    changedEntityIds: [entityId],
    hiddenEntityImpactCount: 0,
    changedCollections: { entities: 2, aliases: 2 },
  },
  invariantResults: [{ status: "passed", name: "product-model-domain-invariants" }],
};

describe("Product Studio Sarathi mutation client", () => {
  it("uses the injected user credential for preview and never the shared read token", async () => {
    process.env.SARATHI_PRODUCT_STUDIO_READ_TOKEN = "shared-read-token-must-not-be-used";
    const request = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(Response.json({ data: preview })),
    );
    const { createSarathiProductModelMutationClient } = await import(
      "../src/server/sarathi-product-model-mutation-client"
    );
    const client = createSarathiProductModelMutationClient({
      baseUrl: "https://sarathi.example.test",
      workspaceId,
      credential,
      fetch: request,
    });

    await expect(client.previewRename(command)).resolves.toEqual(preview);
    const [url, init] = request.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `https://sarathi.example.test/v1/workspaces/${workspaceId}/product-model/changes/preview`,
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer user-access-token-synthetic",
        "content-type": "application/json",
      },
      cache: "no-store",
      redirect: "error",
    });
    expect(JSON.stringify(init)).not.toContain("shared-read-token-must-not-be-used");
  });

  it("executes only through the command route with a preview token", async () => {
    const committed = {
      status: "committed",
      revision: 5,
      eventId: "event-synthetic-command",
      changedEntityIds: [entityId],
      replayed: false,
      projectionState: "pending",
    };
    const request = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(Response.json({ data: committed })),
    );
    const { createSarathiProductModelMutationClient } = await import(
      "../src/server/sarathi-product-model-mutation-client"
    );
    const client = createSarathiProductModelMutationClient({
      baseUrl: "https://sarathi.example.test",
      workspaceId,
      credential,
      fetch: request,
    });

    await expect(
      client.executeRename({ ...command, previewToken: "preview-synthetic-command" }),
    ).resolves.toEqual(committed);
    expect(String(request.mock.calls[0]?.[0]).endsWith("/product-model/commands")).toBe(true);
  });

  it("preserves allowlisted stale-revision recovery details", async () => {
    const request = vi.fn(() =>
      Promise.resolve(
        Response.json(
          {
            error: {
              code: "stale_revision",
              message: "Expected product-model revision 4; current revision is 5.",
            },
          },
          { status: 409 },
        ),
      ),
    );
    const { createSarathiProductModelMutationClient } = await import(
      "../src/server/sarathi-product-model-mutation-client"
    );
    const client = createSarathiProductModelMutationClient({
      baseUrl: "https://sarathi.example.test",
      workspaceId,
      credential,
      fetch: request,
    });

    await expect(
      client.executeRename({ ...command, previewToken: "preview-synthetic-command" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "stale_revision",
      message: "Expected product-model revision 4; current revision is 5.",
    });
  });

  it("collapses unknown error envelopes without exposing response detail", async () => {
    const request = vi.fn(() =>
      Promise.resolve(
        Response.json(
          { error: { code: "DATABASE_DETAIL", message: "sensitive internal failure" } },
          { status: 503 },
        ),
      ),
    );
    const { createSarathiProductModelMutationClient } = await import(
      "../src/server/sarathi-product-model-mutation-client"
    );
    const client = createSarathiProductModelMutationClient({
      baseUrl: "https://sarathi.example.test",
      workspaceId,
      credential,
      fetch: request,
    });

    await expect(client.previewRename(command)).rejects.toMatchObject({
      status: 503,
      code: "PRODUCT_MODEL_UNAVAILABLE",
      message: "The product change service is unavailable.",
    });
  });
});

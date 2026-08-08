import { describe, expect, it, vi } from "vitest";
import type { UserBoundSarathiCredential } from "../src/server/user-bound-sarathi-credentials";

vi.mock("server-only", () => ({}));

const workspaceId = "workspace-synthetic";
const entityId = "00000000-0000-4000-8000-000000000201";
const credential: UserBoundSarathiCredential = {
  actorId: "sarathi-actor-synthetic",
  accessToken: "user-access-token-synthetic",
  expiresAt: "2026-01-02T01:00:00.000Z",
};
const preview = {
  status: "previewed" as const,
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
  invariantResults: [{ status: "passed" as const, name: "product-model-domain-invariants" }],
};

const request = (body: unknown) =>
  new Request("https://studio.example.test/studio-api/product-model-change", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const previewBody = {
  action: "preview-rename",
  entityId,
  expectedRevision: 4,
  canonicalName: "Synthetic Capability",
  canonicalAliasId: "alias-synthetic-command",
  justification: "The product owner approved the canonical name.",
};

describe("Product Studio product-model change handler", () => {
  it("reauthenticates and resolves the exact user credential before preview", async () => {
    const events: string[] = [];
    const previewRename = vi.fn(() => Promise.resolve(preview));
    const resolve = vi.fn((userId: string) => {
      events.push(`credential:${userId}`);
      return credential;
    });
    const { createProductModelChangeHandler } = await import(
      "../src/server/product-model-change-handler"
    );
    const handler = createProductModelChangeHandler({
      authenticate: () => {
        events.push("authenticate");
        return Promise.resolve({ id: "payload-user-synthetic" });
      },
      credentials: { resolve },
      clientFor: (resolvedCredential) => {
        events.push(`client:${resolvedCredential.actorId}`);
        return { previewRename, executeRename: vi.fn() };
      },
      workspaceId,
      now: () => "2026-01-02T00:00:00.000Z",
      newId: () => "00000000-0000-4000-8000-000000000901",
    });

    const response = await handler(request(previewBody));

    expect(response.status).toBe(200);
    expect(events).toEqual([
      "authenticate",
      "credential:payload-user-synthetic",
      "client:sarathi-actor-synthetic",
    ]);
    expect(previewRename).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        targetId: entityId,
        expectedRevision: 4,
        idempotencyKey: "product-studio-00000000-0000-4000-8000-000000000901",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        preview: { previewToken: "preview-synthetic-command" },
        command: { previewToken: "preview-synthetic-command" },
      },
    });
  });

  it("denies before credential or client access when the Payload session is absent", async () => {
    const resolve = vi.fn();
    const clientFor = vi.fn();
    const { createProductModelChangeHandler } = await import(
      "../src/server/product-model-change-handler"
    );
    const handler = createProductModelChangeHandler({
      authenticate: () => Promise.resolve(undefined),
      credentials: { resolve },
      clientFor,
      workspaceId,
      now: () => "2026-01-02T00:00:00.000Z",
      newId: () => "unused",
    });

    const response = await handler(request({ actorId: "browser-selected-actor" }));

    expect(response.status).toBe(401);
    expect(resolve).not.toHaveBeenCalled();
    expect(clientFor).not.toHaveBeenCalled();
  });

  it("rejects cross-workspace execute drafts before the Sarathi client", async () => {
    const executeRename = vi.fn();
    const { createProductModelChangeHandler } = await import(
      "../src/server/product-model-change-handler"
    );
    const handler = createProductModelChangeHandler({
      authenticate: () => Promise.resolve({ id: "payload-user-synthetic" }),
      credentials: { resolve: () => credential },
      clientFor: () => ({
        previewRename: vi.fn(() => Promise.resolve(preview)),
        executeRename,
      }),
      workspaceId,
      now: () => "2026-01-02T00:00:00.000Z",
      newId: () => "unused",
    });
    const response = await handler(
      request({
        action: "execute-rename",
        command: {
          type: "RenameEntity",
          workspaceId: "workspace-not-installed",
          targetId: entityId,
          expectedRevision: 4,
          idempotencyKey: "product-studio-synthetic-command",
          justification: "The product owner approved the canonical name.",
          validFrom: "2026-01-02T00:00:00.000Z",
          previewToken: "preview-synthetic-command",
          payload: {
            canonicalName: "Synthetic Capability",
            canonicalAliasId: "alias-synthetic-command",
          },
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(executeRename).not.toHaveBeenCalled();
  });

  it("returns stale-revision recovery without leaking unexpected failures", async () => {
    const { SarathiProductModelMutationError } = await import(
      "../src/server/sarathi-product-model-mutation-client"
    );
    const executeRename = vi.fn(() =>
      Promise.reject(
        new SarathiProductModelMutationError(
          409,
          "stale_revision",
          "Expected product-model revision 4; current revision is 5.",
        ),
      ),
    );
    const { createProductModelChangeHandler } = await import(
      "../src/server/product-model-change-handler"
    );
    const handler = createProductModelChangeHandler({
      authenticate: () => Promise.resolve({ id: "payload-user-synthetic" }),
      credentials: { resolve: () => credential },
      clientFor: () => ({
        previewRename: vi.fn(() => Promise.resolve(preview)),
        executeRename,
      }),
      workspaceId,
      now: () => "2026-01-02T00:00:00.000Z",
      newId: () => "unused",
    });
    const previewResponse = await handler(request(previewBody));
    const previewEnvelope = (await previewResponse.json()) as {
      readonly data: { readonly command: unknown };
    };

    const response = await handler(
      request({ action: "execute-rename", command: previewEnvelope.data.command }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "stale_revision",
        message: "Expected product-model revision 4; current revision is 5.",
      },
    });
  });
});

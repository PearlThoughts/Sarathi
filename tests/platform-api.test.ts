import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { makeStaticWorkspaceOverlaySource } from "../src/infrastructure/overlay/yaml-workspace-overlay.ts";
import { makeSarathiRuntime } from "../src/platform/runtime.ts";

const runtime = makeSarathiRuntime({
  config: {
    serviceName: "sarathi",
    environment: "test",
    http: { port: 0 },
    overlayPath: "unused",
    auth: { provider: "static" },
  },
  workspaceOverlay: makeStaticWorkspaceOverlaySource({
    version: 1,
    organizationId: "acme",
    teams: [
      {
        teamId: "delivery-operations",
        sensitivity: "confidential",
        minimumTrustTier: "trusted",
        modelEgress: "approval-required",
      },
    ],
  }),
  clock: { now: () => "2026-07-02T00:00:00.000Z" },
});

describe("platform API", () => {
  const app = createApp(runtime);

  it("reports service health", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "sarathi",
      environment: "test",
    });
  });

  it("reports foundation boundaries", async () => {
    const response = await app.request("/platform/foundation");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authProvider: "better-auth",
      authorizationProvider: "sarathi-policy",
      safetyInvariant: "authorization-before-retrieval-tool-and-model-egress",
    });
  });

  it("compiles the configured workspace model", async () => {
    const response = await app.request("/workspace-model");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.model.teams).toContainEqual(
      expect.objectContaining({
        id: "delivery-operations",
        boundary: expect.objectContaining({
          sensitivity: "confidential",
          minimumTrustTier: "trusted",
          modelEgress: "approval-required",
        }),
      }),
    );
  });

  it("previews a submitted workspace overlay", async () => {
    const response = await app.request("/workspace-model/preview", {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        organizationId: "acme",
        teams: [
          {
            teamId: "engineering",
            sensitivity: "confidential",
            minimumTrustTier: "trusted",
            modelEgress: "approval-required",
          },
        ],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.model.teams).toContainEqual(
      expect.objectContaining({
        id: "engineering",
        boundary: expect.objectContaining({
          sensitivity: "confidential",
          modelEgress: "approval-required",
        }),
      }),
    );
  });
});

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { createHmacProductPreviewTokenCodec } from "../src/infrastructure/auth/hmac-product-preview-token.ts";
import { createProductModelApiSecurity } from "../src/infrastructure/auth/product-model-api-security.ts";
import type { ProductModelPrincipalConfiguration } from "../src/platform/config.ts";
import { loadPlatformConfig } from "../src/platform/config.ts";
import { makeSarathiRuntime } from "../src/platform/runtime.ts";

const readToken = "synthetic-read-token-00000001";
const workspaceId = "synthetic-runtime-workspace";
const execFile = promisify(execFileCallback);

const principal = (
  overrides: Partial<ProductModelPrincipalConfiguration> = {},
): ProductModelPrincipalConfiguration => ({
  accessToken: readToken,
  organizationId: "synthetic-runtime-organization",
  workspaceId,
  actorId: "synthetic-runtime-reader",
  trustTier: "trusted",
  effectiveAudience: ["workspace:synthetic-runtime"],
  maximumSensitivity: "internal",
  modelEgress: "block",
  permittedCorpusScopes: ["product-model"],
  surfaces: ["api"],
  queryOperations: [
    "get-map",
    "get-subgraph",
    "get-dossier",
    "get-historical-graph",
    "get-coverage",
    "get-availability",
  ],
  commandOperations: [],
  allowHiddenImpacts: false,
  policyVersion: "synthetic-runtime-policy-v1",
  ...overrides,
});

const environment = () => ({
  SARATHI_ENVIRONMENT: "test",
  SARATHI_PRODUCT_MODEL_DATABASE_URL: "postgresql://127.0.0.1:1/unreachable",
  SARATHI_PRODUCT_MODEL_PREVIEW_SECRET: "synthetic-preview-secret-at-least-thirty-two-bytes",
  SARATHI_PRODUCT_MODEL_PRINCIPALS_JSON: JSON.stringify([principal()]),
});

describe("product-model runtime composition", () => {
  it("loads its default environment under the hosted Node runtime", async () => {
    const script =
      'import { Effect } from "effect"; import { loadPlatformConfig } from "./src/platform/config.ts"; console.log(Effect.runSync(loadPlatformConfig()).serviceName);';

    const { stdout } = await execFile(
      "node",
      ["--import", "tsx", "--input-type=module", "--eval", script],
      {
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
      },
    );

    expect(stdout.trim()).toBe("sarathi");
  });

  it("fails closed when runtime configuration is partial or principal identities collide", () => {
    expect(() =>
      Effect.runSync(
        loadPlatformConfig({ SARATHI_PRODUCT_MODEL_DATABASE_URL: "postgresql://example/db" }),
      ),
    ).toThrow(/requires database URL, preview secret, and principal configuration/);
    expect(() =>
      Effect.runSync(
        loadPlatformConfig({
          ...environment(),
          SARATHI_PRODUCT_MODEL_PRINCIPALS_JSON: JSON.stringify([principal(), principal()]),
        }),
      ),
    ).toThrow(/workspace and actor identities must be unique/);
  });

  it("resolves server-owned principals and separates read from command authority", async () => {
    const writer = principal({
      accessToken: "synthetic-write-token-0000001",
      actorId: "synthetic-runtime-writer",
      surfaces: ["product-studio"],
      queryOperations: [],
      commandOperations: ["preview-change", "execute-command"],
    });
    const security = createProductModelApiSecurity([principal(), writer]);
    const context = await Effect.runPromise(
      security.context.resolve(
        new Request("http://localhost", {
          headers: { authorization: `Bearer ${readToken}` },
        }),
        workspaceId,
        "api",
      ),
    );

    expect(context).toMatchObject({
      workspaceId,
      actorId: "synthetic-runtime-reader",
      surface: "api",
    });
    await expect(
      Effect.runPromise(security.queries.authorize(context, "get-map")),
    ).resolves.toMatchObject({
      allowed: true,
    });
    await expect(
      Effect.runPromise(
        security.commands.authorize(context, {
          operation: "execute-command",
          commandType: "RenameEntity",
          declaredEntityIds: [],
        }),
      ),
    ).resolves.toMatchObject({ allowed: false });
    const denied = await Effect.runPromise(
      Effect.either(
        security.context.resolve(
          new Request("http://localhost", {
            headers: { authorization: "Bearer invalid-token-value" },
          }),
          workspaceId,
          "api",
        ),
      ),
    );
    expect(denied._tag === "Left" ? denied.left._tag : "unexpected-success").toBe(
      "ProductModelAccessDenied",
    );
  });

  it("binds preview tokens to actor, workspace, policy, revision, hash, and expiry", () => {
    const codec = createHmacProductPreviewTokenCodec(
      "synthetic-preview-secret-at-least-thirty-two-bytes",
    );
    const claims = {
      commandHash: "sha256-synthetic-command",
      actorId: "synthetic-runtime-writer",
      workspaceId,
      policyVersion: "synthetic-runtime-policy-v1",
      expectedRevision: 4,
      expiresAt: "2026-08-08T18:00:00.000Z",
    };
    const token = codec.issue(claims);

    expect(codec.verify(token, { ...claims, now: "2026-08-08T17:59:00.000Z" })).toBe(true);
    expect(
      codec.verify(token, {
        ...claims,
        actorId: "different-actor",
        now: "2026-08-08T17:59:00.000Z",
      }),
    ).toBe(false);
    expect(codec.verify(token, { ...claims, now: claims.expiresAt })).toBe(false);
    expect(codec.verify(`${token}tampered`, { ...claims, now: "2026-08-08T17:59:00.000Z" })).toBe(
      false,
    );
  });

  it("activates the real runtime only when configured and denies before database access", async () => {
    const config = Effect.runSync(loadPlatformConfig(environment()));
    const runtime = makeSarathiRuntime({ config });
    const response = await createApp(runtime).request(
      `/v1/workspaces/${workspaceId}/product-model/map`,
      { headers: { authorization: "Bearer invalid-token-value" } },
    );

    expect(runtime.productModelApi).toBeDefined();
    expect(response.status).toBe(403);
    await runtime.close();
  });
});

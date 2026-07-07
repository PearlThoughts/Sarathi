import { describe, expect, it } from "vitest";
import { checkRuntimeSmoke, runReleaseCli } from "../src/cli/release.ts";

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });

describe("release CLI", () => {
  it("checks runtime smoke endpoints", async () => {
    const requested: string[] = [];
    const fetcher = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      requested.push(String(input));
      if (String(input).endsWith("/workspace-model/preview")) {
        expect(init).toMatchObject({
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
        });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          organizationId: "acme",
          teams: [
            {
              teamId: "engineering",
              sensitivity: "confidential",
              minimumTrustTier: "trusted",
              modelEgress: "approval-required",
            },
          ],
        });
      }
      return jsonResponse({ ok: true });
    };

    const smoke = await checkRuntimeSmoke("http://localhost:3000/", fetcher);

    expect(smoke.ok).toBe(true);
    expect(requested).toEqual([
      "http://localhost:3000/health",
      "http://localhost:3000/platform/foundation",
      "http://localhost:3000/workspace-model",
      "http://localhost:3000/workspace-model/preview",
    ]);
  });

  it("returns non-zero when any runtime smoke endpoint fails", async () => {
    const fetcher = async (input: string | URL | Request): Promise<Response> =>
      String(input).endsWith("/workspace-model")
        ? jsonResponse({ error: "not ready" }, { status: 503 })
        : jsonResponse({ ok: true });

    const result = await runReleaseCli({
      args: ["runtime", "smoke"],
      env: {
        SARATHI_PUBLIC_BASE_URL: "https://sarathi.example.test/",
      },
      fetcher,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatchObject({
      baseUrl: "https://sarathi.example.test",
      ok: false,
    });
  });

  it("fails Railway deploy until a real Railway release path is configured", async () => {
    const fetcher = async (): Promise<Response> => {
      throw new Error("unexpected fetch");
    };

    const result = await runReleaseCli({
      args: ["railway", "--ci", "--json"],
      env: {},
      fetcher,
    });

    expect(result.exitCode).toBe(2);
    expect(result.output).toMatchObject({
      ok: false,
      provider: "railway",
      configured: false,
    });
  });

  it("refuses Railway deploy even when Railway ids are present", async () => {
    const result = await runReleaseCli({
      args: ["railway", "--ci", "--json"],
      env: {
        RAILWAY_PROJECT_ID: "project-id",
        RAILWAY_SERVICE_ID: "service-id",
      },
      fetcher: async () => {
        throw new Error("unexpected fetch");
      },
    });

    expect(result.exitCode).toBe(2);
    expect(result.output).toMatchObject({
      ok: false,
      provider: "railway",
      configured: true,
    });
  });
});

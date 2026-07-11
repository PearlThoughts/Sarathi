import { describe, expect, it, vi } from "vitest";
import { createEntraClientCredentialsTokenProvider } from "../src/infrastructure/graph/index.ts";

describe("Entra client credentials Graph token provider", () => {
  it("caches a valid token and refreshes it near expiry", async () => {
    let clock = 0;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "first", expires_in: 120 })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "second", expires_in: 120 })),
      );
    const provider = createEntraClientCredentialsTokenProvider({
      tenantId: "tenant",
      clientId: "client",
      clientSecret: "synthetic-secret",
      fetcher: fetcher as unknown as typeof fetch,
      now: () => clock,
    });

    await expect(provider.getAccessToken()).resolves.toBe("first");
    await expect(provider.getAccessToken()).resolves.toBe("first");
    clock = 61_000;
    await expect(provider.getAccessToken()).resolves.toBe("second");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Entra rejects token acquisition", async () => {
    const provider = createEntraClientCredentialsTokenProvider({
      tenantId: "tenant",
      clientId: "client",
      clientSecret: "synthetic-secret",
      fetcher: (async () => new Response("denied", { status: 401 })) as unknown as typeof fetch,
    });
    await expect(provider.getAccessToken()).rejects.toThrow(
      "Entra token acquisition failed with HTTP 401",
    );
  });
});

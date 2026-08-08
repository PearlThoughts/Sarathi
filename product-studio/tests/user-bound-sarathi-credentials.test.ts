import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const serialized = JSON.stringify({
  "payload-user-synthetic": {
    actorId: "sarathi-actor-synthetic",
    accessToken: "user-access-token-synthetic",
    expiresAt: "2026-01-02T01:00:00.000Z",
  },
});

describe("Product Studio user-bound Sarathi credentials", () => {
  it("resolves only the credential mapped to the authenticated Payload user", async () => {
    const { createUserBoundSarathiCredentialProvider } = await import(
      "../src/server/user-bound-sarathi-credentials"
    );
    const provider = createUserBoundSarathiCredentialProvider(
      serialized,
      () => "2026-01-02T00:00:00.000Z",
    );

    expect(provider.resolve("payload-user-synthetic")).toEqual({
      actorId: "sarathi-actor-synthetic",
      accessToken: "user-access-token-synthetic",
      expiresAt: "2026-01-02T01:00:00.000Z",
    });
    expect(() => provider.resolve("payload-user-not-mapped")).toThrow(
      "A user-bound Sarathi credential is unavailable.",
    );
  });

  it("rejects expired credentials without exposing token material", async () => {
    const { createUserBoundSarathiCredentialProvider } = await import(
      "../src/server/user-bound-sarathi-credentials"
    );
    const provider = createUserBoundSarathiCredentialProvider(
      serialized,
      () => "2026-01-02T01:00:00.000Z",
    );

    expect(() => provider.resolve("payload-user-synthetic")).toThrow(
      "A user-bound Sarathi credential is unavailable.",
    );
    try {
      provider.resolve("payload-user-synthetic");
    } catch (error) {
      expect(String(error)).not.toContain("user-access-token-synthetic");
    }
  });

  it("fails closed for malformed configuration", async () => {
    const { createUserBoundSarathiCredentialProvider } = await import(
      "../src/server/user-bound-sarathi-credentials"
    );

    expect(() => createUserBoundSarathiCredentialProvider("not-json")).toThrow(
      "A user-bound Sarathi credential is unavailable.",
    );
    expect(() =>
      createUserBoundSarathiCredentialProvider(
        JSON.stringify({ "payload-user-synthetic": { accessToken: "too-short" } }),
      ),
    ).toThrow("A user-bound Sarathi credential is unavailable.");
  });
});

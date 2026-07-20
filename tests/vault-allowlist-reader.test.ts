import { describe, expect, it } from "vitest";
import {
  createGitHubVaultAllowlistReader,
  vaultAllowlistFromEnvironment,
} from "../src/infrastructure/vault/index.ts";

const allowlist = () =>
  vaultAllowlistFromEnvironment({
    SARATHI_VAULT_ALLOWLIST_JSON: JSON.stringify({
      documents: [
        {
          workspaceId: "workspace",
          sourceKey: "vault:delivery",
          repository: "example-org/approved-vault",
          path: "Workspaces/example/approved-note.md",
          ref: "main",
          sensitivity: "internal",
          consentScope: "example-delivery",
        },
        {
          workspaceId: "other",
          sourceKey: "vault:delivery",
          repository: "example-org/approved-vault",
          path: "Workspaces/other/excluded.md",
          sensitivity: "internal",
        },
      ],
    }),
  });

describe("GitHub Vault allowlist reader", () => {
  it("retrieves only the exact allowlisted workspace and source key at runtime", async () => {
    const requests: string[] = [];
    const reader = createGitHubVaultAllowlistReader({
      token: "synthetic-token",
      allowlist: allowlist(),
      fetcher: (async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/contents/"))
          return new Response(
            JSON.stringify({
              type: "file",
              encoding: "base64",
              content: Buffer.from("# Approved note\nEvidence for the delivery team.").toString(
                "base64",
              ),
              sha: "commit",
              html_url: "https://github.example.test/example-org/approved-vault/blob/main/note.md",
            }),
            { status: 200 },
          );
        return new Response(
          JSON.stringify([{ commit: { committer: { date: "2026-07-12T00:00:00.000Z" } } }]),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });

    await expect(
      reader.readEvidence({ workspaceId: "workspace", sourceKey: "vault:delivery" }),
    ).resolves.toEqual({
      records: [
        expect.objectContaining({
          sourceSystem: "vault",
          externalId: "example-org/approved-vault:Workspaces/example/approved-note.md@commit",
          title: "Approved note",
          bodyExcerpt: "Approved note Evidence for the delivery team.",
          sensitivity: "internal",
          consent: expect.objectContaining({ scope: "example-delivery" }),
        }),
      ],
    });
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.includes("approved-note.md"))).toBe(true);
  });

  it("does not retrieve any document outside the requested workspace boundary", async () => {
    const reader = createGitHubVaultAllowlistReader({
      token: "synthetic-token",
      allowlist: allowlist(),
      fetcher: (async () => {
        throw new Error("must not fetch an unapproved document");
      }) as unknown as typeof fetch,
    });

    await expect(
      reader.readEvidence({ workspaceId: "workspace", sourceKey: "vault:other" }),
    ).resolves.toEqual({
      records: [],
    });
  });

  it("rejects absent allowlist configuration", () => {
    expect(() => vaultAllowlistFromEnvironment({})).toThrow(
      "SARATHI_VAULT_ALLOWLIST_JSON is required",
    );
  });

  it("rejects raw evidence fields in private configuration", () => {
    expect(() =>
      vaultAllowlistFromEnvironment({
        SARATHI_VAULT_ALLOWLIST_JSON: JSON.stringify({
          documents: [
            {
              workspaceId: "workspace",
              sourceKey: "vault:delivery",
              repository: "example-org/approved-vault",
              path: "Workspaces/example/approved-note.md",
              sensitivity: "internal",
              body: "confidential note text",
            },
          ],
        }),
      }),
    ).toThrow("may not contain raw evidence fields");
  });
});

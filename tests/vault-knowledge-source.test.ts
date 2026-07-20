import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createVaultKnowledgeSource } from "../src/infrastructure/vault/vault-knowledge-source.ts";

const markdown = "# Delivery Risks\nApproved risk and next action.\n\n## Status\nIn progress.";

describe("Vault knowledge source", () => {
  it("indexes only Markdown below approved roots and preserves revision citations and ACL", async () => {
    const requests: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/git/trees/")) {
        return Response.json({
          sha: "tree-sha",
          truncated: false,
          tree: [
            { path: "Projects/1851/Risks.md", type: "blob", sha: "note-sha" },
            { path: "Projects/Other/Private.md", type: "blob", sha: "other-sha" },
            { path: "Projects/1851/image.png", type: "blob", sha: "image-sha" },
          ],
        });
      }
      if (url.includes("/commits/")) {
        return Response.json({
          sha: "commit-sha",
          commit: { committer: { date: "2026-07-20T03:00:00.000Z" } },
        });
      }
      if (url.includes("/contents/")) {
        return Response.json({
          type: "file",
          encoding: "base64",
          content: Buffer.from(markdown).toString("base64"),
          sha: "note-sha",
        });
      }
      return new Response("not found", { status: 404 });
    };
    const source = createVaultKnowledgeSource({
      sourceId: "vault-1851",
      workspaceId: "1851",
      token: "synthetic-token",
      roots: [
        {
          repository: "example/Approved-Vault",
          pathPrefix: "Projects/1851",
          sensitivity: "internal",
          acl: [{ effect: "allow", subjectType: "audience", subjectId: "delivery" }],
        },
      ],
      fetcher: fetcher as typeof fetch,
    });

    const snapshot = await Effect.runPromise(source.readSnapshot("1851"));

    expect(snapshot.documents).toHaveLength(1);
    expect(snapshot.documents[0]).toMatchObject({
      externalId: "example/Approved-Vault:Projects/1851/Risks.md",
      sourceVersion: "note-sha",
      title: "Delivery Risks",
      canonicalUrl:
        "https://github.com/example/Approved-Vault/blob/commit-sha/Projects/1851/Risks.md",
      acl: [{ subjectId: "delivery" }],
    });
    expect(snapshot.documents[0]?.passages.map(({ locator }) => locator)).toEqual([
      "#delivery-risks",
      "#status",
    ]);
    expect(requests.some((url) => url.includes("Projects/Other"))).toBe(false);
  });

  it("fails on a truncated tree instead of silently claiming complete deletion reconciliation", async () => {
    const source = createVaultKnowledgeSource({
      sourceId: "vault-1851",
      workspaceId: "1851",
      token: "synthetic-token",
      roots: [
        {
          repository: "example/Approved-Vault",
          pathPrefix: "Projects/1851",
          sensitivity: "internal",
          acl: [{ effect: "allow", subjectType: "workspace", subjectId: "1851" }],
        },
      ],
      fetcher: (async (input: string | URL | Request) =>
        String(input).includes("/git/trees/")
          ? Response.json({ sha: "tree", truncated: true, tree: [] })
          : Response.json({
              sha: "commit",
              commit: { committer: { date: "2026-07-20T03:00:00.000Z" } },
            })) as typeof fetch,
    });

    await expect(Effect.runPromise(source.readSnapshot("1851"))).rejects.toThrow(
      "Approved Vault knowledge synchronization failed",
    );
  });
});

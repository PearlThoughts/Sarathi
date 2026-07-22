import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createVaultKnowledgeSource } from "../src/infrastructure/vault/vault-knowledge-source.ts";

const markdown = `# Delivery Risks
Hosting delay threatens launch and affects DEMO-7.

## Status
In progress.

## Scope
Modern Website Builder and Admin Portal are in scope.

## Requirements
Responsive templates must pass QA.

## Ownership
Website team owns the builder module.

## Dependencies
Release waits on DEMO-8.

## Decisions
Use the shared component library.

## Next Action
Finish QA and release the builder.`;

describe("Vault knowledge source", () => {
  it("indexes only Markdown below configured roots and preserves revision citations and ACL", async () => {
    const requests: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/git/trees/")) {
        return Response.json({
          sha: "tree-sha",
          truncated: false,
          tree: [
            { path: "Projects/example/Risks.md", type: "blob", sha: "note-sha" },
            { path: "Projects/example/Empty.md", type: "blob", sha: "empty-note-sha" },
            {
              path: "Projects/example/Excluded Communications/private.md",
              type: "blob",
              sha: "private-sha",
            },
            { path: "Projects/Other/Private.md", type: "blob", sha: "other-sha" },
            { path: "Projects/example/image.png", type: "blob", sha: "image-sha" },
          ],
        });
      }
      if (url.includes("/commits/")) {
        return Response.json({
          sha: "commit-sha",
          commit: { committer: { date: "2026-07-20T03:00:00.000Z" } },
        });
      }
      if (url.includes("/git/blobs/note-sha")) {
        return Response.json({
          encoding: "base64",
          content: Buffer.from(markdown).toString("base64"),
          sha: "note-sha",
        });
      }
      if (url.includes("/git/blobs/empty-note-sha")) {
        return Response.json({
          encoding: "base64",
          content: Buffer.from("  \n\n").toString("base64"),
          sha: "empty-note-sha",
        });
      }
      return new Response("not found", { status: 404 });
    };
    const source = createVaultKnowledgeSource({
      sourceId: "vault-example",
      workspaceId: "example",
      token: "synthetic-token",
      roots: [
        {
          repository: "example/Connected-Vault",
          pathPrefix: "Projects/example",
          excludePathPrefixes: ["Projects/example/Excluded Communications"],
          sensitivity: "internal",
          acl: [{ effect: "allow", subjectType: "audience", subjectId: "delivery" }],
        },
      ],
      fetcher: fetcher as typeof fetch,
    });

    const snapshot = await Effect.runPromise(source.readSnapshot("example"));

    expect(snapshot.mode).toBe("full");
    expect(snapshot.cursor).toMatch(/^vault-v1:/);
    expect(snapshot.documents).toHaveLength(1);
    expect(snapshot.documents[0]).toMatchObject({
      externalId: "example/Connected-Vault:Projects/example/Risks.md",
      sourceVersion: "note-sha",
      title: "Delivery Risks",
      canonicalUrl:
        "https://github.com/example/Connected-Vault/blob/commit-sha/Projects/example/Risks.md",
      provenance: {
        repository: "example/Connected-Vault",
        path: "Projects/example/Risks.md",
        revision: "note-sha",
      },
      acl: [{ subjectId: "delivery" }],
    });
    expect(snapshot.documents[0]?.passages.map(({ locator }) => locator)).toEqual([
      "#delivery-risks",
      "#status",
      "#scope",
      "#requirements",
      "#ownership",
      "#dependencies",
      "#decisions",
      "#next-action",
    ]);
    expect(snapshot.documents[0]?.deliveryProjection).toMatchObject({
      objects: expect.arrayContaining([
        expect.objectContaining({ kind: "project", lifecycleState: "in_progress" }),
        expect.objectContaining({
          kind: "risk",
          title: "Hosting delay threatens launch and affects DEMO-7.",
        }),
        expect.objectContaining({
          kind: "module",
          title: "Modern Website Builder and Admin Portal are in scope.",
        }),
        expect.objectContaining({
          kind: "requirement",
          title: "Responsive templates must pass QA.",
        }),
        expect.objectContaining({ kind: "team", title: "Website team owns the builder module." }),
        expect.objectContaining({ kind: "decision", title: "Use the shared component library." }),
        expect.objectContaining({
          kind: "action",
          title: "Finish QA and release the builder.",
        }),
        expect.objectContaining({ kind: "work_item", externalKey: "DEMO-8" }),
      ]),
      relations: expect.arrayContaining([
        expect.objectContaining({ kind: "owns" }),
        expect.objectContaining({
          kind: "depends_on",
          to: { kind: "work_item", externalKey: "DEMO-8" },
        }),
      ]),
      claims: expect.arrayContaining([
        expect.objectContaining({ predicate: "vault.status", value: "In progress." }),
        expect.objectContaining({ predicate: "vault.risk" }),
      ]),
    });
    expect(requests.some((url) => url.includes("Projects/Other"))).toBe(false);
    expect(requests.some((url) => url.includes("private.md"))).toBe(false);
    expect(requests.some((url) => url.includes("/git/blobs/note-sha"))).toBe(true);
    expect(requests.some((url) => url.includes("/git/blobs/empty-note-sha"))).toBe(true);
  });

  it("uses immutable blob identities to fetch only changes and retire renames", async () => {
    let revision = 1;
    const requests: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/git/trees/"))
        return Response.json({
          sha: `tree-${revision}`,
          truncated: false,
          tree:
            revision === 1
              ? [
                  { path: "Projects/example/A.md", type: "blob", sha: "a-sha" },
                  { path: "Projects/example/B.md", type: "blob", sha: "b-sha" },
                ]
              : [
                  { path: "Projects/example/A.md", type: "blob", sha: "a-sha" },
                  { path: "Projects/example/C.md", type: "blob", sha: "b-sha" },
                ],
        });
      if (url.includes("/commits/"))
        return Response.json({
          sha: `commit-${revision}`,
          commit: { committer: { date: `2026-07-2${revision}T03:00:00.000Z` } },
        });
      if (url.includes("/git/blobs/a-sha"))
        return Response.json({
          encoding: "base64",
          content: Buffer.from("# A\nUnchanged knowledge.").toString("base64"),
          sha: "a-sha",
        });
      if (url.includes("/git/blobs/b-sha"))
        return Response.json({
          encoding: "base64",
          content: Buffer.from("# Renamed\nSame content, new path.").toString("base64"),
          sha: "b-sha",
        });
      return new Response("not found", { status: 404 });
    };
    const source = createVaultKnowledgeSource({
      sourceId: "vault-example",
      workspaceId: "example",
      token: "synthetic-token",
      roots: [
        {
          repository: "example/Connected-Vault",
          pathPrefix: "Projects/example",
          sensitivity: "internal",
          acl: [{ effect: "allow", subjectType: "workspace", subjectId: "example" }],
        },
      ],
      fetcher: fetcher as typeof fetch,
    });

    const first = await Effect.runPromise(source.readSnapshot("example"));
    revision = 2;
    const delta = await Effect.runPromise(source.readSnapshot("example", first.cursor));

    expect(first).toMatchObject({ mode: "full", retiredExternalIds: [] });
    expect(first.documents).toHaveLength(2);
    expect(delta).toMatchObject({
      mode: "delta",
      retiredExternalIds: ["example/Connected-Vault:Projects/example/B.md"],
    });
    expect(delta.documents.map(({ externalId }) => externalId)).toEqual([
      "example/Connected-Vault:Projects/example/C.md",
    ]);
    expect(requests.filter((url) => url.includes("/git/blobs/a-sha"))).toHaveLength(1);
    expect(requests.filter((url) => url.includes("/git/blobs/b-sha"))).toHaveLength(2);
  });

  it("fails on a truncated tree instead of silently claiming complete deletion reconciliation", async () => {
    const source = createVaultKnowledgeSource({
      sourceId: "vault-example",
      workspaceId: "example",
      token: "synthetic-token",
      roots: [
        {
          repository: "example/Connected-Vault",
          pathPrefix: "Projects/example",
          sensitivity: "internal",
          acl: [{ effect: "allow", subjectType: "workspace", subjectId: "example" }],
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

    await expect(Effect.runPromise(source.readSnapshot("example"))).rejects.toThrow(
      "Configured Vault knowledge synchronization failed",
    );
  });
});

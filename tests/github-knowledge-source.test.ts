import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createGitHubKnowledgeSource,
  type GitHubKnowledgeRepository,
  type GitHubKnowledgeSourceConfiguration,
} from "../src/infrastructure/github/github-knowledge-source.ts";

const configuredRepository = (): GitHubKnowledgeRepository => ({
  repository: "example/sarathi",
  sensitivity: "internal",
  acl: [{ effect: "allow", subjectType: "audience", subjectId: "delivery" }],
});

const emptyActivities = (url: string): Response | undefined => {
  if (url.includes("/pulls?")) return Response.json([]);
  if (url.includes("/commits?") && url.includes("since=")) return Response.json([]);
  if (url.includes("/releases?")) return Response.json([]);
  if (url.includes("/deployments?")) return Response.json([]);
  if (url.includes("/check-runs?")) return Response.json({ check_runs: [] });
  return undefined;
};

describe("GitHub knowledge source", () => {
  it("bootstraps an exact default-branch revision with symbol passages and delivery activity", async () => {
    const requests: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/repos/example/sarathi")) return Response.json({ default_branch: "main" });
      if (url.endsWith("/commits/main"))
        return Response.json({
          sha: "commit-1",
          commit: { committer: { date: "2026-07-20T12:00:00.000Z" } },
        });
      if (url.includes("/git/trees/commit-1"))
        return Response.json({
          truncated: false,
          tree: [
            { path: "src/service.ts", type: "blob", sha: "service-1" },
            { path: "dist/generated.js", type: "blob", sha: "generated-1" },
            { path: ".env.production", type: "blob", sha: "secret-1" },
            { path: "assets/logo.png", type: "blob", sha: "image-1" },
          ],
        });
      if (url.includes("/git/blobs/service-1"))
        return Response.json({
          type: "blob",
          encoding: "base64",
          content: Buffer.from(
            "export function synchronize(): void {\n  console.log('sync');\n}\n\nexport class RepairWorker {}",
          ).toString("base64"),
          sha: "service-1",
          size: 102,
        });
      if (url.includes("/pulls?"))
        return Response.json([
          {
            number: 42,
            title: "KLG-524 add repository synchronization",
            body: "Implements SAR-42 with changed-file repair.",
            html_url: "https://github.com/example/sarathi/pull/42",
            state: "closed",
            created_at: "2026-07-18T08:00:00.000Z",
            updated_at: "2026-07-20T11:00:00.000Z",
            merged_at: "2026-07-20T10:00:00.000Z",
            merge_commit_sha: "commit-1",
            user: { login: "delivery-engineer" },
            head: { sha: "head-42" },
          },
        ]);
      if (url.includes("/pulls/42/reviews"))
        return Response.json([
          {
            id: 7,
            state: "APPROVED",
            submitted_at: "2026-07-20T09:00:00.000Z",
            html_url: "https://github.com/example/sarathi/pull/42#pullrequestreview-7",
            user: { login: "reviewer" },
            commit_id: "head-42",
          },
        ]);
      if (url.includes("/pulls/42/files"))
        return Response.json([{ filename: "src/service.ts", status: "modified" }]);
      if (url.includes("/commits?") && url.includes("since="))
        return Response.json([
          {
            sha: "commit-1",
            html_url: "https://github.com/example/sarathi/commit/commit-1",
            commit: {
              message: "SAR-42 converge repository sync",
              committer: { date: "2026-07-20T10:00:00.000Z" },
            },
            author: { login: "delivery-engineer" },
          },
        ]);
      if (url.includes("/releases?")) return Response.json([]);
      if (url.includes("/deployments?")) return Response.json([]);
      if (url.includes("/check-runs?"))
        return Response.json({
          check_runs: [
            {
              id: 9,
              name: "CI",
              html_url: "https://github.com/example/sarathi/actions/runs/9",
              status: "completed",
              conclusion: "success",
              completed_at: "2026-07-20T11:30:00.000Z",
              app: { name: "GitHub Actions" },
            },
          ],
        });
      return new Response("not found", { status: 404 });
    };
    const configuration: GitHubKnowledgeSourceConfiguration = {
      sourceId: "github-example",
      workspaceId: "example",
      token: "synthetic-token",
      historySince: "2026-01-20T00:00:00.000Z",
      now: () => new Date("2026-07-22T00:00:00.000Z"),
      repositories: [configuredRepository()],
      fetcher,
    };
    const source = createGitHubKnowledgeSource(configuration);

    const snapshot = await Effect.runPromise(source.readSnapshot("example"));

    expect(snapshot).toMatchObject({ source: "github", mode: "full", retiredExternalIds: [] });
    expect(snapshot.cursor).toMatch(/^github-v1:/);
    expect(snapshot.documents.map(({ externalId }) => externalId)).toEqual([
      "example/sarathi:activity:check:9",
      "example/sarathi:activity:commit:commit-1",
      "example/sarathi:activity:pull_request:42",
      "example/sarathi:activity:review:7",
      "example/sarathi:src/service.ts",
    ]);
    const code = snapshot.documents.find(({ sourceType }) => sourceType === "code");
    expect(code).toMatchObject({
      sourceVersion: "service-1",
      canonicalUrl: "https://github.com/example/sarathi/blob/commit-1/src/service.ts",
      provenance: { repository: "example/sarathi", branch: "main", revision: "commit-1" },
      acl: [{ subjectId: "delivery" }],
    });
    expect(code?.passages.map(({ locator }) => locator)).toEqual([
      "#L1-L4:synchronize",
      "#L5-L5:RepairWorker",
    ]);
    const pull = snapshot.documents.find(({ sourceType }) => sourceType === "pull_request");
    expect(pull).toMatchObject({
      provenance: { changedFiles: "src/service.ts" },
      deliveryProjection: {
        objects: expect.arrayContaining([
          expect.objectContaining({ kind: "work_item", externalKey: "SAR-42" }),
          expect.objectContaining({ kind: "person", externalKey: "github:delivery-engineer" }),
        ]),
        observations: [
          expect.objectContaining({
            kind: "pull_request",
            actorExternalKey: "github:delivery-engineer",
          }),
        ],
      },
    });
    expect(requests.some((url) => url.includes("/git/trees/commit-1"))).toBe(true);
    expect(requests.some((url) => /generated-1|secret-1|image-1/.test(url))).toBe(false);
  });

  it("fetches only changed blobs and retires deleted or renamed paths on repair", async () => {
    let revision = 1;
    const requests: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      requests.push(url);
      const empty = emptyActivities(url);
      if (empty !== undefined) return empty;
      if (url.endsWith("/repos/example/sarathi")) return Response.json({ default_branch: "main" });
      if (url.endsWith("/commits/main"))
        return Response.json({
          sha: `commit-${revision}`,
          commit: { committer: { date: `2026-07-2${revision}T12:00:00.000Z` } },
        });
      if (url.includes(`/git/trees/commit-${revision}`))
        return Response.json({
          tree:
            revision === 1
              ? [
                  { path: "src/a.ts", type: "blob", sha: "a-1" },
                  { path: "src/old.ts", type: "blob", sha: "renamed-1" },
                ]
              : [
                  { path: "src/a.ts", type: "blob", sha: "a-1" },
                  { path: "src/new.ts", type: "blob", sha: "renamed-1" },
                ],
        });
      if (url.includes("/git/blobs/a-1"))
        return Response.json({
          encoding: "base64",
          content: Buffer.from("export const a = 1;").toString("base64"),
          sha: "a-1",
        });
      if (url.includes("/git/blobs/renamed-1"))
        return Response.json({
          encoding: "base64",
          content: Buffer.from("export const renamed = true;").toString("base64"),
          sha: "renamed-1",
        });
      return new Response("not found", { status: 404 });
    };
    const source = createGitHubKnowledgeSource({
      sourceId: "github-example",
      workspaceId: "example",
      token: "synthetic-token",
      historySince: "2026-01-20T00:00:00.000Z",
      repositories: [
        {
          repository: "example/sarathi",
          sensitivity: "internal",
          acl: [{ effect: "allow", subjectType: "workspace", subjectId: "example" }],
        },
      ],
      fetcher,
    });

    const first = await Effect.runPromise(source.readSnapshot("example"));
    revision = 2;
    const delta = await Effect.runPromise(source.readSnapshot("example", first.cursor));

    expect(delta).toMatchObject({
      mode: "delta",
      retiredExternalIds: ["example/sarathi:src/old.ts"],
    });
    expect(delta.documents.map(({ externalId }) => externalId)).toEqual([
      "example/sarathi:src/new.ts",
    ]);
    expect(requests.filter((url) => url.includes("/git/blobs/a-1"))).toHaveLength(1);
    expect(requests.filter((url) => url.includes("/git/blobs/renamed-1"))).toHaveLength(2);
  });

  it("treats an authorized empty repository as zero evidence", async () => {
    const requests: string[] = [];
    const source = createGitHubKnowledgeSource({
      sourceId: "github-example",
      workspaceId: "example",
      token: "synthetic-token",
      historySince: "2026-01-20T00:00:00.000Z",
      repositories: [configuredRepository()],
      fetcher: async (input: string | URL | Request) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith("/repos/example/sarathi"))
          return Response.json({ default_branch: "main" });
        if (url.endsWith("/commits/main"))
          return Response.json({ message: "Git Repository is empty." }, { status: 409 });
        return new Response("unexpected request", { status: 500 });
      },
    });

    const snapshot = await Effect.runPromise(source.readSnapshot("example"));

    expect(snapshot).toMatchObject({
      source: "github",
      mode: "full",
      documents: [],
      retiredExternalIds: [],
    });
    expect(snapshot.cursor).toMatch(/^github-v1:/);
    expect(requests).toEqual([
      "https://api.github.com/repos/example/sarathi",
      "https://api.github.com/repos/example/sarathi/commits/main",
    ]);
  });

  it("waits for the declared GitHub core reset and resumes the exact request", async () => {
    const now = new Date("2026-07-22T00:00:00.000Z");
    const waits: number[] = [];
    let metadataRequests = 0;
    const source = createGitHubKnowledgeSource({
      sourceId: "github-example",
      workspaceId: "example",
      token: "synthetic-token",
      historySince: "2026-01-20T00:00:00.000Z",
      now: () => now,
      delay: async (milliseconds) => {
        waits.push(milliseconds);
      },
      repositories: [configuredRepository()],
      fetcher: async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/repos/example/sarathi")) {
          metadataRequests += 1;
          if (metadataRequests === 1)
            return Response.json(
              { message: "API rate limit exceeded." },
              {
                status: 403,
                headers: {
                  "x-ratelimit-remaining": "0",
                  "x-ratelimit-reset": String(now.getTime() / 1_000 + 1),
                },
              },
            );
          return Response.json({ default_branch: "main" });
        }
        if (url.endsWith("/commits/main"))
          return Response.json({ message: "Git Repository is empty." }, { status: 409 });
        return new Response("unexpected request", { status: 500 });
      },
    });

    const snapshot = await Effect.runPromise(source.readSnapshot("example"));

    expect(snapshot.documents).toEqual([]);
    expect(metadataRequests).toBe(2);
    expect(waits).toEqual([2_000]);
  });

  it("fails closed for truncated inventories", async () => {
    const source = createGitHubKnowledgeSource({
      sourceId: "github-example",
      workspaceId: "example",
      token: "synthetic-token",
      repositories: [
        {
          repository: "example/sarathi",
          sensitivity: "internal",
          acl: [{ effect: "allow", subjectType: "workspace", subjectId: "example" }],
        },
      ],
      fetcher: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/repos/example/sarathi"))
          return Response.json({ default_branch: "main" });
        if (url.endsWith("/commits/main"))
          return Response.json({
            sha: "commit-1",
            commit: { committer: { date: "2026-07-20T12:00:00.000Z" } },
          });
        if (url.includes("/git/trees/commit-1"))
          return Response.json({ truncated: true, tree: [] });
        return new Response("not found", { status: 404 });
      }) as typeof fetch,
    });

    await expect(Effect.runPromise(source.readSnapshot("example"))).rejects.toThrow(
      "Configured GitHub knowledge synchronization failed",
    );
  });
});

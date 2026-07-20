import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { createGitHubKnowledgeSearch } from "../src/infrastructure/github/github-knowledge-search.ts";

const audience = {
  workspaceId: "workspace-1851",
  audienceIds: ["delivery"],
  maximumSensitivity: "internal",
} as const;

describe("GitHub live knowledge search", () => {
  test("queries only approved repositories and returns resolvable issue and code citations", async () => {
    const requests: string[] = [];
    const search = createGitHubKnowledgeSearch({
      token: "secret-test-token",
      workspaceId: "workspace-1851",
      allowedAudienceIds: new Set(["delivery"]),
      allowedRepositories: ["senguttuvang/1851-Pulse"],
      now: () => new Date("2026-07-20T00:00:00.000Z"),
      fetcher: async (input) => {
        const url = String(input);
        requests.push(url);
        const isCode = url.includes("/search/code");
        return new Response(
          JSON.stringify({
            incomplete_results: false,
            items: [
              isCode
                ? {
                    html_url:
                      "https://github.com/senguttuvang/1851-Pulse/blob/abc/src/report.ts#L10",
                    name: "report.ts",
                    path: "src/report.ts",
                    repository_url: "https://api.github.com/repos/senguttuvang/1851-Pulse",
                    text_matches: [{ fragment: "Modern Website Builder status aggregation" }],
                  }
                : {
                    html_url: "https://github.com/senguttuvang/1851-Pulse/issues/1",
                    number: 1,
                    title: "Delivery status",
                    updated_at: "2026-07-19T00:00:00.000Z",
                    body: "Approved risks and next action",
                    repository_url: "https://api.github.com/repos/senguttuvang/1851-Pulse",
                  },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const results = await Effect.runPromise(
      search.search({ question: "Modern Website Builder", audience, topK: 10 }),
    );

    expect(requests).toHaveLength(2);
    expect(requests.every((url) => url.includes("repo%3Asenguttuvang%2F1851-Pulse"))).toBe(true);
    expect(results.map(({ sourceId }) => sourceId)).toEqual([
      "senguttuvang/1851-Pulse#1",
      "senguttuvang/1851-Pulse:src/report.ts",
    ]);
    expect(results.every(({ citationUrl }) => citationUrl.startsWith("https://github.com/"))).toBe(
      true,
    );
    expect(JSON.stringify(results)).not.toContain("secret-test-token");
  });

  test("filters an unauthorized workspace before any GitHub request", async () => {
    let requested = false;
    const search = createGitHubKnowledgeSearch({
      token: "secret-test-token",
      workspaceId: "workspace-1851",
      allowedAudienceIds: new Set(["delivery"]),
      allowedRepositories: ["senguttuvang/1851-Pulse"],
      fetcher: async () => {
        requested = true;
        return new Response("{}", { status: 200 });
      },
    });
    const results = await Effect.runPromise(
      search.search({
        question: "status",
        audience: { ...audience, workspaceId: "another-workspace" },
        topK: 10,
      }),
    );
    expect(results).toEqual([]);
    expect(requested).toBe(false);
  });
});

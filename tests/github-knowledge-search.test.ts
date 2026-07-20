import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { createGitHubKnowledgeSearch } from "../src/infrastructure/github/github-knowledge-search.ts";

const audience = {
  workspaceId: "workspace-example",
  audienceIds: ["delivery"],
  maximumSensitivity: "internal",
} as const;

describe("GitHub live knowledge search", () => {
  test("queries only approved repositories and returns resolvable issue and code citations", async () => {
    const requests: string[] = [];
    const search = createGitHubKnowledgeSearch({
      token: "secret-test-token",
      workspaceId: "workspace-example",
      allowedAudienceIds: new Set(["delivery"]),
      allowedRepositories: ["example-org/delivery-pulse"],
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
                      "https://github.com/example-org/delivery-pulse/blob/abc/src/report.ts#L10",
                    name: "report.ts",
                    path: "src/report.ts",
                    repository_url: "https://api.github.com/repos/example-org/delivery-pulse",
                    text_matches: [{ fragment: "Example Delivery Portal status aggregation" }],
                  }
                : {
                    html_url: "https://github.com/example-org/delivery-pulse/issues/1",
                    number: 1,
                    title: "Delivery status",
                    updated_at: "2026-07-19T00:00:00.000Z",
                    body: "Approved risks and next action",
                    repository_url: "https://api.github.com/repos/example-org/delivery-pulse",
                  },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const results = await Effect.runPromise(
      search.search({ question: "Example Delivery Portal", audience, topK: 10 }),
    );

    expect(requests).toHaveLength(2);
    expect(requests.every((url) => url.includes("repo%3Aexample-org%2Fdelivery-pulse"))).toBe(true);
    expect(results.map(({ sourceId }) => sourceId)).toEqual([
      "example-org/delivery-pulse#1",
      "example-org/delivery-pulse:src/report.ts",
    ]);
    expect(results.every(({ citationUrl }) => citationUrl.startsWith("https://github.com/"))).toBe(
      true,
    );
    expect(JSON.stringify(results)).not.toContain("secret-test-token");
  });

  test("reduces a conversational question to bounded GitHub search terms", async () => {
    const requests: string[] = [];
    const search = createGitHubKnowledgeSearch({
      token: "secret-test-token",
      workspaceId: "workspace-example",
      allowedAudienceIds: new Set(["delivery"]),
      allowedRepositories: ["example-org/delivery-pulse"],
      fetcher: async (input) => {
        requests.push(String(input));
        return new Response(JSON.stringify({ incomplete_results: false, items: [] }), {
          status: 200,
        });
      },
    });

    await Effect.runPromise(
      search.search({
        question: "Which CLI command generated the fresh weekly activity pulse report?",
        audience,
        topK: 10,
      }),
    );

    expect(requests).toHaveLength(2);
    expect(
      requests.every(
        (request) =>
          new URL(request).searchParams.get("q") ===
          "fresh weekly activity pulse report repo:example-org/delivery-pulse",
      ),
    ).toBe(true);
  });

  test("filters an unauthorized workspace before any GitHub request", async () => {
    let requested = false;
    const search = createGitHubKnowledgeSearch({
      token: "secret-test-token",
      workspaceId: "workspace-example",
      allowedAudienceIds: new Set(["delivery"]),
      allowedRepositories: ["example-org/delivery-pulse"],
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

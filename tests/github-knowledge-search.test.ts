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
      allowedRepositories: ["example-org/delivery-pulse", "example-org/delivery-vault"],
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
                    text_matches: [{ fragment: "Delivery status" }],
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
    expect(requests.every((url) => !url.includes("delivery-vault"))).toBe(true);
    expect(results.map(({ sourceId }) => sourceId)).toEqual([
      "example-org/delivery-pulse#1",
      "example-org/delivery-pulse:src/report.ts",
    ]);
    expect(results.every(({ citationUrl }) => citationUrl.startsWith("https://github.com/"))).toBe(
      true,
    );
    expect(results.map(({ excerpt }) => excerpt)).toEqual([
      "Approved risks and next action",
      "Example Delivery Portal status aggregation",
    ]);
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

  test("searches a configured repository scope and rejects similarly named repositories outside it", async () => {
    const requests: string[] = [];
    const search = createGitHubKnowledgeSearch({
      token: "secret-test-token",
      workspaceId: "workspace-example",
      allowedAudienceIds: new Set(["delivery"]),
      repositoryScopes: [
        { owner: "example-org", ownerType: "org", repositoryNamePrefix: "delivery-" },
      ],
      fetcher: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/search/code"))
          return Response.json({
            incomplete_results: false,
            items: [
              {
                html_url: "https://github.com/example-org/delivery-api/blob/abc/src/report.ts#L10",
                path: "src/report.ts",
                repository: { full_name: "example-org/delivery-api" },
                text_matches: [{ fragment: "Current implementation status" }],
              },
              {
                html_url: "https://github.com/example-org/delivery-vault/blob/abc/Status.md#L1",
                path: "Status.md",
                repository: { full_name: "example-org/delivery-vault" },
                text_matches: [{ fragment: "Must remain in canonical Vault retrieval" }],
              },
            ],
          });
        return Response.json({
          incomplete_results: false,
          items: [
            {
              html_url: "https://github.com/example-org/delivery-api/issues/9",
              number: 9,
              title: "Scoped result",
              body: "Current implementation status",
              updated_at: "2026-07-20T00:00:00.000Z",
              repository_url: "https://api.github.com/repos/example-org/delivery-api",
            },
            {
              html_url: "https://github.com/example-org/finance-api/issues/1",
              number: 1,
              title: "Out of scope",
              body: "Must not leave the configured delivery boundary",
              updated_at: "2026-07-20T00:00:00.000Z",
              repository_url: "https://api.github.com/repos/example-org/finance-api",
            },
            {
              html_url: "https://github.com/example-org/delivery-vault/issues/2",
              number: 2,
              title: "Vault result",
              body: "Canonical project note belongs in indexed Vault retrieval",
              updated_at: "2026-07-20T00:00:00.000Z",
              repository_url: "https://api.github.com/repos/example-org/delivery-vault",
            },
          ],
        });
      },
    });

    const results = await Effect.runPromise(
      search.search({ question: "implementation status", audience, topK: 10 }),
    );

    expect(requests).toHaveLength(2);
    expect(
      requests.every((url) => new URL(url).searchParams.get("q")?.includes("org:example-org")),
    ).toBe(true);
    expect(requests.every((url) => new URL(url).searchParams.get("per_page") === "100")).toBe(true);
    expect(results.map(({ sourceId }) => sourceId)).toEqual([
      "example-org/delivery-api#9",
      "example-org/delivery-api:src/report.ts",
    ]);
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

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createJiraKnowledgeSource } from "../src/infrastructure/jira/jira-knowledge-source.ts";

const configuration = (fetcher: typeof fetch) => ({
  sourceId: "jira-example",
  workspaceId: "example",
  baseUrl: "https://jira.example.test",
  email: "synthetic@example.test",
  apiToken: "synthetic-token",
  projectKey: "DEMO",
  approvedJql: "statusCategory != Done",
  fields: {
    summary: "Summary",
    status: "Status",
    description: "Description",
    updated: "Updated",
  },
  acl: [{ effect: "allow" as const, subjectType: "audience" as const, subjectId: "delivery" }],
  sensitivity: "internal" as const,
  fetcher,
});

describe("Jira knowledge source", () => {
  it("uses bounded enhanced JQL, paginates comments, and emits typed cited passages", async () => {
    const requests: { readonly url: string; readonly init: RequestInit | undefined }[] = [];
    const fetcher = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/rest/api/3/search/jql")) {
        return Response.json({
          issues: [
            {
              id: "100",
              key: "DEMO-100",
              fields: {
                summary: "Example Delivery Portal",
                status: { name: "In Progress" },
                description: {
                  type: "doc",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "Build active." }] },
                  ],
                },
                updated: "2026-07-20T01:00:00.000Z",
              },
            },
          ],
          isLast: true,
        });
      }
      if (url.includes("/comment?")) {
        return Response.json({
          comments: [
            {
              id: "900",
              body: {
                type: "doc",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Next action approved." }] },
                ],
              },
              updated: "2026-07-20T02:00:00.000Z",
              author: { accountId: "actor", displayName: "Synthetic Owner" },
            },
          ],
          startAt: 0,
          maxResults: 100,
          total: 1,
        });
      }
      return new Response("not found", { status: 404 });
    };

    const snapshot = await Effect.runPromise(
      createJiraKnowledgeSource(configuration(fetcher as typeof fetch)).readSnapshot("example"),
    );

    const searchBody = JSON.parse(String(requests[0]?.init?.body)) as { readonly jql: string };
    expect(searchBody.jql).toContain('project = "DEMO"');
    expect(searchBody.jql).toContain("statusCategory != Done");
    expect(snapshot).toMatchObject({
      sourceId: "jira-example",
      cursor: "2026-07-20T01:00:00.000Z",
    });
    expect(snapshot.documents[0]).toMatchObject({
      externalId: "DEMO-100",
      title: "Example Delivery Portal",
      canonicalUrl: "https://jira.example.test/browse/DEMO-100",
      acl: [{ subjectId: "delivery" }],
    });
    expect(snapshot.documents[0]?.passages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ locator: "#field-status", body: "In Progress" }),
        expect.objectContaining({ locator: "#comment-900", body: "Next action approved." }),
      ]),
    );
    expect(requests.every(({ init }) => !String(init?.headers).includes("synthetic-token"))).toBe(
      true,
    );
  });

  it("fails closed for another workspace", async () => {
    const source = createJiraKnowledgeSource(
      configuration((async () =>
        Response.json({ issues: [], isLast: true })) as unknown as typeof fetch),
    );
    await expect(Effect.runPromise(source.readSnapshot("finance"))).rejects.toThrow(
      "Approved Jira knowledge synchronization failed",
    );
  });
});

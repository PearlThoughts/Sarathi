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
  jql: "statusCategory != Done",
  fields: {
    summary: "Summary",
    status: "Status",
    description: "Description",
    updated: "Updated",
    issuetype: "Issue Type",
    assignee: "Assignee",
    sprint: "Sprint",
    components: "Components",
    issuelinks: "Issue Links",
    priority: "Priority",
    duedate: "Due Date",
    timeestimate: "Remaining Estimate",
    implementationcost: "Implementation Cost",
  },
  acl: [
    {
      effect: "allow" as const,
      subjectType: "audience" as const,
      subjectId: "delivery",
    },
  ],
  sensitivity: "internal" as const,
  fetcher,
});

describe("Jira knowledge source", () => {
  it("uses bounded enhanced JQL, paginates comments, and emits typed cited passages", async () => {
    const requests: {
      readonly url: string;
      readonly init: RequestInit | undefined;
    }[] = [];
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
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Build active." }],
                    },
                  ],
                },
                updated: "2026-07-20T01:00:00.000Z",
                issuetype: { name: "Story" },
                assignee: {
                  accountId: "owner-1",
                  displayName: "Synthetic Owner",
                },
                sprint: [
                  {
                    id: 7,
                    name: "Sprint 7",
                    state: "active",
                    startDate: "2026-07-14T00:00:00.000Z",
                    endDate: "2026-07-27T00:00:00.000Z",
                  },
                ],
                components: [
                  { id: "component-1", name: "Delivery Portal" },
                  { id: "component-1", name: "Delivery Portal" },
                ],
                priority: { name: "High" },
                duedate: "2026-07-25",
                timeestimate: 7200,
                implementationcost: "synthetic-finance-value",
                issuelinks: [
                  {
                    type: { inward: "is blocked by", outward: "blocks" },
                    inwardIssue: {
                      key: "DEMO-99",
                      fields: { summary: "Platform dependency" },
                    },
                  },
                  {
                    type: { inward: "is blocked by", outward: "blocks" },
                    inwardIssue: {
                      key: "DEMO-99",
                      fields: { summary: "Platform dependency" },
                    },
                  },
                ],
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
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Next action approved." }],
                  },
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

    const searchBody = JSON.parse(String(requests[0]?.init?.body)) as {
      readonly jql: string;
    };
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
        expect.objectContaining({
          locator: "#field-status",
          body: "In Progress",
        }),
        expect.objectContaining({
          locator: "#comment-900",
          body: "Next action approved.",
        }),
      ]),
    );
    expect(snapshot.documents[0]?.deliveryProjection).toMatchObject({
      objects: expect.arrayContaining([
        expect.objectContaining({ kind: "project", externalKey: "DEMO" }),
        expect.objectContaining({
          kind: "work_item",
          externalKey: "DEMO-100",
          lifecycleState: "in_progress",
          attributes: expect.objectContaining({
            priority: "High",
            dueAt: "2026-07-25",
          }),
        }),
        expect.objectContaining({
          kind: "requirement",
          externalKey: "DEMO-100",
        }),
        expect.objectContaining({ kind: "person", externalKey: "owner-1" }),
        expect.objectContaining({ kind: "sprint", externalKey: "7" }),
        expect.objectContaining({ kind: "module", externalKey: "component-1" }),
      ]),
      relations: expect.arrayContaining([
        expect.objectContaining({ kind: "assigned_to" }),
        expect.objectContaining({ kind: "depends_on" }),
        expect.objectContaining({ kind: "implements" }),
      ]),
      observations: expect.arrayContaining([
        expect.objectContaining({
          kind: "state",
          subject: expect.objectContaining({ externalKey: "DEMO-100" }),
        }),
        expect.objectContaining({ kind: "comment", externalId: "comment:900" }),
      ]),
      metrics: expect.arrayContaining([
        expect.objectContaining({
          category: "capacity",
          kind: "estimate_remaining_seconds",
          value: "7200",
        }),
      ]),
    });
    expect(JSON.stringify(snapshot)).not.toContain("synthetic-finance-value");
    expect(snapshot.documents[0]?.passages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ locator: "#field-implementationcost" })]),
    );
    const relations = snapshot.documents[0]?.deliveryProjection?.relations ?? [];
    const relationKeys = relations.map(
      (relation) =>
        `${relation.kind}:${relation.from.kind}:${relation.from.externalKey}:${relation.to.kind}:${relation.to.externalKey}`,
    );
    expect(new Set(relationKeys).size).toBe(relations.length);
    expect(requests.every(({ init }) => !String(init?.headers).includes("synthetic-token"))).toBe(
      true,
    );
  });

  it("fails closed for another workspace", async () => {
    const source = createJiraKnowledgeSource(
      configuration((async () =>
        Response.json({
          issues: [],
          isLast: true,
        })) as unknown as typeof fetch),
    );
    await expect(Effect.runPromise(source.readSnapshot("finance"))).rejects.toThrow(
      "Connected Jira knowledge synchronization failed",
    );
  });
});

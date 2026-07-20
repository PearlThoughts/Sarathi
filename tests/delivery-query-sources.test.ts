import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createGitHubDeliveryQuerySource } from "../src/infrastructure/github/index.ts";
import {
  createEmailDeliveryQuerySource,
  createTeamsDeliveryQuerySource,
} from "../src/infrastructure/graph/index.ts";
import { createJiraDeliveryQuerySource } from "../src/infrastructure/jira/index.ts";
import { planDeliveryQuestion } from "../src/modules/delivery-intelligence/index.ts";

const context = {
  workspaceId: "workspace-example",
  actorId: "actor-example",
  maximumSensitivity: "internal",
  financeAccess: false,
  requestedAt: "2026-07-20T13:09:00.000Z",
  timeZone: "Asia/Kolkata",
  deadlineAt: "2026-07-20T13:09:06.500Z",
  question: "Post team work summary",
} as const;
const activityPlan = planDeliveryQuestion(context.question);
if (activityPlan === undefined) throw new Error("Expected deterministic activity plan");

describe("delivery intelligence live query sources", () => {
  it("reads connected GitHub pull requests and commits without duplicating merge commits", async () => {
    const requests: string[] = [];
    const source = createGitHubDeliveryQuerySource({
      token: "test-token",
      workspaceId: context.workspaceId,
      allowedActorIds: new Set([context.actorId]),
      allowedRepositories: ["example/repo"],
      fetcher: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/pulls?"))
          return Response.json([
            {
              number: 7,
              title: "Ship daily summary",
              html_url: "https://github.com/example/repo/pull/7",
              updated_at: "2026-07-20T10:00:00.000Z",
              merged_at: "2026-07-20T10:00:00.000Z",
              merge_commit_sha: "merge-sha",
            },
          ]);
        return Response.json([
          {
            sha: "merge-sha",
            html_url: "https://github.com/example/repo/commit/merge-sha",
            commit: { message: "Merge pull request", committer: { date: "2026-07-20T10:00:00Z" } },
          },
          {
            sha: "abc123456789",
            html_url: "https://github.com/example/repo/commit/abc123456789",
            commit: { message: "Add delivery query", committer: { date: "2026-07-20T09:00:00Z" } },
          },
        ]);
      },
    });
    const result = await Effect.runPromise(source.execute(context, activityPlan));
    expect(requests).toHaveLength(2);
    expect(result.items.map(({ title }) => title)).toEqual([
      "Ship daily summary",
      "Add delivery query",
    ]);
    expect(result.items.map(({ citationUrl }) => citationUrl)).not.toContain(
      "https://github.com/example/repo/commit/merge-sha",
    );
  });

  it("enforces GitHub actor boundaries before provider access", async () => {
    let requests = 0;
    const source = createGitHubDeliveryQuerySource({
      token: "test-token",
      workspaceId: context.workspaceId,
      allowedActorIds: new Set([context.actorId]),
      allowedRepositories: ["example/repo"],
      fetcher: async () => {
        requests += 1;
        return Response.json([]);
      },
    });
    const result = await Effect.runPromise(
      source.execute({ ...context, actorId: "actor-other" }, activityPlan),
    );
    expect(result.items).toEqual([]);
    expect(requests).toBe(0);
  });

  it("reads organization-scoped activity and excludes repositories outside the configured prefix", async () => {
    const requests: string[] = [];
    const source = createGitHubDeliveryQuerySource({
      token: "test-token",
      workspaceId: context.workspaceId,
      allowedActorIds: new Set([context.actorId]),
      repositoryScopes: [
        { owner: "example-org", ownerType: "org", repositoryNamePrefix: "delivery-" },
      ],
      fetcher: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/search/issues"))
          return Response.json({
            items: [
              {
                number: 12,
                title: "Ship scoped report",
                html_url: "https://github.com/example-org/delivery-ui/pull/12",
                repository_url: "https://api.github.com/repos/example-org/delivery-ui",
                updated_at: "2026-07-20T10:00:00.000Z",
                pull_request: { merged_at: "2026-07-20T10:00:00.000Z" },
              },
              {
                number: 2,
                title: "Finance-only work",
                html_url: "https://github.com/example-org/finance-ui/pull/2",
                repository_url: "https://api.github.com/repos/example-org/finance-ui",
                updated_at: "2026-07-20T09:00:00.000Z",
              },
            ],
          });
        return Response.json({
          items: [
            {
              sha: "abcdef123456",
              html_url: "https://github.com/example-org/delivery-api/commit/abcdef123456",
              repository: { full_name: "example-org/delivery-api" },
              commit: {
                message: "Add scoped delivery query",
                committer: { date: "2026-07-20T09:00:00.000Z" },
              },
            },
          ],
        });
      },
    });

    const result = await Effect.runPromise(source.execute(context, activityPlan));
    expect(requests).toHaveLength(2);
    expect(result.items.map(({ title }) => title)).toEqual([
      "Ship scoped report",
      "Add scoped delivery query",
    ]);
    expect(result.items.some(({ title }) => title === "Finance-only work")).toBe(false);
  });

  it("reads date-bounded Jira transitions from connected project scope", async () => {
    const requests: string[] = [];
    const source = createJiraDeliveryQuerySource({
      baseUrl: "https://jira.example.test",
      email: "reader@example.test",
      apiToken: "test-token",
      workspaceId: context.workspaceId,
      allowedActorIds: new Set([context.actorId]),
      projectKeys: ["DEMO"],
      fetcher: async (input, init) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith("/rest/api/3/search/jql")) {
          const body = JSON.parse(String(init?.body)) as { readonly jql: string };
          expect(body.jql).toContain('project in ("DEMO")');
          return Response.json({
            issues: [
              {
                key: "DEMO-7",
                fields: {
                  summary: "Daily summary",
                  updated: "2026-07-20T11:00:00.000Z",
                  status: { name: "Done" },
                },
              },
            ],
          });
        }
        return Response.json({
          values: [
            {
              id: "history-1",
              created: "2026-07-20T11:00:00.000Z",
              items: [{ field: "status", fromString: "In Progress", toString: "Done" }],
            },
          ],
        });
      },
    });
    const result = await Effect.runPromise(source.execute(context, activityPlan));
    expect(requests).toHaveLength(2);
    expect(result.items).toMatchObject([
      {
        selector: "observations",
        intent: "activity",
        summary: "DEMO-7 status In Progress → Done: Daily summary",
        citationUrl: "https://jira.example.test/browse/DEMO-7",
      },
    ]);
  });

  it("filters Teams channels before requesting a token or Graph content", async () => {
    let tokenRequests = 0;
    let graphRequests = 0;
    const source = createTeamsDeliveryQuerySource({
      tokenProvider: {
        getAccessToken: async () => {
          tokenRequests += 1;
          return "token";
        },
      },
      channels: [
        {
          teamId: "team-1",
          channelId: "channel-1",
          workspaceId: context.workspaceId,
          sensitivity: "internal",
          allowedActorIds: new Set([context.actorId]),
        },
      ],
      fetcher: async () => {
        graphRequests += 1;
        return Response.json({ value: [] });
      },
    });
    const result = await Effect.runPromise(
      source.execute({ ...context, workspaceId: "workspace-other" }, activityPlan),
    );
    expect(result.items).toEqual([]);
    expect(tokenRequests).toBe(0);
    expect(graphRequests).toBe(0);
  });

  it("reads connected Teams messages while excluding direct assistant prompts", async () => {
    const source = createTeamsDeliveryQuerySource({
      tokenProvider: { getAccessToken: async () => "token" },
      channels: [
        {
          teamId: "team-1",
          channelId: "channel-1",
          workspaceId: context.workspaceId,
          sensitivity: "internal",
          allowedActorIds: new Set([context.actorId]),
        },
      ],
      fetcher: async () =>
        Response.json({
          value: [
            {
              id: "message-1",
              messageType: "message",
              createdDateTime: "2026-07-20T12:00:00.000Z",
              body: { content: "Released the delivery dashboard." },
              from: { user: { displayName: "Delivery Lead" } },
              webUrl: "https://teams.microsoft.com/l/message/message-1",
              replies: [
                {
                  id: "reply-1",
                  messageType: "message",
                  createdDateTime: "2026-07-20T12:01:00.000Z",
                  body: { content: '<at id="0">Sarathi</at> post team work summary' },
                  from: { user: { displayName: "Delivery Member" } },
                  webUrl: "https://teams.microsoft.com/l/message/reply-1",
                },
              ],
            },
          ],
        }),
    });
    const result = await Effect.runPromise(source.execute(context, activityPlan));
    expect(result.items).toMatchObject([
      { selector: "observations", summary: "Delivery Lead: Released the delivery dashboard." },
    ]);
  });

  it("reads scoped project email while excluding finance from general delivery queries", async () => {
    const source = createEmailDeliveryQuerySource({
      tokenProvider: { getAccessToken: async () => "token" },
      mailScopes: [
        {
          mailboxId: "delivery@example.test",
          workspaceId: context.workspaceId,
          allowedActorIds: new Set([context.actorId]),
          mode: "dedicated-mailbox",
          sensitivity: "internal",
        },
      ],
      fetcher: async () =>
        Response.json({
          value: [
            {
              id: "mail-1",
              subject: "Launch dependency resolved",
              bodyPreview: "The hosting dependency is complete.",
              receivedDateTime: "2026-07-20T10:00:00.000Z",
              webLink: "https://outlook.office.com/mail/mail-1",
              from: { emailAddress: { name: "Project Lead" } },
            },
            {
              id: "mail-2",
              subject: "Project budget update",
              bodyPreview: "Cost and margin changed.",
              receivedDateTime: "2026-07-20T11:00:00.000Z",
              webLink: "https://outlook.office.com/mail/mail-2",
            },
          ],
        }),
    });
    const result = await Effect.runPromise(
      source.execute({ ...context, maximumSensitivity: "confidential" }, activityPlan),
    );
    expect(result.items).toMatchObject([
      {
        summary: "Project Lead: Launch dependency resolved — The hosting dependency is complete.",
        sensitivity: "internal",
      },
    ]);
  });
});

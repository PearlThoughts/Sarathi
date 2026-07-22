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
            {
              sha: "vault123456",
              html_url: "https://github.com/example-org/delivery-vault/commit/vault123456",
              repository: { full_name: "example-org/delivery-vault" },
              commit: {
                message: "Update delivery notes",
                committer: { date: "2026-07-20T09:30:00.000Z" },
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
    expect(result.items.some(({ title }) => title === "Update delivery notes")).toBe(false);
  });

  it("does not treat repository activity as recurring-issue evidence", async () => {
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
    const recurringPlan = planDeliveryQuestion("What recurring issue keeps happening?");
    if (recurringPlan === undefined) throw new Error("Expected deterministic recurring plan");

    const result = await Effect.runPromise(source.execute(context, recurringPlan));

    expect(requests).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("uses the planned entity target for live GitHub implementation search", async () => {
    const requests: string[] = [];
    const source = createGitHubDeliveryQuerySource({
      token: "test-token",
      workspaceId: context.workspaceId,
      allowedActorIds: new Set([context.actorId]),
      allowedRepositories: ["example/repo"],
      fetcher: async (input) => {
        requests.push(String(input));
        return Response.json({ items: [] });
      },
    });
    const question =
      "Which GitHub PR or commits implement the Lead Routing Dashboard, and what changed?";
    const plan = planDeliveryQuestion(question);
    if (plan === undefined) throw new Error("Expected deterministic implementation plan");

    await Effect.runPromise(source.execute({ ...context, question }, plan));

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      const query = new URL(request).searchParams.get("q") ?? "";
      expect(query).toContain("Lead Routing Dashboard");
      expect(query).not.toContain("Which GitHub PR");
    }
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

  it("targets a subject-specific status query before reading Jira issues", async () => {
    let observedJql = "";
    const question = "What is the current status of Modern Website Builder?";
    const plan = planDeliveryQuestion(question);
    if (plan === undefined) throw new Error("Expected deterministic status plan");
    const source = createJiraDeliveryQuerySource({
      baseUrl: "https://jira.example.test",
      email: "reader@example.test",
      apiToken: "test-token",
      workspaceId: context.workspaceId,
      allowedActorIds: new Set([context.actorId]),
      projectKeys: ["DEMO"],
      fetcher: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { readonly jql: string };
        observedJql = body.jql;
        return Response.json({ issues: [] });
      },
    });
    await Effect.runPromise(source.execute({ ...context, question }, plan));
    expect(observedJql).toContain('summary ~ "\\"Modern Website Builder\\""');
    expect(observedJql).not.toBe('project in ("DEMO") ORDER BY updated DESC');
  });

  it("returns both Jira risks and a ranked next action for a compound question", async () => {
    const observedJql: string[] = [];
    const question = "What are the delivery risks and next action?";
    const plan = planDeliveryQuestion(question);
    if (plan === undefined) throw new Error("Expected deterministic risk and action plan");
    const source = createJiraDeliveryQuerySource({
      baseUrl: "https://jira.example.test",
      email: "reader@example.test",
      apiToken: "test-token",
      workspaceId: context.workspaceId,
      allowedActorIds: new Set([context.actorId]),
      projectKeys: ["DEMO"],
      fetcher: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { readonly jql: string };
        observedJql.push(body.jql);
        return Response.json({
          issues: [
            {
              key: body.jql.includes("ORDER BY priority DESC") ? "DEMO-9" : "DEMO-8",
              fields: {
                summary: "Resolve launch dependency",
                updated: "2026-07-20T11:00:00.000Z",
                status: { name: "In Progress" },
                assignee: { displayName: "Delivery Owner" },
                priority: { name: "High" },
              },
            },
          ],
        });
      },
    });

    const result = await Effect.runPromise(source.execute({ ...context, question }, plan));

    expect(observedJql).toHaveLength(2);
    expect(observedJql).toContain(
      'project in ("DEMO") AND statusCategory != Done ORDER BY priority DESC, updated DESC',
    );
    expect(result.items.map(({ intent }) => intent)).toEqual(["risks", "next_actions"]);
    expect(result.items[1]?.summary).toBe(
      "Delivery Owner — DEMO-9 In Progress: Resolve launch dependency",
    );
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
              from: { user: { id: "lead-id", displayName: "Delivery Lead" } },
              mentions: [
                {
                  mentioned: {
                    user: { id: "reviewer-id", displayName: "Delivery Reviewer" },
                  },
                },
              ],
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
      {
        selector: "observations",
        summary: "Delivery Lead: Released the delivery dashboard.",
        actionTarget: {
          source: "teams",
          externalId: "reviewer-id",
          displayName: "Delivery Reviewer",
        },
      },
    ]);
  });

  it("requires explicit dependency relationships and actionable next-step language", async () => {
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
              id: "resolved",
              messageType: "message",
              createdDateTime: "2026-07-20T12:00:00.000Z",
              body: { content: "The dependency vulnerabilities are resolved." },
              webUrl: "https://teams.microsoft.com/l/message/resolved",
            },
            {
              id: "waiting",
              messageType: "message",
              createdDateTime: "2026-07-20T12:00:00.000Z",
              body: { content: "Frontend is waiting for API approval from the backend owner." },
              webUrl: "https://teams.microsoft.com/l/message/waiting",
            },
            {
              id: "acknowledgement",
              messageType: "message",
              createdDateTime: "2026-07-20T12:00:00.000Z",
              body: { content: "ok mam" },
              webUrl: "https://teams.microsoft.com/l/message/acknowledgement",
            },
            {
              id: "action",
              messageType: "message",
              createdDateTime: "2026-07-20T12:00:00.000Z",
              body: { content: "I will update the acceptance issue tomorrow." },
              webUrl: "https://teams.microsoft.com/l/message/action",
            },
          ],
        }),
    });
    const dependencyPlan = planDeliveryQuestion("Who is waiting for whom in the active sprint?");
    const actionPlan = planDeliveryQuestion("What is the next action?");
    if (dependencyPlan === undefined || actionPlan === undefined)
      throw new Error("Expected deterministic delivery plans");

    const dependencies = await Effect.runPromise(source.execute(context, dependencyPlan));
    const actions = await Effect.runPromise(source.execute(context, actionPlan));

    expect(dependencies.items.map(({ id }) => id)).toEqual([
      "teams:team-1:channel-1:waiting:dependencies",
    ]);
    expect(actions.items.map(({ id }) => id)).toEqual([
      "teams:team-1:channel-1:action:next_actions",
    ]);
  });

  it("separates review and capacity signals while excluding plain-text assistant tests", async () => {
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
              id: "review",
              messageType: "message",
              createdDateTime: "2026-07-20T12:00:00.000Z",
              body: { content: "F1851-809 needs review from Manikandan." },
              webUrl: "https://teams.microsoft.com/l/message/review",
            },
            {
              id: "availability",
              messageType: "message",
              createdDateTime: "2026-07-20T12:00:00.000Z",
              body: { content: "I am unavailable until 2 PM because of a personal emergency." },
              webUrl: "https://teams.microsoft.com/l/message/availability",
            },
            {
              id: "plain-test",
              messageType: "message",
              createdDateTime: "2026-07-20T12:00:00.000Z",
              body: { content: "@Sarathi summarize today's team activity" },
              webUrl: "https://teams.microsoft.com/l/message/plain-test",
            },
            {
              id: "malformed-test",
              messageType: "message",
              createdDateTime: "2026-07-20T12:00:00.000Z",
              body: { content: "@" },
              webUrl: "https://teams.microsoft.com/l/message/malformed-test",
            },
          ],
        }),
    });
    const reviewPlan = planDeliveryQuestion(
      "Which items are waiting for review, and who needs to review each?",
    );
    const capacityPlan = planDeliveryQuestion("Who has availability constraints today?");
    if (reviewPlan === undefined || capacityPlan === undefined)
      throw new Error("Expected review and capacity plans");

    const reviews = await Effect.runPromise(source.execute(context, reviewPlan));
    const capacity = await Effect.runPromise(source.execute(context, capacityPlan));

    expect(reviews.items.map(({ id }) => id)).toEqual(["teams:team-1:channel-1:review:reviews"]);
    expect(capacity.items.map(({ id }) => id)).toEqual([
      "teams:team-1:channel-1:availability:capacity",
    ]);
    expect(capacityPlan.intents).toEqual(["capacity"]);
  });

  it("treats project progress fields as compound delivery facts rather than generic activity", () => {
    const plan = planDeliveryQuestion(
      "What is the current status of Admin Portal Migration? Summarize scope, progress, review queue, risks, and next action.",
    );

    expect(plan?.intents).toEqual(["scope", "reviews", "risks", "next_actions", "status"]);
    expect(plan?.intents).not.toContain("activity");
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

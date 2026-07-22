import { describe, expect, it } from "vitest";
import {
  assertNonFinancialAttributes,
  type DeliveryClaim,
  deliveryClaimValueHash,
  findDeliveryConflicts,
  normalizeDeliveryEntityAlias,
  parseAttributedDeliveryAssertion,
  parseDeliveryEntityCatalog,
  planDeliveryQuestion,
  resolveDeliveryEntity,
  resolveDeliveryTimeConstraint,
  validateDeliveryEntityCatalog,
  validateDeliveryQueryPlan,
} from "../src/modules/delivery-intelligence/index.ts";

describe("delivery intelligence domain", () => {
  it("keeps scope and requirements independent of time", () => {
    const plan = planDeliveryQuestion("What is the project scope and its requirements?");
    expect(plan?.intents).toEqual(["scope", "requirements"]);
    expect(plan?.operations).toHaveLength(2);
    expect(plan?.operations.every((operation) => operation.time === undefined)).toBe(true);
  });

  it("assigns independent time constraints to compound delivery questions", () => {
    const plan = planDeliveryQuestion(
      "What did the team deliver last sprint, and what are they doing this week?",
    );
    expect(plan?.intents).toEqual(["delivered", "current_work"]);
    expect(plan?.operations[0]?.time).toEqual({
      kind: "jira_sprint",
      sprint: "previous",
    });
    expect(plan?.operations[1]?.time).toEqual({ kind: "workspace_week" });
  });

  it("recognizes activity summaries regardless of phrase order and keeps activity primary", () => {
    const plan = planDeliveryQuestion(
      "Summarize today's team activity with highlights and exactly one next action.",
    );

    expect(plan?.intents).toEqual(["activity", "next_actions"]);
    expect(plan?.operations[0]).toMatchObject({
      purpose: "activity",
      select: "observations",
      time: { kind: "workspace_day" },
    });
  });

  it("uses relation traversal for dependency and ownership questions", () => {
    const plan = planDeliveryQuestion(
      "Who owns the work and who is waiting for whom in the active sprint?",
    );
    expect(plan?.intents).toEqual(["ownership", "dependencies"]);
    expect(plan?.operations[0]?.traversal?.maximumDepth).toBe(1);
    expect(plan?.operations[1]?.traversal).toEqual({
      kinds: ["depends_on", "blocks"],
      direction: "both",
      maximumDepth: 2,
    });
    expect(plan?.operations[1]?.time).toEqual({
      kind: "jira_sprint",
      sprint: "current",
    });
  });

  it("models review queues as observations instead of generic message retrieval", () => {
    const plan = planDeliveryQuestion(
      "Which items are waiting for review, and who needs to review each?",
    );
    expect(plan?.intents).toEqual(["reviews"]);
    expect(plan?.operations).toEqual([
      expect.objectContaining({
        purpose: "reviews",
        select: "observations",
        predicates: [{ field: "kind", operator: "equals", value: "review" }],
      }),
    ]);
  });

  it("requires live GitHub and carries the implementation subject", () => {
    const plan = planDeliveryQuestion(
      "Which GitHub PR or commits implement the Lead Routing Dashboard, and what changed?",
    );
    expect(plan?.subject).toEqual({ phrase: "Lead Routing Dashboard" });
    expect(plan?.requiredSources).toEqual(["github"]);
    expect(plan?.operations).toEqual([
      expect.objectContaining({ purpose: "implementation", select: "github_live" }),
    ]);
  });

  it("requires all compared sources for disagreement questions", () => {
    const plan = planDeliveryQuestion(
      "Where do Jira, Teams, and GitHub currently disagree about delivery status?",
    );
    expect(plan?.intents).toEqual(["conflicts"]);
    expect(plan?.requiredSources).toEqual(["jira", "teams", "github"]);
  });

  it("models next actions and milestones without making time the aggregate root", () => {
    const plan = planDeliveryQuestion(
      "What are the next actions and upcoming milestones for the project?",
    );
    expect(plan?.intents).toEqual(["next_actions", "milestones"]);
    expect(plan?.operations[0]).toMatchObject({
      select: "objects",
      objectKinds: ["work_item", "deliverable", "milestone"],
      orderBy: { field: "dueAt", direction: "asc" },
    });
    expect(plan?.operations[0]?.time).toBeUndefined();
    expect(plan?.operations[1]?.time).toBeUndefined();
  });

  it("targets named status questions instead of returning unrelated recent work", () => {
    const named = planDeliveryQuestion("What is the current status of Modern Website Builder?");
    expect(named?.operations[0]?.predicates).toEqual([
      { field: "title", operator: "contains", value: "Modern Website Builder" },
    ]);
    expect(named?.operations.map(({ select }) => select)).toEqual(["objects", "knowledge"]);

    const keyed = planDeliveryQuestion("What is the status of F1851-754?");
    expect(keyed?.operations[0]?.predicates).toEqual([
      { field: "externalKey", operator: "equals", value: "F1851-754" },
    ]);
  });

  it("isolates finance plans and rejects finance attributes in shared objects", () => {
    expect(planDeliveryQuestion("What is the current project budget?")?.requiresFinance).toBe(true);
    const responseBudget = planDeliveryQuestion("Where is the Teams response budget implemented?");
    expect(responseBudget?.requiresFinance).toBe(false);
    expect(responseBudget?.intents).toContain("implementation");
    expect(responseBudget?.intents).not.toContain("finance");
    expect(() =>
      assertNonFinancialAttributes({
        owner: "actor-example",
        budgetAmount: 100,
      }),
    ).toThrow("confidential finance metric boundary");
    expect(() =>
      assertNonFinancialAttributes({
        owner: "actor-example",
        status: "active",
      }),
    ).not.toThrow();
  });

  it("rejects unbounded or unknown model-proposed plans", () => {
    expect(() =>
      validateDeliveryQueryPlan({
        version: 1,
        intents: ["dependencies"],
        operations: [
          {
            id: "unsafe",
            purpose: "dependencies",
            select: "sql",
            limit: 1000,
          },
        ],
        answerMode: "model_assisted",
        maximumLines: 3,
        requiresFinance: false,
      }),
    ).toThrow("unknown selector");
  });

  it("validates versioned attributed assertions with stable identities and independent confidence", () => {
    expect(
      parseAttributedDeliveryAssertion({
        schema_version: 1,
        assertion_id: "delivery/product-builder/2026-07-22",
        subject: {
          kind: "module",
          key: "product-builder",
          title: "Product Builder",
          aliases: ["builder", "puck"],
        },
        author: { id: "entra:person-1", display_name: "Synthetic Delivery Lead" },
        asserted_at: "2026-07-22T10:00:00Z",
        effective_from: "2026-07-01T00:00:00Z",
        confidence: 0.72,
        supersedes: ["delivery/product-builder/2026-07-15"],
      }),
    ).toEqual({
      schemaVersion: 1,
      assertionId: "delivery/product-builder/2026-07-22",
      subject: {
        kind: "module",
        key: "product-builder",
        title: "Product Builder",
        aliases: ["builder", "puck"],
      },
      author: { id: "entra:person-1", displayName: "Synthetic Delivery Lead" },
      assertedAt: "2026-07-22T10:00:00.000Z",
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      confidence: 0.72,
      supersedes: ["delivery/product-builder/2026-07-15"],
    });
    expect(() =>
      parseAttributedDeliveryAssertion({
        schema_version: 2,
        confidence: 1.1,
      }),
    ).toThrow("schema_version must be 1");
  });

  it("derives conflicts without overwriting competing or superseded claims", () => {
    const claim = (
      id: string,
      value: string,
      authority: number,
      source: "jira" | "teams" | "vault",
    ): DeliveryClaim => ({
      id,
      workspaceId: "workspace-example",
      subjectKey: "project:example",
      predicate: "delivery-status",
      value,
      valueHash: deliveryClaimValueHash(value),
      authority,
      sensitivity: "internal",
      observedAt: "2026-07-20T10:00:00.000Z",
      active: true,
      deleted: false,
      source: {
        source,
        sourceId: `${source}-source`,
        sourceItemId: id,
        citationUrl: `https://example.com/${source}/${id}`,
      },
    });
    const conflicts = findDeliveryConflicts([
      claim("jira-1", "blocked", 0.95, "jira"),
      claim("teams-1", "ready", 0.7, "teams"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.claims.map((entry) => entry.value)).toEqual(["blocked", "ready"]);

    const oldHumanClaim = {
      ...claim("vault-old", "at risk", 0.8, "vault"),
      externalAssertionId: "delivery/old:status:status",
      confidence: 0.6,
    };
    const correction = {
      ...claim("vault-correction", "ready", 0.8, "vault"),
      externalAssertionId: "delivery/new:status:status",
      supersedesAssertionIds: ["delivery/old:status:status"],
      confidence: 0.9,
    };
    const corrected = findDeliveryConflicts([
      oldHumanClaim,
      correction,
      claim("jira-2", "blocked", 0.95, "jira"),
    ]);
    expect(corrected).toHaveLength(1);
    expect(corrected[0]?.claims.map((entry) => entry.value)).toEqual(["blocked", "ready"]);
    const unrelatedCorrection = {
      ...correction,
      id: "vault-unrelated",
      subjectKey: "project:other",
    };
    const unrelated = findDeliveryConflicts([
      oldHumanClaim,
      unrelatedCorrection,
      claim("jira-3", "blocked", 0.95, "jira"),
    ]);
    expect(unrelated[0]?.claims.map((entry) => entry.value)).toEqual(["blocked", "at risk"]);
  });

  it("resolves workspace-local time only when a query requests it", () => {
    expect(
      resolveDeliveryTimeConstraint(
        { kind: "workspace_day" },
        "2026-07-20T13:09:00.000Z",
        "Asia/Kolkata",
      ),
    ).toEqual({
      fromInclusive: "2026-07-19T18:30:00.000Z",
      toExclusive: "2026-07-20T18:30:00.000Z",
    });
  });

  it("routes unfamiliar delivery questions through bounded generic retrieval", () => {
    const plan = planDeliveryQuestion("What should I know before the delivery standup?");
    expect(plan?.intents).toEqual(["general"]);
    expect(plan?.answerMode).toBe("model_assisted");
    expect(plan?.operations.map(({ select }) => select)).toEqual([
      "objects",
      "relations",
      "claims",
      "observations",
      "metrics",
      "knowledge",
    ]);
  });

  it("resolves source-qualified aliases to one stable delivery entity", () => {
    const catalog = validateDeliveryEntityCatalog({
      version: 1,
      entities: [
        {
          kind: "module",
          canonicalKey: "product-builder",
          title: "Product Builder",
          aliases: [
            { value: "Puck", source: "github" },
            { value: "Modern Website Builder", source: "jira" },
            { value: "Builder" },
          ],
        },
      ],
    });

    const github = resolveDeliveryEntity(catalog, "github", {
      kind: "module",
      externalKey: "PearlThoughts/puck",
      title: "Puck",
      attributes: {},
      sensitivity: "internal",
    });
    const jira = resolveDeliveryEntity(catalog, "jira", {
      kind: "module",
      externalKey: "component-42",
      title: "Modern Website Builder",
      attributes: {},
      sensitivity: "internal",
    });

    expect(github.canonicalKey).toBe("module:product-builder");
    expect(jira.canonicalKey).toBe(github.canonicalKey);
    expect(github.canonicalTitle).toBe("Product Builder");
    expect(github.aliases).toContain("Builder");
    expect(normalizeDeliveryEntityAlias("  Modern_Website Builder  ")).toBe(
      "modern website builder",
    );
  });

  it("rejects ambiguous aliases instead of guessing a cross-source join", () => {
    expect(() =>
      validateDeliveryEntityCatalog({
        version: 1,
        entities: [
          {
            kind: "person",
            canonicalKey: "person-a",
            title: "Person A",
            aliases: [{ value: "shared", source: "teams" }],
          },
          {
            kind: "person",
            canonicalKey: "person-b",
            title: "Person B",
            aliases: [{ value: "shared", source: "teams" }],
          },
        ],
      }),
    ).toThrow("ambiguous alias");
    expect(() =>
      validateDeliveryEntityCatalog({
        version: 1,
        entities: [
          {
            kind: "module",
            canonicalKey: "global-builder",
            title: "Global Builder",
            aliases: [{ value: "Builder" }],
          },
          {
            kind: "module",
            canonicalKey: "github-builder",
            title: "GitHub Builder",
            aliases: [{ value: "Builder", source: "github" }],
          },
        ],
      }),
    ).toThrow("ambiguous alias");
  });

  it("loads a private runtime catalog from JSON and fails closed on malformed definitions", () => {
    expect(
      parseDeliveryEntityCatalog(
        JSON.stringify({
          version: 1,
          entities: [
            {
              kind: "person",
              canonicalKey: "person-1",
              title: "Delivery Lead",
              aliases: [
                { source: "jira", value: "jira-account-1" },
                { source: "teams", value: "entra-person-1" },
              ],
            },
          ],
        }),
      )?.entities[0]?.canonicalKey,
    ).toBe("person-1");
    expect(parseDeliveryEntityCatalog(undefined)).toBeUndefined();
    expect(() => parseDeliveryEntityCatalog("not-json")).toThrow("valid JSON");
    expect(() =>
      parseDeliveryEntityCatalog('{"version":1,"entities":[{"kind":"unknown"}]}'),
    ).toThrow("invalid entity definition");
  });
});

import { describe, expect, it, vi } from "vitest";
import { runDeliveryCommand } from "../src/cli/commands/delivery-runtime.ts";
import { runReleaseCli } from "../src/cli/release.ts";
import { RepositoryError } from "../src/domain/errors.ts";
import { stableSha256 } from "../src/domain/hash.ts";

describe("delivery CLI", () => {
  it("exposes privacy-safe durable status", async () => {
    await expect(
      runDeliveryCommand(["status"], {}, { readStatus: async () => ({ deliveryTableCount: 8 }) }),
    ).resolves.toEqual({
      exitCode: 0,
      output: {
        ok: true,
        operation: "delivery-status",
        status: { deliveryTableCount: 8 },
      },
    });
  });

  it("parses a bounded query and returns answer metadata without source bodies", async () => {
    const answer = vi.fn(async (_request) => ({
      text: "Status: Ready [Jira 1](https://jira.example/browse/DEMO-1)",
      citations: [{ label: "Jira 1", url: "https://jira.example/browse/DEMO-1" }],
      status: "ok" as const,
      plan: {
        version: 1 as const,
        intents: ["status" as const],
        operations: [
          { id: "status-1", purpose: "status" as const, select: "objects" as const, limit: 5 },
        ],
        answerMode: "deterministic" as const,
        maximumLines: 3 as const,
        requiresFinance: false,
      },
      responseMode: "structured" as const,
      responseProduct: "period_delivery_brief" as const,
      responseBudget: {
        sourceTimeoutMs: 8_000,
        compositionTimeoutMs: 4_000,
        totalBudgetMs: 12_000,
      },
      acceptance: {
        mode: "structured" as const,
        product: "period_delivery_brief" as const,
        elapsedMs: 10,
        latencyTargetMs: 15_000,
        latencyPassed: true,
        requestedIntents: 1,
        coveredIntents: 1,
        completenessRatio: 1,
        completenessPassed: true,
        materialStatements: 1,
        citedStatements: 1,
        citationCoverage: 1,
        citationPassed: true,
        groundingPassed: true,
        freshEvidence: 1,
        evaluatedEvidence: 1,
        freshnessCoverage: 1,
        freshnessPassed: true,
        formatPassed: true,
        passed: true,
      },
      unavailableSources: [],
      conflicts: [],
    }));
    const result = await runDeliveryCommand(
      [
        "query",
        "--question",
        "What is the project status?",
        "--actor-id",
        "actor-1",
        "--time-zone",
        "Asia/Kolkata",
        "--requested-at",
        "2026-07-20T12:00:00.000Z",
        "--response-mode",
        "structured",
        "--response-product",
        "period_delivery_brief",
      ],
      {
        SARATHI_KNOWLEDGE_WORKSPACE_ID: "workspace-1",
        SARATHI_KNOWLEDGE_AUDIENCE_IDS_JSON: '["delivery-team"]',
        SARATHI_DELIVERY_FINANCE_ACTOR_IDS_JSON: '["actor-1"]',
      },
      { answer },
    );
    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        actorId: "actor-1",
        audienceIds: ["delivery-team"],
        maximumSensitivity: "internal",
        financeAccess: true,
        requestedAt: "2026-07-20T12:00:00.000Z",
        responseMode: "structured",
        responseProduct: "period_delivery_brief",
      }),
    );
    expect(result).toMatchObject({
      exitCode: 0,
      output: {
        operation: "delivery-query",
        answer: { status: "ok", conflicts: 0, responseMode: "structured" },
        intents: ["status"],
      },
    });
  });

  it("runs a privacy-safe representative evaluation set through the production answer path", async () => {
    const answerText = [
      "Here’s the current delivery status I found.",
      "- 📊 **Status:** Internal status detail [Jira 1](https://jira.example/browse/DEMO-1)",
    ].join("\n");
    const answer = vi.fn(async (_request) => ({
      text: answerText,
      citations: [{ label: "Jira 1", url: "https://jira.example/browse/DEMO-1" }],
      status: "ok" as const,
      plan: {
        version: 1 as const,
        intents: ["status" as const],
        operations: [
          { id: "status-1", purpose: "status" as const, select: "objects" as const, limit: 5 },
        ],
        answerMode: "deterministic" as const,
        maximumLines: 3 as const,
        requiresFinance: false,
      },
      responseMode: "fast" as const,
      responseProduct: "operational_answer" as const,
      responseBudget: {
        sourceTimeoutMs: 4_500,
        compositionTimeoutMs: 2_500,
        totalBudgetMs: 6_500,
      },
      acceptance: {
        mode: "fast" as const,
        product: "operational_answer" as const,
        elapsedMs: 250,
        latencyTargetMs: 10_000,
        latencyPassed: true,
        requestedIntents: 1,
        coveredIntents: 1,
        completenessRatio: 1,
        completenessPassed: true,
        materialStatements: 1,
        citedStatements: 1,
        citationCoverage: 1,
        citationPassed: true,
        groundingPassed: true,
        freshEvidence: 1,
        evaluatedEvidence: 1,
        freshnessCoverage: 1,
        freshnessPassed: true,
        formatPassed: true,
        passed: true,
      },
      unavailableSources: [],
      conflicts: [],
    }));
    const evaluationSet = JSON.stringify({
      version: 1,
      thresholds: {
        minimumPassRate: 1,
        minimumHumanUsefulnessAverage: 4,
      },
      cases: [
        {
          id: "project-status",
          question: "Private project status wording",
          expected: {
            outcome: "answer",
            intents: ["status"],
            status: "ok",
            minimumCitations: 1,
            citationSources: ["jira"],
            acceptancePassed: true,
            ratedAnswerFingerprint: stableSha256(answerText),
            humanUsefulnessRating: 5,
          },
        },
      ],
    });

    const result = await runDeliveryCommand(
      [
        "evaluate",
        "--actor-id",
        "actor-1",
        "--time-zone",
        "Asia/Kolkata",
        "--set-json",
        evaluationSet,
      ],
      {
        SARATHI_KNOWLEDGE_WORKSPACE_ID: "workspace-1",
      },
      { answer },
    );

    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "Private project status wording",
        actorId: "actor-1",
      }),
    );
    expect(result).toMatchObject({
      exitCode: 0,
      output: {
        ok: true,
        operation: "delivery-evaluate",
        report: {
          passed: true,
          total: 1,
          passedCount: 1,
          quality: {
            completenessPassRate: 1,
            citationPassRate: 1,
            groundingPassRate: 1,
            freshnessPassRate: 1,
            latencyPassRate: 1,
          },
          authorization: {
            checkCount: 0,
            passedCount: 0,
            passRate: 1,
          },
        },
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Private project status wording");
    expect(serialized).not.toContain("Internal status detail");
    expect(serialized).not.toContain("https://jira.example");
  });

  it("implements rebuild as a non-destructive full reconciliation", async () => {
    const runKnowledge = vi.fn(async () => ({
      exitCode: 0,
      output: { ok: true, summaries: [{ source: "jira", documentsObserved: 3 }] },
    }));
    const result = await runDeliveryCommand(["rebuild"], {}, { runKnowledge });
    expect(runKnowledge).toHaveBeenCalledWith(["reconcile", "all"], {});
    expect(result).toMatchObject({
      exitCode: 0,
      output: { operation: "delivery-rebuild", mode: "non-destructive-reconcile" },
    });
  });

  it("routes durable synchronization operations without adding source content to the envelope", async () => {
    const runSync = vi.fn(async () => ({
      exitCode: 0,
      output: {
        ok: true,
        operation: "delivery-sync-reconcile",
        outcomes: [{ source: "jira", disposition: "succeeded", documentsObserved: 3 }],
      },
    }));
    const environment = { SARATHI_KNOWLEDGE_WORKSPACE_ID: "workspace-1" };
    const result = await runDeliveryCommand(["sync", "reconcile", "all"], environment, { runSync });
    expect(runSync).toHaveBeenCalledWith(["reconcile", "all"], environment);
    expect(result).toMatchObject({
      exitCode: 0,
      output: { operation: "delivery-sync-reconcile" },
    });
    expect(JSON.stringify(result)).not.toContain("source body");
  });

  it("fails without exposing configuration or provider errors", async () => {
    const secret = "provider-secret-value";
    const result = await runDeliveryCommand(
      ["query", "--question", "status", "--actor-id", "actor-1"],
      { SARATHI_KNOWLEDGE_WORKSPACE_ID: secret },
      { answer: async () => Promise.reject(new Error(secret)) },
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("reports only the safe failing operation for repository errors", async () => {
    const result = await runDeliveryCommand(
      ["query", "--question", "status", "--actor-id", "actor-1", "--time-zone", "Asia/Kolkata"],
      { SARATHI_KNOWLEDGE_WORKSPACE_ID: "1851" },
      {
        answer: async () =>
          Promise.reject(
            new RepositoryError({
              message: "provider response with private diagnostic details",
              operation: "knowledge-embedding",
            }),
          ),
      },
    );

    expect(result).toEqual({
      exitCode: 1,
      output: {
        ok: false,
        message: "Delivery operation failed; inspect privacy-safe service diagnostics.",
        failureOperation: "knowledge-embedding",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private diagnostic details");
  });

  it("is available through the repository release CLI", async () => {
    await expect(runReleaseCli({ args: ["delivery", "status"], env: {} })).resolves.toEqual({
      exitCode: 1,
      output: {
        ok: false,
        message: "Delivery operation failed; inspect privacy-safe service diagnostics.",
      },
    });
  });
});

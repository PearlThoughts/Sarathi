import { describe, expect, it, vi } from "vitest";
import { runDeclaredInitiativeCommand } from "../src/cli/commands/declared-initiative-runtime.ts";
import { runDeliveryCommand } from "../src/cli/commands/delivery-runtime.ts";
import { runReleaseCli } from "../src/cli/release.ts";
import { RepositoryError } from "../src/domain/errors.ts";
import { stableSha256 } from "../src/domain/hash.ts";

describe("delivery CLI", () => {
  it("imports a private snapshot through the hosted operator surface", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({
        authorization: "Bearer runtime-token",
        "content-type": "application/json",
      });
      const body = JSON.parse(String(init?.body)) as {
        workspaceKey: string;
        items: readonly unknown[];
      };
      expect(body.workspaceKey).toBe("launchpad");
      expect(body.items).toHaveLength(1);
      return new Response(JSON.stringify({ ok: true, result: { goals: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await runDeclaredInitiativeCommand(
      ["import", "--file", "/private/snapshot.yaml"],
      {
        SARATHI_ADMIN_TOKEN: "runtime-token",
        SARATHI_PUBLIC_BASE_URL: "https://sarathi.example.test",
      },
      {
        fetcher,
        readFile: () => `
version: 1
workspaceKey: launchpad
period:
  key: quarter-3
  title: Quarter 3
  horizonStart: 2026-07-01T00:00:00.000Z
  horizonEnd: 2026-10-01T00:00:00.000Z
source:
  system: spreadsheet
  externalId: plan-sheet
  url: https://docs.example.test/spreadsheets/plan
  title: Quarterly plan
  revision: revision-1
  revisedAt: 2026-07-31T08:00:00.000Z
items:
  - key: growth
    kind: goal
    title: Growth
    status: Active
`,
      },
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://sarathi.example.test/internal/delivery/intent/import",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({
      exitCode: 0,
      output: { ok: true, result: { goals: 1 } },
    });
  });

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

  it("returns a non-zero structured CLI result for failed report composition", async () => {
    const result = await runDeliveryCommand(
      [
        "query",
        "--question",
        "What was delivered last week?",
        "--actor-id",
        "actor-1",
        "--time-zone",
        "Asia/Kolkata",
      ],
      { SARATHI_KNOWLEDGE_WORKSPACE_ID: "workspace-1" },
      {
        answer: async () => ({
          text: [
            "Response composition failed.",
            "",
            "Error code: SARATHI-REPORT-COMPOSITION-FAILED",
            "Correlation code: SAR-1234ABCD",
            "Please retry the request.",
          ].join("\n"),
          citations: [],
          status: "failed",
          plan: {
            version: 1,
            intents: ["delivered"],
            operations: [
              {
                id: "delivery-report",
                purpose: "delivered",
                select: "period_census",
                time: { kind: "workspace_previous_week" },
                census: { pageSize: 200, maximumCandidates: 50_000 },
                limit: 1,
              },
            ],
            answerMode: "model_assisted",
            maximumLines: 3,
            requiresFinance: false,
          },
          responseMode: "deep_dive",
          responseProduct: "period_delivery_brief",
          responseBudget: {
            sourceTimeoutMs: 90_000,
            compositionTimeoutMs: 120_000,
            totalBudgetMs: 240_000,
          },
          acceptance: {
            mode: "deep_dive",
            product: "period_delivery_brief",
            elapsedMs: 20,
            latencyPassed: true,
            requestedIntents: 1,
            coveredIntents: 0,
            completenessRatio: 0,
            completenessPassed: false,
            materialStatements: 0,
            citedStatements: 0,
            citationCoverage: 1,
            citationPassed: true,
            groundingPassed: true,
            freshEvidence: 0,
            evaluatedEvidence: 0,
            freshnessCoverage: 1,
            freshnessPassed: true,
            formatPassed: false,
            passed: false,
          },
          unavailableSources: [],
          conflicts: [],
          failure: {
            code: "SARATHI-REPORT-COMPOSITION-FAILED",
            classification: "SARATHI-REPORT-PROVIDER-FAILED",
            diagnosticCode: "report-provider",
            correlationCode: "SAR-1234ABCD",
          },
        }),
      },
    );

    expect(result).toMatchObject({
      exitCode: 1,
      output: {
        ok: false,
        operation: "delivery-query",
        errorCode: "SARATHI-REPORT-COMPOSITION-FAILED",
        failureClassification: "SARATHI-REPORT-PROVIDER-FAILED",
        failureDiagnosticCode: "report-provider",
        correlationCode: "SAR-1234ABCD",
        answer: { status: "failed", citations: [], acceptance: { passed: false } },
      },
    });
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

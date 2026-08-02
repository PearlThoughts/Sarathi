import { describe, expect, it } from "vitest";
import { stableSha256 } from "../src/domain/hash.ts";
import {
  type DeliveryAssistantAnswer,
  evaluateDeliveryCase,
  parseDeliveryEvaluationSet,
  summarizeDeliveryEvaluation,
} from "../src/modules/delivery-intelligence/index.ts";

const acceptedAnswer = (): DeliveryAssistantAnswer => ({
  text: [
    "Here’s the current delivery status I found.",
    "- 📊 **Status:** Release is ready [Jira 1](https://jira.example/browse/DEMO-1)",
  ].join("\n"),
  citations: [{ label: "Jira 1", url: "https://jira.example/browse/DEMO-1", source: "jira" }],
  status: "ok",
  responseMode: "fast",
  responseProduct: "operational_answer",
  responseBudget: {
    sourceTimeoutMs: 4_500,
    compositionTimeoutMs: 2_500,
    totalBudgetMs: 6_500,
  },
  acceptance: {
    mode: "fast",
    product: "operational_answer",
    elapsedMs: 350,
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
  plan: {
    version: 1,
    intents: ["status"],
    operations: [
      {
        id: "status-1",
        purpose: "status",
        select: "objects",
        limit: 5,
      },
    ],
    answerMode: "deterministic",
    maximumLines: 3,
    requiresFinance: false,
  },
  unavailableSources: [],
  conflicts: [],
});
const acceptedAnswerFingerprint = stableSha256(acceptedAnswer().text);

describe("delivery evaluation", () => {
  it("validates a bounded versioned set and rejects duplicate case IDs", () => {
    const evaluationSet = parseDeliveryEvaluationSet({
      version: 1,
      thresholds: {
        minimumPassRate: 1,
        minimumHumanUsefulnessAverage: 4,
      },
      cases: [
        {
          id: "status",
          question: "What is the status?",
          expected: {
            outcome: "answer",
            intents: ["status"],
            minimumCitations: 1,
            citationSources: ["jira"],
            ratedAnswerFingerprint: acceptedAnswerFingerprint,
            humanUsefulnessRating: 4,
          },
        },
      ],
    });

    expect(evaluationSet.cases).toHaveLength(1);
    expect(() =>
      parseDeliveryEvaluationSet({
        ...evaluationSet,
        cases: [evaluationSet.cases[0], evaluationSet.cases[0]],
      }),
    ).toThrow("unique safe identifiers");
    expect(() =>
      parseDeliveryEvaluationSet({
        version: 1,
        thresholds: { minimumPassRate: 1 },
        cases: [
          {
            id: "unsafe-denial",
            question: "Should this be denied?",
            expected: { outcome: "deny" },
          },
        ],
      }),
    ).toThrow("exact failure operation");
  });

  it("accepts every governed delivery citation source, including strategy", () => {
    const evaluationSet = parseDeliveryEvaluationSet({
      version: 1,
      thresholds: { minimumPassRate: 1 },
      cases: [
        {
          id: "strategy-alignment",
          question: "How does delivery align with strategy?",
          expected: {
            outcome: "answer",
            citationSources: ["jira", "strategy", "teams", "vault", "github"],
          },
        },
      ],
    });

    const strategyCase = evaluationSet.cases[0];
    if (strategyCase === undefined) throw new Error("Expected one strategy evaluation case.");
    expect(strategyCase.expected.citationSources).toContain("strategy");
    expect(() =>
      parseDeliveryEvaluationSet({
        ...evaluationSet,
        cases: [
          {
            ...strategyCase,
            expected: {
              ...strategyCase.expected,
              citationSources: ["unclassified"],
            },
          },
        ],
      }),
    ).toThrow("citation sources are invalid");
  });

  it("evaluates typed citation provenance independently of compact presentation labels", () => {
    const evaluationSet = parseDeliveryEvaluationSet({
      version: 1,
      thresholds: { minimumPassRate: 1 },
      cases: [
        {
          id: "capability-report",
          question: "How is delivery aligned?",
          expected: {
            outcome: "answer",
            citationSources: ["jira", "strategy", "teams", "vault", "github"],
          },
        },
      ],
    });
    const evaluationCase = evaluationSet.cases[0];
    if (evaluationCase === undefined) throw new Error("Expected one evaluation case.");
    const answer: DeliveryAssistantAnswer = {
      ...acceptedAnswer(),
      citations: [
        { label: "Delivery 1", url: "https://example.test/jira", source: "jira" },
        { label: "Declared 1", url: "https://example.test/strategy", source: "strategy" },
        { label: "Delivery 2", url: "https://example.test/teams", source: "teams" },
        { label: "Delivery 3", url: "https://example.test/vault", source: "vault" },
        { label: "Delivery 4", url: "https://example.test/github", source: "github" },
      ],
    };

    expect(evaluateDeliveryCase(evaluationCase, { kind: "answer", answer })).toMatchObject({
      passed: true,
      failures: [],
      citationCount: 5,
    });
  });

  it("scores answer and denial cases without returning question or answer bodies", () => {
    const evaluationSet = parseDeliveryEvaluationSet({
      version: 1,
      thresholds: {
        minimumPassRate: 1,
        minimumHumanUsefulnessAverage: 4,
      },
      cases: [
        {
          id: "status",
          question: "What is the status?",
          expected: {
            outcome: "answer",
            intents: ["status"],
            status: "ok",
            minimumCitations: 1,
            citationSources: ["jira"],
            requiredTerms: ["release is ready"],
            forbiddenTerms: ["private finance"],
            acceptancePassed: true,
            ratedAnswerFingerprint: acceptedAnswerFingerprint,
            humanUsefulnessRating: 5,
          },
        },
        {
          id: "finance-denied",
          question: "What is the project budget?",
          expected: {
            outcome: "deny",
            failureOperation: "delivery-finance-authorization",
          },
        },
      ],
    });
    const statusCase = evaluationSet.cases[0];
    const financeCase = evaluationSet.cases[1];
    if (statusCase === undefined || financeCase === undefined)
      throw new Error("Expected two evaluation cases.");
    const results = [
      evaluateDeliveryCase(statusCase, {
        kind: "answer",
        answer: acceptedAnswer(),
      }),
      evaluateDeliveryCase(financeCase, {
        kind: "failure",
        operation: "delivery-finance-authorization",
      }),
    ];
    const report = summarizeDeliveryEvaluation(evaluationSet, results);

    expect(report).toMatchObject({
      passed: true,
      total: 2,
      passedCount: 2,
      passRate: 1,
      humanUsefulness: {
        ratedCount: 1,
        answerCount: 1,
        average: 5,
        minimum: 4,
        passed: true,
      },
      quality: {
        answeredCount: 1,
        completenessPassRate: 1,
        citationPassRate: 1,
        groundingPassRate: 1,
        freshnessPassRate: 1,
        formatPassRate: 1,
        latencyPassRate: 1,
      },
      authorization: {
        checkCount: 1,
        passedCount: 1,
        passRate: 1,
      },
    });
    expect(results.map(({ category }) => category)).toEqual(["quality", "authorization"]);
    expect(results[0]?.answerFingerprint).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(JSON.stringify(report)).not.toContain("What is the status?");
    expect(JSON.stringify(report)).not.toContain("Release is ready");
    expect(JSON.stringify(report)).not.toContain("https://jira.example");
  });

  it("invalidates a human rating when the answer fingerprint changes", () => {
    const evaluationSet = parseDeliveryEvaluationSet({
      version: 1,
      thresholds: {
        minimumPassRate: 1,
        minimumHumanUsefulnessAverage: 4,
      },
      cases: [
        {
          id: "status",
          question: "What is the status?",
          expected: {
            outcome: "answer",
            ratedAnswerFingerprint: `sha256-${"0".repeat(64)}`,
            humanUsefulnessRating: 5,
          },
        },
      ],
    });
    const statusCase = evaluationSet.cases[0];
    if (statusCase === undefined) throw new Error("Expected one evaluation case.");
    const result = evaluateDeliveryCase(statusCase, {
      kind: "answer",
      answer: acceptedAnswer(),
    });

    expect(summarizeDeliveryEvaluation(evaluationSet, [result])).toMatchObject({
      passed: false,
      passRate: 0,
      humanUsefulness: {
        ratedCount: 0,
        answerCount: 1,
        passed: false,
      },
      authorization: {
        checkCount: 0,
        passedCount: 0,
        passRate: 1,
      },
    });
    expect(result.failures).toContain("human_rating_fingerprint_mismatch");
  });

  it("scores evaluator-only theme and initiative recall without exposing benchmark terms", () => {
    const evaluationSet = parseDeliveryEvaluationSet({
      version: 1,
      thresholds: { minimumPassRate: 1 },
      cases: [
        {
          id: "quarterly-reconstruction",
          question: "What was delivered in the previous quarter?",
          expected: {
            outcome: "answer",
            reconstruction: {
              themeTerms: [
                "theme one",
                "theme two",
                "theme three",
                "theme four",
                "theme five",
                "theme six",
                "theme seven",
              ],
              initiativeTerms: [
                "initiative one",
                "initiative two",
                "initiative three",
                "initiative four",
                "initiative five",
              ],
              minimumThemeRecall: 0.85,
              minimumInitiativeRecall: 0.8,
            },
          },
        },
      ],
    });
    const evaluationCase = evaluationSet.cases[0];
    if (evaluationCase === undefined) throw new Error("Expected reconstruction case.");
    const answer = {
      ...acceptedAnswer(),
      text: [
        "theme one theme two theme three theme four theme five theme six",
        "initiative one initiative two initiative three initiative four",
      ].join("\n"),
    };

    const result = evaluateDeliveryCase(evaluationCase, { kind: "answer", answer });

    expect(result).toMatchObject({
      passed: true,
      reconstruction: {
        matchedThemes: 6,
        totalThemes: 7,
        themeRecall: 0.8571,
        matchedInitiatives: 4,
        totalInitiatives: 5,
        initiativeRecall: 0.8,
        passed: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain("theme one");
    expect(JSON.stringify(result)).not.toContain("initiative one");
  });
});

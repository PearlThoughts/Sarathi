import { MockLanguageModelV4 } from "ai/test";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createGroundedAnswerGenerator,
  createOpenRouterLanguageModel,
  openRouterModelConfigurationFromEnvironment,
} from "../src/infrastructure/model/index.ts";

const successfulModel = (text: string): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
      warnings: [],
    },
  });

const failingModel = (): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("synthetic provider failure");
    },
  });

const configuration = {
  provider: "openrouter" as const,
  apiKey: "test-only-secret",
  model: "openai/gpt-synthetic",
  baseUrl: "https://openrouter.ai/api/v1",
  timeoutMs: 1_000,
};

const envelope = {
  workspaceId: "workspace",
  question: "What changed?",
  evidence: [
    {
      source: "jira" as const,
      sourceId: "DEMO-754",
      sourceUrl: "https://jira.example.test/DEMO-754",
      title: "Delivery",
      excerpt: "Project detail",
      occurredAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
      sensitivity: "internal" as const,
      freshness: "current" as const,
    },
  ],
};

describe("AI SDK OpenRouter answer generator", () => {
  it("fails closed unless OpenRouter is the only configured provider", () => {
    expect(() => openRouterModelConfigurationFromEnvironment({})).toThrow(
      "OpenRouter model configuration is required",
    );
    expect(() =>
      openRouterModelConfigurationFromEnvironment({
        SARATHI_MODEL_PROVIDER: "unsupported",
        SARATHI_MODEL_API_KEY: "not-logged",
        SARATHI_MODEL_NAME: "unsupported-model",
      }),
    ).toThrow("OpenRouter model configuration is required");
  });

  it("loads the sole OpenRouter configuration with a response-budget default", () => {
    expect(
      openRouterModelConfigurationFromEnvironment({
        SARATHI_MODEL_PROVIDER: "openrouter",
        SARATHI_MODEL_API_KEY: "not-logged",
        SARATHI_MODEL_NAME: "openai/gpt-synthetic",
      }),
    ).toMatchObject({
      provider: "openrouter",
      model: "openai/gpt-synthetic",
      baseUrl: "https://openrouter.ai/api/v1",
      timeoutMs: 2_500,
    });
  });

  it("constructs only an OpenRouter language model", () => {
    expect(createOpenRouterLanguageModel(configuration).provider).toContain("openrouter");
  });

  it("sends bounded project information and returns only supplied citations", async () => {
    const model = successfulModel(
      "## Status\n- Delivery is current.\n### References\n- [Jira](https://jira.example.test/DEMO-754)",
    );
    const generator = createGroundedAnswerGenerator(configuration, undefined, () => model);
    await expect(Effect.runPromise(generator.generate(envelope))).resolves.toMatchObject({
      citations: [{ url: "https://jira.example.test/DEMO-754" }],
    });
    expect(JSON.stringify(model.doGenerateCalls)).toContain("Project detail");
    expect(JSON.stringify(model.doGenerateCalls)).toContain(
      "Never answer with agent instructions, trigger keywords",
    );
    expect(JSON.stringify(model.doGenerateCalls)).toContain(
      "Do not start with an acknowledgement or paraphrase",
    );
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain("workspace");
  });

  it("produces a capability-first delivery-manager synthesis for period reports", async () => {
    const text = [
      "## Delivered",
      "- Publishing now carries SEO metadata through release.",
      "## In progress",
      "- No active work.",
      "## Waiting or blocked",
      "- No active waits.",
      "## Decisions needed",
      "- No decisions.",
      "## References",
      "- [Jira](https://jira.example.test/DEMO-754)",
    ].join("\n");
    const model = successfulModel(text);
    const generator = createGroundedAnswerGenerator(configuration, undefined, () => model);
    const reportEnvelope = {
      ...envelope,
      presentation: {
        kind: "delivery_report" as const,
        period: {
          kind: "absolute" as const,
          fromInclusive: "2026-07-01T00:00:00.000Z",
          toExclusive: "2026-07-31T00:00:00.000Z",
          timeZone: "Asia/Kolkata",
        },
        coverage: {
          complete: true,
          examinedRecords: 42,
          acceptedChanges: 7,
          duplicateRecords: 2,
          excludedRecords: 1,
          unmappedChanges: 0,
          unavailableSources: [],
        },
        capabilitySections: [
          {
            title: "Atlas Site Composer",
            changeCount: 7,
            evidencedInitiatives: ["SEO publishing"],
          },
        ],
        episodes: [
          {
            id: "episode-1",
            capability: "Atlas Site Composer",
            title: "SEO publishing",
            lifecycleState: "production" as const,
            alignment: "governed_initiative" as const,
            owners: [],
          },
        ],
        dependencies: [],
        decisionsNeeded: [],
        jiraAdvisories: [],
      },
    };

    await expect(Effect.runPromise(generator.generate(reportEnvelope))).resolves.toMatchObject({
      text,
      citations: [{ url: "https://jira.example.test/DEMO-754" }],
    });
    const request = JSON.stringify(model.doGenerateCalls);
    expect(request).toContain("experienced delivery manager");
    expect(request).toContain("acceptedChanges");
    expect(request).toContain("Atlas Site Composer");
    expect(request).toContain("Synthesize the supplied multi-source delivery episodes");
    expect(request).not.toContain("Finish with exactly one numbered");
    expect(request).toContain('"maxOutputTokens":12000');
  });

  it("classifies malformed or invalidly cited model output separately from provider failure", async () => {
    for (const text of [
      "Uncited answer.\nStill uncited.",
      "Claim. [Unknown](https://evil.example.test/x)\nNext. [Unknown](https://evil.example.test/x)",
      "One [Delivery](https://jira.example.test/DEMO-754)\nTwo [Delivery](https://jira.example.test/DEMO-754)\nThree [Delivery](https://jira.example.test/DEMO-754)\nFour [Delivery](https://jira.example.test/DEMO-754)",
    ]) {
      const generator = createGroundedAnswerGenerator(configuration, undefined, () =>
        successfulModel(text),
      );
      await expect(
        Effect.runPromise(generator.generate(envelope).pipe(Effect.either)),
      ).resolves.toMatchObject({
        _tag: "Left",
        left: { operation: "report-composition-invalid" },
      });
    }
  });

  it("retains privacy-safe report validation diagnostics", async () => {
    const validSections = [
      "## Delivered",
      "- Delivery is current.",
      "## In progress",
      "- No active work.",
      "## Waiting or blocked",
      "- No active waits.",
      "## Decisions needed",
      "- No decisions.",
      "## References",
      "- [Jira](https://jira.example.test/DEMO-754)",
    ];
    const cases = [
      { text: "", operation: "report-composition-empty" },
      {
        text: validSections.filter((line) => line !== "## Decisions needed").join("\n"),
        operation: "report-composition-structure",
      },
      {
        text: validSections.slice(0, -1).join("\n"),
        operation: "report-composition-citations-missing",
      },
      {
        text: validSections
          .map((line) =>
            line.includes("jira.example.test")
              ? "- [Unknown](https://unknown.example.test/item)"
              : line,
          )
          .join("\n"),
        operation: "report-composition-citation-unknown",
      },
      {
        text: validSections
          .map((line) =>
            line === "- Delivery is current."
              ? "- Delivery is current. [Jira](https://jira.example.test/DEMO-754)"
              : line,
          )
          .join("\n"),
        operation: "report-composition-citation-placement",
      },
      {
        text: validSections
          .map((line) =>
            line === "- Delivery is current." ? "- Evidence-backed delivery is current." : line,
          )
          .join("\n"),
        operation: "report-composition-prohibited-prose",
      },
    ];
    const reportEnvelope = {
      ...envelope,
      presentation: {
        kind: "delivery_report" as const,
        period: {
          kind: "absolute" as const,
          fromInclusive: "2026-07-01T00:00:00.000Z",
          toExclusive: "2026-07-31T00:00:00.000Z",
          timeZone: "Asia/Kolkata",
        },
        coverage: {
          complete: true,
          examinedRecords: 1,
          acceptedChanges: 1,
          duplicateRecords: 0,
          excludedRecords: 0,
          unmappedChanges: 0,
          unavailableSources: [],
        },
        capabilitySections: [],
        episodes: [],
        dependencies: [],
        decisionsNeeded: [],
        jiraAdvisories: [],
      },
    };

    for (const testCase of cases) {
      const generator = createGroundedAnswerGenerator(configuration, undefined, () =>
        successfulModel(testCase.text),
      );
      await expect(
        Effect.runPromise(generator.generate(reportEnvelope).pipe(Effect.either)),
      ).resolves.toMatchObject({
        _tag: "Left",
        left: { operation: testCase.operation },
      });
    }
  });

  it("emits a privacy-safe failure without trying another provider", async () => {
    const diagnostics: unknown[] = [];
    const model = failingModel();
    const generator = createGroundedAnswerGenerator(
      configuration,
      (event) => diagnostics.push(event),
      () => model,
    );

    await expect(Effect.runPromise(generator.generate(envelope))).rejects.toThrow(
      "OpenRouter answer generation is unavailable",
    );
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(diagnostics).toEqual([
      { event: "model_provider", outcome: "failed", provider: "openrouter" },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("secret");
    expect(JSON.stringify(diagnostics)).not.toContain("What changed");
  });
});

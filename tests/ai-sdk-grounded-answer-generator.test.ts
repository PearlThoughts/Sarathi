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
      "I found the current delivery position.\n- **Status:** Delivery is current. [Delivery](https://jira.example.test/DEMO-754)\n1. **Next:** Confirm QA ownership. [Delivery](https://jira.example.test/DEMO-754)",
    );
    const generator = createGroundedAnswerGenerator(configuration, undefined, () => model);
    await expect(Effect.runPromise(generator.generate(envelope))).resolves.toMatchObject({
      citations: [{ url: "https://jira.example.test/DEMO-754" }],
    });
    expect(JSON.stringify(model.doGenerateCalls)).toContain("Project detail");
    expect(JSON.stringify(model.doGenerateCalls)).toContain(
      "Never answer with agent instructions, trigger keywords",
    );
    expect(JSON.stringify(model.doGenerateCalls)).toContain("Start with one short prose sentence");
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain("workspace");
  });

  it("produces an unconstrained delivery-manager synthesis for period reports", async () => {
    const text = [
      "## Executive summary",
      "The team completed the publishing foundation and made the operational handoff explicit.",
      "",
      "## Delivered by capability",
      "### Modern Website Builder",
      "The publishing path now carries SEO metadata through release, consolidating the Jira outcome and repository implementation into one initiative. [Delivery](https://jira.example.test/DEMO-754)",
      "",
      "## Outcomes and business context",
      "The supplied information establishes delivery completion, but does not contain a measured customer or commercial outcome.",
      "",
      "## Gaps and unknowns",
      "No accepted customer outcome was supplied for this period.",
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
            title: "Modern Website Builder",
            changeCount: 7,
            evidencedInitiatives: ["SEO publishing"],
          },
        ],
      },
    };

    await expect(Effect.runPromise(generator.generate(reportEnvelope))).resolves.toMatchObject({
      text,
      citations: [{ url: "https://jira.example.test/DEMO-754" }],
    });
    const request = JSON.stringify(model.doGenerateCalls);
    expect(request).toContain("experienced delivery manager");
    expect(request).toContain("acceptedChanges");
    expect(request).toContain("Modern Website Builder");
    expect(request).toContain("Do not impose a three-to-five-line");
    expect(request).not.toContain("Finish with exactly one numbered");
  });

  it("rejects verbose, uncited, and invented-citation answers before delivery", async () => {
    for (const text of [
      "Uncited answer.\nStill uncited.",
      "Claim. [Unknown](https://evil.example.test/x)\nNext. [Unknown](https://evil.example.test/x)",
      "One [Delivery](https://jira.example.test/DEMO-754)\nTwo [Delivery](https://jira.example.test/DEMO-754)\nThree [Delivery](https://jira.example.test/DEMO-754)\nFour [Delivery](https://jira.example.test/DEMO-754)",
    ]) {
      const generator = createGroundedAnswerGenerator(configuration, undefined, () =>
        successfulModel(text),
      );
      await expect(Effect.runPromise(generator.generate(envelope))).rejects.toThrow(
        "OpenRouter answer generation is unavailable",
      );
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

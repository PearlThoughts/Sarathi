import { MockLanguageModelV4 } from "ai/test";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createFailoverGroundedAnswerGenerator,
  createLanguageModel,
  groundedAnswerFailoverConfigurationFromEnvironment,
} from "../src/infrastructure/model/index.ts";

const successfulModel = (text: string): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
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

const primaryConfiguration = {
  provider: "zai" as const,
  apiKey: "primary-secret",
  model: "glm-synthetic",
  baseUrl: "https://primary.example.test/v1",
  timeoutMs: 1_000,
};

const fallbackConfiguration = {
  provider: "openrouter" as const,
  apiKey: "fallback-secret",
  model: "openai/gpt-synthetic",
  baseUrl: "https://fallback.example.test/v1",
  timeoutMs: 1_000,
};

describe("AI SDK grounded answer generator", () => {
  it("fails closed without explicit provider configuration", () => {
    expect(() => groundedAnswerFailoverConfigurationFromEnvironment({})).toThrow(
      "Approved model provider configuration is required",
    );
  });

  it("loads an explicit Z.AI primary and OpenRouter fallback without exposing credentials", () => {
    const configuration = groundedAnswerFailoverConfigurationFromEnvironment({
      SARATHI_MODEL_PROVIDER: "zai",
      SARATHI_MODEL_API_KEY: "primary-secret",
      SARATHI_MODEL_NAME: "glm-synthetic",
      SARATHI_MODEL_FALLBACK_PROVIDER: "openrouter",
      SARATHI_MODEL_FALLBACK_API_KEY: "fallback-secret",
      SARATHI_MODEL_FALLBACK_NAME: "openai/gpt-synthetic",
    });

    expect(configuration).toMatchObject({
      primary: {
        provider: "zai",
        model: "glm-synthetic",
        baseUrl: "https://api.z.ai/api/paas/v4",
      },
      fallback: {
        provider: "openrouter",
        model: "openai/gpt-synthetic",
        baseUrl: "https://openrouter.ai/api/v1",
      },
    });
  });

  it("fails closed when fallback configuration is partial", () => {
    expect(() =>
      groundedAnswerFailoverConfigurationFromEnvironment({
        SARATHI_MODEL_PROVIDER: "zai",
        SARATHI_MODEL_API_KEY: "primary-secret",
        SARATHI_MODEL_NAME: "glm-synthetic",
        SARATHI_MODEL_FALLBACK_PROVIDER: "openrouter",
      }),
    ).toThrow("Approved model provider configuration is required");
    expect(() =>
      groundedAnswerFailoverConfigurationFromEnvironment({
        SARATHI_MODEL_PROVIDER: "zai",
        SARATHI_MODEL_API_KEY: "primary-secret",
        SARATHI_MODEL_NAME: "glm-synthetic",
        SARATHI_MODEL_FALLBACK_API_KEY: "fallback-secret",
      }),
    ).toThrow("Approved model provider configuration is required");
  });

  it("ignores an explicitly disabled projected fallback", () => {
    expect(
      groundedAnswerFailoverConfigurationFromEnvironment({
        SARATHI_MODEL_PROVIDER: "openai",
        SARATHI_MODEL_API_KEY: "primary-secret",
        SARATHI_MODEL_NAME: "gpt-synthetic",
        SARATHI_MODEL_FALLBACK_PROVIDER: "disabled",
        SARATHI_MODEL_FALLBACK_NAME: "unconfigured",
        SARATHI_MODEL_FALLBACK_BASE_URL: "https://openrouter.ai/api/v1",
      }),
    ).not.toHaveProperty("fallback");
  });

  it("constructs dedicated OpenAI and OpenRouter models and an OpenAI-compatible Z.AI model", () => {
    expect(createLanguageModel({ ...primaryConfiguration, provider: "openai" }).provider).toContain(
      "openai",
    );
    expect(
      createLanguageModel({ ...fallbackConfiguration, provider: "openrouter" }).provider,
    ).toContain("openrouter");
    expect(createLanguageModel(primaryConfiguration).provider).toContain("zai");
  });

  it("sends bounded evidence through the SDK and returns only evidence citations", async () => {
    const model = successfulModel(
      "Delivery is approved. [Delivery](https://jira.example.test/F1851-754)\nNext action is QA. [Delivery](https://jira.example.test/F1851-754)",
    );
    const generator = createFailoverGroundedAnswerGenerator(
      { primary: { ...primaryConfiguration, provider: "openai" } },
      undefined,
      () => model,
    );
    await expect(
      Effect.runPromise(
        generator.generate({
          workspaceId: "workspace",
          question: "What changed?",
          evidence: [
            {
              source: "jira",
              sourceId: "F1851-754",
              sourceUrl: "https://jira.example.test/F1851-754",
              title: "Delivery",
              excerpt: "Approved detail",
              occurredAt: "2026-07-11T00:00:00.000Z",
              updatedAt: "2026-07-11T00:00:00.000Z",
              sensitivity: "internal",
              freshness: "current",
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      text: "Delivery is approved. [Delivery](https://jira.example.test/F1851-754)\nNext action is QA. [Delivery](https://jira.example.test/F1851-754)",
      citations: [{ url: "https://jira.example.test/F1851-754" }],
    });
    expect(JSON.stringify(model.doGenerateCalls)).toContain("Approved detail");
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain("workspace");
  });

  it("rejects verbose, uncited, and invented-citation answers before delivery", async () => {
    const envelope = {
      workspaceId: "workspace",
      question: "What changed?",
      evidence: [
        {
          source: "jira" as const,
          sourceId: "F1851-754",
          sourceUrl: "https://jira.example.test/F1851-754",
          title: "Delivery",
          excerpt: "Approved detail",
          occurredAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
          sensitivity: "internal" as const,
          freshness: "current" as const,
        },
      ],
    };
    for (const text of [
      "Uncited answer.\nStill uncited.",
      "Claim. [Unknown](https://evil.example.test/x)\nNext. [Unknown](https://evil.example.test/x)",
      "One [Delivery](https://jira.example.test/F1851-754)\nTwo [Delivery](https://jira.example.test/F1851-754)\nThree [Delivery](https://jira.example.test/F1851-754)\nFour [Delivery](https://jira.example.test/F1851-754)",
    ]) {
      const generator = createFailoverGroundedAnswerGenerator(
        { primary: primaryConfiguration },
        undefined,
        () => successfulModel(text),
      );
      await expect(Effect.runPromise(generator.generate(envelope))).rejects.toThrow(
        "Approved answer generation is unavailable",
      );
    }
  });

  it("uses the fallback once and emits only privacy-safe provider diagnostics", async () => {
    const diagnostics: unknown[] = [];
    const primary = failingModel();
    const fallback = successfulModel("Fallback fact.");
    const generator = createFailoverGroundedAnswerGenerator(
      {
        primary: primaryConfiguration,
        fallback: fallbackConfiguration,
      },
      (event) => diagnostics.push(event),
      (configuration) => (configuration.provider === "zai" ? primary : fallback),
    );

    await expect(
      Effect.runPromise(
        generator.generate({
          workspaceId: "workspace",
          question: "What changed?",
          evidence: [],
        }),
      ),
    ).resolves.toMatchObject({ text: "Fallback fact." });
    expect(primary.doGenerateCalls).toHaveLength(1);
    expect(fallback.doGenerateCalls).toHaveLength(1);
    expect(diagnostics).toEqual([
      { event: "model_provider", stage: "primary", outcome: "failed", provider: "zai" },
      {
        event: "model_provider",
        stage: "fallback",
        outcome: "succeeded",
        provider: "openrouter",
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("secret");
    expect(JSON.stringify(diagnostics)).not.toContain("What changed");
  });

  it("fails when both configured providers fail", async () => {
    const primary = failingModel();
    const fallback = failingModel();
    const generator = createFailoverGroundedAnswerGenerator(
      {
        primary: primaryConfiguration,
        fallback: fallbackConfiguration,
      },
      undefined,
      (configuration) => (configuration.provider === "zai" ? primary : fallback),
    );

    await expect(
      Effect.runPromise(
        generator.generate({ workspaceId: "workspace", question: "Question", evidence: [] }),
      ),
    ).rejects.toThrow("Approved answer generation is unavailable");
    expect(primary.doGenerateCalls).toHaveLength(1);
    expect(fallback.doGenerateCalls).toHaveLength(1);
  });
});

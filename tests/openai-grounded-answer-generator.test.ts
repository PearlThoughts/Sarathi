import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createFailoverGroundedAnswerGenerator,
  createOpenAiGroundedAnswerGenerator,
  groundedAnswerFailoverConfigurationFromEnvironment,
  openAiGroundedAnswerConfigurationFromEnvironment,
} from "../src/infrastructure/model/index.ts";

describe("approved OpenAI-compatible answer generator", () => {
  it("fails closed without explicit provider configuration", () => {
    expect(() => openAiGroundedAnswerConfigurationFromEnvironment({})).toThrow(
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

  it("sends bounded evidence and returns only evidence citations", async () => {
    let requestBody = "";
    const generator = createOpenAiGroundedAnswerGenerator({
      provider: "openai",
      apiKey: "key",
      model: "model",
      baseUrl: "https://model.example.test/v1",
      timeoutMs: 1_000,
      fetcher: async (_input, init) => {
        requestBody = String(init?.body);
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Known fact." } }] }),
          { status: 200 },
        );
      },
    });
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
      text: "Known fact.",
      citations: [{ url: "https://jira.example.test/F1851-754" }],
    });
    expect(requestBody).toContain("Approved detail");
    expect(requestBody).not.toContain("workspace");
  });

  it("uses the fallback once and emits only privacy-safe provider diagnostics", async () => {
    const diagnostics: unknown[] = [];
    let fallbackCalls = 0;
    const generator = createFailoverGroundedAnswerGenerator(
      {
        primary: {
          provider: "zai",
          apiKey: "primary-secret",
          model: "glm-synthetic",
          baseUrl: "https://primary.example.test/v1",
          timeoutMs: 1_000,
          fetcher: async () => new Response("unavailable", { status: 503 }),
        },
        fallback: {
          provider: "openrouter",
          apiKey: "fallback-secret",
          model: "openai/gpt-synthetic",
          baseUrl: "https://fallback.example.test/v1",
          timeoutMs: 1_000,
          fetcher: async () => {
            fallbackCalls += 1;
            return new Response(
              JSON.stringify({ choices: [{ message: { content: "Fallback fact." } }] }),
              { status: 200 },
            );
          },
        },
      },
      (event) => diagnostics.push(event),
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
    expect(fallbackCalls).toBe(1);
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
    const generator = createFailoverGroundedAnswerGenerator({
      primary: {
        provider: "zai",
        apiKey: "primary-secret",
        model: "glm-synthetic",
        baseUrl: "https://primary.example.test/v1",
        timeoutMs: 1_000,
        fetcher: async () => new Response("unavailable", { status: 503 }),
      },
      fallback: {
        provider: "openrouter",
        apiKey: "fallback-secret",
        model: "openai/gpt-synthetic",
        baseUrl: "https://fallback.example.test/v1",
        timeoutMs: 1_000,
        fetcher: async () => new Response("unavailable", { status: 503 }),
      },
    });

    await expect(
      Effect.runPromise(
        generator.generate({ workspaceId: "workspace", question: "Question", evidence: [] }),
      ),
    ).rejects.toThrow("Approved answer generation is unavailable");
  });
});

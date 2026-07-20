import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import {
  createAiSdkKnowledgeEmbedding,
  knowledgeEmbeddingConfigurationFromEnvironment,
} from "../src/infrastructure/model/ai-sdk-knowledge-embedding.ts";

describe("AI SDK knowledge embedding", () => {
  test("requires an explicit approved provider without exposing credential values", () => {
    expect(() =>
      knowledgeEmbeddingConfigurationFromEnvironment({
        SARATHI_EMBEDDING_PROVIDER: "openrouter",
        SARATHI_EMBEDDING_API_KEY: "",
        SARATHI_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      }),
    ).toThrow("Approved embedding provider configuration is required.");
  });

  test("batches through the AI SDK boundary and validates projection dimensions", async () => {
    const calls: string[][] = [];
    const embedding = createAiSdkKnowledgeEmbedding(
      {
        provider: "openrouter",
        apiKey: "test-only",
        model: "openai/text-embedding-3-small",
        baseUrl: "https://openrouter.ai/api/v1",
        dimensions: 1536,
        timeoutMs: 1_000,
        batchSize: 2,
      },
      async ({ values }) => {
        calls.push(values);
        return {
          embeddings: values.map(() => Array.from({ length: 1536 }, () => 0.25)),
        };
      },
    );

    const result = await Effect.runPromise(embedding.embed(["one", "two", "three"]));

    expect(calls).toEqual([["one", "two"], ["three"]]);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(1536);
    expect(embedding.model).toBe("openrouter:openai/text-embedding-3-small");
  });

  test("fails closed on a provider shape mismatch", async () => {
    const embedding = createAiSdkKnowledgeEmbedding(
      {
        provider: "openrouter",
        apiKey: "test-only",
        model: "openai/text-embedding-3-small",
        baseUrl: "https://example.invalid/v1",
        dimensions: 1536,
        timeoutMs: 1_000,
        batchSize: 2,
      },
      async () => ({ embeddings: [[0.5]] }),
    );

    const outcome = await Effect.runPromiseExit(embedding.embed(["one"]));
    expect(outcome._tag).toBe("Failure");
    expect(JSON.stringify(outcome)).not.toContain("test-only");
  });
});

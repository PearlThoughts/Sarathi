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
    const retries: number[] = [];
    const configuredDimensions: unknown[] = [];
    const diagnostics: unknown[] = [];
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
      async ({ model, values, maxRetries }) => {
        calls.push(values);
        retries.push(maxRetries);
        configuredDimensions.push(
          (model as unknown as { settings?: { extraBody?: { dimensions?: unknown } } }).settings
            ?.extraBody?.dimensions,
        );
        return {
          embeddings: values.map(() => Array.from({ length: 1536 }, () => 0.25)),
          usage: { tokens: values.length * 3 },
        };
      },
      (diagnostic) => diagnostics.push(diagnostic),
    );

    const result = await Effect.runPromise(embedding.embed(["one", "two", "three"]));

    expect(calls).toEqual([["one", "two"], ["three"]]);
    expect(retries).toEqual([2, 2]);
    expect(configuredDimensions).toEqual([1536, 1536]);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(1536);
    expect(embedding.model).toBe("openrouter:openai/text-embedding-3-small");
    expect(diagnostics.at(-1)).toEqual({
      operation: "embedding-completed",
      totalValues: 3,
      totalBatches: 2,
      totalTokens: 9,
    });
  });

  test("accepts a bounded retry override without exposing the credential", () => {
    const configuration = knowledgeEmbeddingConfigurationFromEnvironment({
      SARATHI_EMBEDDING_PROVIDER: "openrouter",
      SARATHI_EMBEDDING_API_KEY: "test-only",
      SARATHI_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      SARATHI_EMBEDDING_MAX_RETRIES: "3",
    });

    expect(configuration.maxRetries).toBe(3);
    expect(JSON.stringify(configuration).replace(configuration.apiKey, "[redacted]")).not.toContain(
      "test-only",
    );
  });

  test("runs bounded batches concurrently while preserving vector order", async () => {
    let active = 0;
    let maximumActive = 0;
    const diagnostics: unknown[] = [];
    const embedding = createAiSdkKnowledgeEmbedding(
      {
        provider: "openrouter",
        apiKey: "test-only",
        model: "openai/text-embedding-3-small",
        baseUrl: "https://openrouter.ai/api/v1",
        dimensions: 1536,
        timeoutMs: 1_000,
        batchSize: 1,
        concurrency: 2,
      },
      async ({ values }) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, (4 - Number(values[0])) * 2));
        active -= 1;
        return {
          embeddings: values.map((value) => Array.from({ length: 1536 }, () => Number(value))),
        };
      },
      (diagnostic) => diagnostics.push(diagnostic),
    );

    const result = await Effect.runPromise(embedding.embed(["1", "2", "3"]));

    expect(maximumActive).toBe(2);
    expect(result.map((vector) => vector[0])).toEqual([1, 2, 3]);
    expect(diagnostics[0]).toEqual({
      operation: "embedding-started",
      totalValues: 3,
      totalBatches: 3,
      batchSize: 1,
      concurrency: 2,
    });
    expect(
      diagnostics.find(
        (diagnostic) =>
          (diagnostic as { operation?: unknown }).operation === "embedding-progress" &&
          (diagnostic as { completedBatches?: unknown }).completedBatches === 3,
      ),
    ).toMatchObject({
      operation: "embedding-progress",
      totalValues: 3,
      totalBatches: 3,
      completedValues: 3,
      completedBatches: 3,
    });
    expect(diagnostics.at(-1)).toEqual({
      operation: "embedding-completed",
      totalValues: 3,
      totalBatches: 3,
      totalTokens: 0,
    });
  });

  test("accepts a positive bounded concurrency override", () => {
    const configuration = knowledgeEmbeddingConfigurationFromEnvironment({
      SARATHI_EMBEDDING_PROVIDER: "openrouter",
      SARATHI_EMBEDDING_API_KEY: "test-only",
      SARATHI_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      SARATHI_EMBEDDING_CONCURRENCY: "3",
    });

    expect(configuration.concurrency).toBe(3);
    expect(() =>
      knowledgeEmbeddingConfigurationFromEnvironment({
        SARATHI_EMBEDDING_PROVIDER: "openrouter",
        SARATHI_EMBEDDING_API_KEY: "test-only",
        SARATHI_EMBEDDING_MODEL: "openai/text-embedding-3-small",
        SARATHI_EMBEDDING_CONCURRENCY: "0",
      }),
    ).toThrow("Approved embedding provider configuration is required.");
    expect(() =>
      knowledgeEmbeddingConfigurationFromEnvironment({
        SARATHI_EMBEDDING_PROVIDER: "openrouter",
        SARATHI_EMBEDDING_API_KEY: "test-only",
        SARATHI_EMBEDDING_MODEL: "openai/text-embedding-3-small",
        SARATHI_EMBEDDING_CONCURRENCY: "9",
      }),
    ).toThrow("Approved embedding provider configuration is required.");
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

  test("rejects non-textual input before provider egress with privacy-safe diagnostics", async () => {
    let calls = 0;
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
      async () => {
        calls += 1;
        return { embeddings: [] };
      },
    );

    const result = await Effect.runPromise(Effect.either(embedding.embed(["valid", "\u200b"])));

    expect(result._tag).toBe("Left");
    if (result._tag !== "Left") throw new Error("Expected non-textual input to fail.");
    expect(result.left.operation).toMatch(
      /^knowledge-embedding\.offset-1\.count-1\.chars-1-1\.sha256-/,
    );
    expect(result.left.operation).not.toContain("\u200b");
    expect(calls).toBe(0);
  });

  test("identifies a failed provider batch without logging its source text", async () => {
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
      async ({ values }) => {
        if (values.includes("private-third-passage")) throw new Error("provider failed");
        return {
          embeddings: values.map(() => Array.from({ length: 1536 }, () => 0.25)),
        };
      },
    );

    const result = await Effect.runPromise(
      Effect.either(
        embedding.embed(["first", "second", "private-third-passage", "private-fourth-passage"]),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag !== "Left") throw new Error("Expected the provider batch to fail.");
    expect(result.left.operation).toMatch(
      /^knowledge-embedding\.offset-2\.count-2\.chars-21-22\.sha256-/,
    );
    expect(result.left.operation).not.toContain("private");
  });
});

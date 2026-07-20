import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { type EmbeddingModel, embedMany } from "ai";
import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import type { KnowledgeEmbeddingPort } from "../../modules/knowledge-layer/index.ts";

export type KnowledgeEmbeddingProvider = "openai" | "openrouter" | "zai";

export type KnowledgeEmbeddingConfiguration = {
  readonly provider: KnowledgeEmbeddingProvider;
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly dimensions: 1536;
  readonly timeoutMs: number;
  readonly batchSize: number;
};

type EmbedManyRunner = (input: {
  readonly model: EmbeddingModel;
  readonly values: string[];
  readonly maxRetries: number;
  readonly abortSignal: AbortSignal;
  readonly experimental_telemetry: { readonly isEnabled: false };
}) => Promise<{ readonly embeddings: readonly (readonly number[])[] }>;

const defaults: Readonly<Record<KnowledgeEmbeddingProvider, string>> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  zai: "https://api.z.ai/api/paas/v4",
};

const required = (key: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "") throw new Error(`${key} is required.`);
  return value;
};

const positiveInteger = (key: string, value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${key} must be positive.`);
  return parsed;
};

export const knowledgeEmbeddingConfigurationFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): KnowledgeEmbeddingConfiguration => {
  try {
    const provider = required("SARATHI_EMBEDDING_PROVIDER", environment.SARATHI_EMBEDDING_PROVIDER);
    if (provider !== "openai" && provider !== "openrouter" && provider !== "zai")
      throw new Error("Unsupported embedding provider.");
    const dimensions = positiveInteger(
      "SARATHI_EMBEDDING_DIMENSIONS",
      environment.SARATHI_EMBEDDING_DIMENSIONS,
      1536,
    );
    if (dimensions !== 1536) throw new Error("Embedding dimensions must match the schema.");
    return {
      provider,
      apiKey: required("SARATHI_EMBEDDING_API_KEY", environment.SARATHI_EMBEDDING_API_KEY),
      model: required("SARATHI_EMBEDDING_MODEL", environment.SARATHI_EMBEDDING_MODEL),
      baseUrl: environment.SARATHI_EMBEDDING_BASE_URL ?? defaults[provider],
      dimensions,
      timeoutMs: positiveInteger(
        "SARATHI_EMBEDDING_TIMEOUT_MS",
        environment.SARATHI_EMBEDDING_TIMEOUT_MS,
        30_000,
      ),
      batchSize: positiveInteger(
        "SARATHI_EMBEDDING_BATCH_SIZE",
        environment.SARATHI_EMBEDDING_BATCH_SIZE,
        64,
      ),
    };
  } catch {
    throw new RepositoryError({
      message: "Approved embedding provider configuration is required.",
      operation: "knowledge-embedding-config",
    });
  }
};

const resolveEmbeddingModel = (configuration: KnowledgeEmbeddingConfiguration): EmbeddingModel => {
  switch (configuration.provider) {
    case "openai":
      return createOpenAI({
        apiKey: configuration.apiKey,
        baseURL: configuration.baseUrl,
      }).embeddingModel(configuration.model);
    case "openrouter":
      return createOpenRouter({
        apiKey: configuration.apiKey,
        baseURL: configuration.baseUrl,
        compatibility: "strict",
      }).textEmbeddingModel(configuration.model);
    case "zai":
      return createOpenAICompatible({
        name: "zai",
        apiKey: configuration.apiKey,
        baseURL: configuration.baseUrl,
      }).embeddingModel(configuration.model);
  }
};

export const createAiSdkKnowledgeEmbedding = (
  configuration: KnowledgeEmbeddingConfiguration,
  runner: EmbedManyRunner = embedMany,
): KnowledgeEmbeddingPort => ({
  model: `${configuration.provider}:${configuration.model}`,
  dimensions: configuration.dimensions,
  embed: (values) =>
    Effect.tryPromise({
      try: async () => {
        const vectors: (readonly number[])[] = [];
        const model = resolveEmbeddingModel(configuration);
        for (let offset = 0; offset < values.length; offset += configuration.batchSize) {
          const batch = values.slice(offset, offset + configuration.batchSize);
          const result = await runner({
            model,
            values: [...batch],
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(configuration.timeoutMs),
            experimental_telemetry: { isEnabled: false },
          });
          if (
            result.embeddings.length !== batch.length ||
            result.embeddings.some((vector) => vector.length !== configuration.dimensions)
          )
            throw new Error("Embedding response shape mismatch.");
          vectors.push(...result.embeddings);
        }
        return vectors;
      },
      catch: () =>
        new RepositoryError({
          message: "Approved embedding service is unavailable.",
          operation: "knowledge-embedding",
        }),
    }),
});

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { type EmbeddingModel, embedMany } from "ai";
import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import type { KnowledgeEmbeddingPort } from "../../modules/knowledge-layer/index.ts";

export type KnowledgeEmbeddingProvider = "openrouter";

export type KnowledgeEmbeddingConfiguration = {
  readonly provider: KnowledgeEmbeddingProvider;
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly dimensions: 1536;
  readonly timeoutMs: number;
  readonly batchSize: number;
  readonly maxRetries?: number | undefined;
};

type EmbedManyRunner = (input: {
  readonly model: EmbeddingModel;
  readonly values: string[];
  readonly maxRetries: number;
  readonly abortSignal: AbortSignal;
  readonly experimental_telemetry: { readonly isEnabled: false };
}) => Promise<{ readonly embeddings: readonly (readonly number[])[] }>;

const defaultBaseUrl = "https://openrouter.ai/api/v1";

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

const nonNegativeInteger = (key: string, value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${key} must be non-negative.`);
  return parsed;
};

export const knowledgeEmbeddingConfigurationFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): KnowledgeEmbeddingConfiguration => {
  try {
    const provider = required("SARATHI_EMBEDDING_PROVIDER", environment.SARATHI_EMBEDDING_PROVIDER);
    if (provider !== "openrouter") throw new Error("Unsupported embedding provider.");
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
      baseUrl: environment.SARATHI_EMBEDDING_BASE_URL ?? defaultBaseUrl,
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
      maxRetries: nonNegativeInteger(
        "SARATHI_EMBEDDING_MAX_RETRIES",
        environment.SARATHI_EMBEDDING_MAX_RETRIES,
        2,
      ),
    };
  } catch {
    throw new RepositoryError({
      message: "Approved embedding provider configuration is required.",
      operation: "knowledge-embedding-config",
    });
  }
};

const resolveEmbeddingModel = (configuration: KnowledgeEmbeddingConfiguration): EmbeddingModel =>
  createOpenRouter({
    apiKey: configuration.apiKey,
    baseURL: configuration.baseUrl,
    compatibility: "strict",
  }).textEmbeddingModel(configuration.model);

type EmbeddingBatchDiagnostics = {
  readonly offset: number;
  readonly count: number;
  readonly minimumCharacters: number;
  readonly maximumCharacters: number;
  readonly fingerprint: string;
};

const batchDiagnostics = (
  values: readonly string[],
  offset: number,
): EmbeddingBatchDiagnostics => ({
  offset,
  count: values.length,
  minimumCharacters: Math.min(...values.map((value) => value.length)),
  maximumCharacters: Math.max(...values.map((value) => value.length)),
  fingerprint: stableSha256(values.map((value) => stableSha256(value)).join(":")),
});

const diagnosticOperation = (diagnostics: EmbeddingBatchDiagnostics | undefined): string =>
  diagnostics === undefined
    ? "knowledge-embedding"
    : [
        "knowledge-embedding",
        `offset-${diagnostics.offset}`,
        `count-${diagnostics.count}`,
        `chars-${diagnostics.minimumCharacters}-${diagnostics.maximumCharacters}`,
        diagnostics.fingerprint,
      ].join(".");

const hasEmbeddableText = (value: string): boolean => value.replace(/[\p{C}\s]+/gu, "").length > 0;

export const createAiSdkKnowledgeEmbedding = (
  configuration: KnowledgeEmbeddingConfiguration,
  runner: EmbedManyRunner = embedMany,
): KnowledgeEmbeddingPort => ({
  model: `${configuration.provider}:${configuration.model}`,
  dimensions: configuration.dimensions,
  embed: (values) => {
    let activeBatch: EmbeddingBatchDiagnostics | undefined;
    return Effect.tryPromise({
      try: async () => {
        const invalidIndex = values.findIndex((value) => !hasEmbeddableText(value));
        if (invalidIndex >= 0) {
          activeBatch = batchDiagnostics([values[invalidIndex] ?? ""], invalidIndex);
          throw new Error("Embedding input does not contain textual content.");
        }
        const vectors: (readonly number[])[] = [];
        const model = resolveEmbeddingModel(configuration);
        for (let offset = 0; offset < values.length; offset += configuration.batchSize) {
          const batch = values.slice(offset, offset + configuration.batchSize);
          activeBatch = batchDiagnostics(batch, offset);
          const result = await runner({
            model,
            values: [...batch],
            maxRetries: configuration.maxRetries ?? 2,
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
          operation: diagnosticOperation(activeBatch),
        }),
    });
  },
});

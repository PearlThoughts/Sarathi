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
  readonly concurrency?: number | undefined;
  readonly maxRetries?: number | undefined;
};

export type KnowledgeEmbeddingDiagnostic =
  | {
      readonly operation: "embedding-started";
      readonly totalValues: number;
      readonly totalBatches: number;
      readonly batchSize: number;
      readonly concurrency: number;
    }
  | {
      readonly operation: "embedding-progress";
      readonly totalValues: number;
      readonly totalBatches: number;
      readonly completedValues: number;
      readonly completedBatches: number;
    }
  | {
      readonly operation: "embedding-completed";
      readonly totalValues: number;
      readonly totalBatches: number;
      readonly totalTokens: number;
    };

type KnowledgeEmbeddingDiagnosticSink = (diagnostic: KnowledgeEmbeddingDiagnostic) => void;

type EmbedManyRunner = (input: {
  readonly model: EmbeddingModel;
  readonly values: string[];
  readonly maxRetries: number;
  readonly abortSignal: AbortSignal;
  readonly experimental_telemetry: { readonly isEnabled: false };
}) => Promise<{
  readonly embeddings: readonly (readonly number[])[];
  readonly usage?: { readonly tokens: number } | undefined;
}>;

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

const boundedPositiveInteger = (
  key: string,
  value: string | undefined,
  fallback: number,
  maximum: number,
): number => {
  const parsed = positiveInteger(key, value, fallback);
  if (parsed > maximum) throw new Error(`${key} must not exceed ${maximum}.`);
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
      concurrency: boundedPositiveInteger(
        "SARATHI_EMBEDDING_CONCURRENCY",
        environment.SARATHI_EMBEDDING_CONCURRENCY,
        4,
        8,
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
  }).textEmbeddingModel(configuration.model, {
    extraBody: { dimensions: configuration.dimensions },
  });

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

class EmbeddingBatchFailure extends Error {
  constructor(readonly diagnostics: EmbeddingBatchDiagnostics) {
    super("Embedding batch failed.");
  }
}

export const createAiSdkKnowledgeEmbedding = (
  configuration: KnowledgeEmbeddingConfiguration,
  runner: EmbedManyRunner = embedMany,
  diagnosticSink: KnowledgeEmbeddingDiagnosticSink = () => undefined,
): KnowledgeEmbeddingPort => ({
  model: `${configuration.provider}:${configuration.model}`,
  dimensions: configuration.dimensions,
  embed: (values) => {
    return Effect.tryPromise({
      try: async () => {
        const invalidIndex = values.findIndex((value) => !hasEmbeddableText(value));
        if (invalidIndex >= 0) {
          throw new EmbeddingBatchFailure(
            batchDiagnostics([values[invalidIndex] ?? ""], invalidIndex),
          );
        }
        const model = resolveEmbeddingModel(configuration);
        const concurrency = Math.min(Math.max(configuration.concurrency ?? 4, 1), 8);
        const batches = Array.from(
          { length: Math.ceil(values.length / configuration.batchSize) },
          (_, index) => {
            const offset = index * configuration.batchSize;
            const batch = values.slice(offset, offset + configuration.batchSize);
            return { index, offset, batch, diagnostics: batchDiagnostics(batch, offset) };
          },
        );
        diagnosticSink({
          operation: "embedding-started",
          totalValues: values.length,
          totalBatches: batches.length,
          batchSize: configuration.batchSize,
          concurrency,
        });
        const vectorsByBatch: (readonly (readonly number[])[])[] = Array.from({
          length: batches.length,
        });
        const tokensByBatch: number[] = Array.from({ length: batches.length }, () => 0);
        let nextBatch = 0;
        let completedBatches = 0;
        let completedValues = 0;
        const batchFailures: EmbeddingBatchFailure[] = [];
        const progressInterval = Math.max(1, Math.ceil(batches.length / 10));
        const worker = async (): Promise<void> => {
          while (nextBatch < batches.length && batchFailures.length === 0) {
            const current = batches[nextBatch];
            nextBatch += 1;
            if (current === undefined) return;
            try {
              const result = await runner({
                model,
                values: [...current.batch],
                maxRetries: configuration.maxRetries ?? 2,
                abortSignal: AbortSignal.timeout(configuration.timeoutMs),
                experimental_telemetry: { isEnabled: false },
              });
              if (
                result.embeddings.length !== current.batch.length ||
                result.embeddings.some((vector) => vector.length !== configuration.dimensions)
              )
                throw new Error("Embedding response shape mismatch.");
              vectorsByBatch[current.index] = result.embeddings;
              tokensByBatch[current.index] = result.usage?.tokens ?? 0;
              completedBatches += 1;
              completedValues += current.batch.length;
              if (completedBatches === batches.length || completedBatches % progressInterval === 0)
                diagnosticSink({
                  operation: "embedding-progress",
                  totalValues: values.length,
                  totalBatches: batches.length,
                  completedValues,
                  completedBatches,
                });
            } catch {
              const failure = new EmbeddingBatchFailure(current.diagnostics);
              batchFailures.push(failure);
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()),
        );
        const earliestFailure = batchFailures.sort(
          (left, right) => left.diagnostics.offset - right.diagnostics.offset,
        )[0];
        if (earliestFailure !== undefined) throw earliestFailure;
        diagnosticSink({
          operation: "embedding-completed",
          totalValues: values.length,
          totalBatches: batches.length,
          totalTokens: tokensByBatch.reduce((total, tokens) => total + tokens, 0),
        });
        return vectorsByBatch.flatMap((batch) => batch ?? []);
      },
      catch: (failure) =>
        new RepositoryError({
          message: "Approved embedding service is unavailable.",
          operation: diagnosticOperation(
            failure instanceof EmbeddingBatchFailure ? failure.diagnostics : undefined,
          ),
        }),
    });
  },
});

import { Effect } from "effect";
import { stableSha256 } from "../../domain/hash.ts";
import type { KnowledgeEmbeddingPort } from "../../modules/knowledge-layer/index.ts";

const vectorFromHash = (value: string, dimensions: number): readonly number[] => {
  const hex = stableSha256(value).slice("sha256-".length);
  return Array.from({ length: dimensions }, (_, index) => {
    const offset = (index * 2) % hex.length;
    const byte = Number.parseInt(hex.slice(offset, offset + 2), 16);
    return (byte - 127.5) / 127.5;
  });
};

export const createDeterministicKnowledgeEmbedding = (
  dimensions = 1536,
): KnowledgeEmbeddingPort => {
  if (!Number.isInteger(dimensions) || dimensions <= 0)
    throw new Error("Deterministic embedding dimensions must be a positive integer.");
  return {
    model: "deterministic-test-only",
    dimensions,
    embed: (values) => Effect.succeed(values.map((value) => vectorFromHash(value, dimensions))),
  };
};

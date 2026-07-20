import { Effect } from "effect";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  type ApprovedThreadEvidence,
  type KnowledgeEmbeddingPort,
  type KnowledgeLiveSearch,
  type KnowledgeRepository,
  queryKnowledgeAcrossSources,
} from "../../modules/knowledge-layer/index.ts";
import type {
  ContextEvidence,
  TeamsMentionSupplementalContext,
} from "../../modules/teams-mention/index.ts";

export type KnowledgeTeamsContextConfiguration = {
  readonly repository: KnowledgeRepository;
  readonly embeddings: KnowledgeEmbeddingPort;
  readonly liveSearches: readonly KnowledgeLiveSearch[];
  readonly audienceIds: readonly string[];
  readonly topK: number;
};

const approvedThreadEvidence = (
  evidence: readonly ContextEvidence[],
): readonly ApprovedThreadEvidence[] =>
  evidence
    .filter(({ source }) => source === "teams")
    .map((record) => ({
      sourceId: record.sourceId,
      title: record.title,
      excerpt: record.excerpt,
      citationUrl: record.sourceUrl,
      sourceUpdatedAt: record.updatedAt,
      sensitivity: record.sensitivity,
    }));

const freshness = (score: number): ContextEvidence["freshness"] =>
  score >= 0.5 ? "current" : "stale";

export const createKnowledgeTeamsContextSearch = (
  configuration: KnowledgeTeamsContextConfiguration,
): TeamsMentionSupplementalContext => ({
  search: (command, resolved, threadEvidence) =>
    queryKnowledgeAcrossSources(
      configuration.repository,
      configuration.embeddings,
      configuration.liveSearches,
      {
        question: command.question,
        audience: {
          workspaceId: resolved.workspaceId,
          actorId: resolved.callerId,
          audienceIds: configuration.audienceIds,
          maximumSensitivity: resolved.channelSensitivity as SensitivityTier,
        },
        topK: configuration.topK,
      },
      approvedThreadEvidence(threadEvidence),
    ).pipe(
      Effect.map((results) =>
        results.map(
          (result): ContextEvidence => ({
            source: result.source,
            sourceId: result.sourceId,
            sourceUrl: result.citationUrl,
            title: result.title,
            excerpt: result.excerpt,
            occurredAt: result.sourceUpdatedAt,
            updatedAt: result.sourceUpdatedAt,
            sensitivity: result.sensitivity,
            freshness: freshness(result.freshness),
          }),
        ),
      ),
    ),
});

import { Effect } from "effect";
import type { SensitivityTier } from "../../domain/policy.ts";
import {
  type KnowledgeEmbeddingPort,
  type KnowledgeLiveSearch,
  type KnowledgeRepository,
  type KnowledgeSourceKind,
  queryKnowledgeAcrossSources,
  type TeamsThreadContext,
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

const teamsThreadContext = (evidence: readonly ContextEvidence[]): readonly TeamsThreadContext[] =>
  evidence
    .filter(({ source, contextRole }) => source === "teams" && contextRole === "conversation")
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
  search: (command, resolved, threadEvidence) => {
    const legacy =
      resolved.authorization.effectiveAudience.membership.source === "explicit_actor_mapping";
    const audienceIds = legacy
      ? configuration.audienceIds
      : configuration.audienceIds.filter((audienceId) =>
          resolved.authorization.permittedAudienceIds.includes(audienceId),
        );
    const sources = legacy
      ? undefined
      : resolved.authorization.permittedSourceScopes.filter(
          (scope): scope is KnowledgeSourceKind => scope !== "strategy",
        );
    return queryKnowledgeAcrossSources(
      configuration.repository,
      configuration.embeddings,
      configuration.liveSearches,
      {
        question: command.question,
        audience: {
          workspaceId: resolved.workspaceId,
          actorId: resolved.callerId,
          audienceIds,
          maximumSensitivity: resolved.channelSensitivity as SensitivityTier,
        },
        ...(sources === undefined ? {} : { sources }),
        topK: configuration.topK,
      },
      teamsThreadContext(threadEvidence),
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
    );
  },
});

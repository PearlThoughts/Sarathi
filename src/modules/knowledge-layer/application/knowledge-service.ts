import { Effect } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import { reciprocalRankFusion } from "../domain/knowledge.ts";
import type {
  KnowledgeEmbeddingPort,
  KnowledgeIngestionSummary,
  KnowledgeLiveSearch,
  KnowledgeQuery,
  KnowledgeRepository,
  KnowledgeSearchResult,
  KnowledgeSourceReader,
  TeamsThreadContext,
} from "../ports/knowledge-ports.ts";

export const ingestKnowledgeSource = (
  reader: KnowledgeSourceReader,
  repository: KnowledgeRepository,
  embeddings: KnowledgeEmbeddingPort,
  workspaceId: string,
  previousCursor?: string,
): Effect.Effect<KnowledgeIngestionSummary, RepositoryError> =>
  Effect.gen(function* () {
    const snapshot = yield* reader.readSnapshot(workspaceId, previousCursor);
    if (snapshot.workspaceId !== workspaceId) {
      return yield* Effect.fail(
        new RepositoryError({
          message: "Knowledge source returned a cross-workspace snapshot; ingestion was rejected.",
          operation: "knowledge-ingest",
        }),
      );
    }
    if (snapshot.documents.some((document) => document.workspaceId !== workspaceId)) {
      return yield* Effect.fail(
        new RepositoryError({
          message: "Knowledge source returned a cross-workspace document; ingestion was rejected.",
          operation: "knowledge-ingest",
        }),
      );
    }
    if (snapshot.documents.some((document) => document.acl.length === 0)) {
      return yield* Effect.fail(
        new RepositoryError({
          message: "Knowledge documents require at least one explicit ACL binding.",
          operation: "knowledge-ingest",
        }),
      );
    }
    const observedExternalIds = new Set(snapshot.documents.map(({ externalId }) => externalId));
    const retiredExternalIds = snapshot.retiredExternalIds ?? [];
    if (
      new Set(retiredExternalIds).size !== retiredExternalIds.length ||
      retiredExternalIds.some((externalId) => observedExternalIds.has(externalId))
    ) {
      return yield* Effect.fail(
        new RepositoryError({
          message: "Knowledge source returned ambiguous delta retirements; ingestion was rejected.",
          operation: "knowledge-ingest",
        }),
      );
    }
    return yield* repository.reconcile(snapshot, embeddings);
  });

export const queryKnowledge = (
  repository: KnowledgeRepository,
  embeddings: KnowledgeEmbeddingPort,
  query: KnowledgeQuery,
): Effect.Effect<readonly KnowledgeSearchResult[], RepositoryError> =>
  embeddings.embed([query.question]).pipe(
    Effect.flatMap((vectors) => {
      const vector = vectors[0];
      return vector === undefined
        ? Effect.fail(
            new RepositoryError({
              message: "Embedding provider returned no query vector.",
              operation: "knowledge-query",
            }),
          )
        : repository.search(query, vector);
    }),
  );

export const queryKnowledgeLexically = (
  repository: KnowledgeRepository,
  query: KnowledgeQuery,
): Effect.Effect<readonly KnowledgeSearchResult[], RepositoryError> =>
  repository.searchLexical(query);

const canonicalResultKey = (result: KnowledgeSearchResult): string => {
  const url = new URL(result.citationUrl);
  url.hash = "";
  url.searchParams.sort();
  return url.toString().replace(/\/$/, "").toLowerCase();
};

export const fuseKnowledgeResults = (
  rankedLists: Readonly<Record<string, readonly KnowledgeSearchResult[]>>,
  topK: number,
): readonly KnowledgeSearchResult[] => {
  const resultsByCanonicalKey = new Map<string, KnowledgeSearchResult>();
  const candidateLists: Record<
    string,
    {
      id: string;
      source: KnowledgeSearchResult["source"];
      authority: number;
      freshness: number;
    }[]
  > = {};
  for (const [component, results] of Object.entries(rankedLists)) {
    const seen = new Set<string>();
    candidateLists[component] = [];
    for (const result of results) {
      const key = canonicalResultKey(result);
      if (seen.has(key)) continue;
      seen.add(key);
      const current = resultsByCanonicalKey.get(key);
      if (current === undefined || result.authority > current.authority)
        resultsByCanonicalKey.set(key, result);
      candidateLists[component].push({
        id: key,
        source: result.source,
        authority: result.authority,
        freshness: result.freshness,
      });
    }
  }
  return reciprocalRankFusion(candidateLists)
    .slice(0, Math.max(1, Math.min(topK, 50)))
    .flatMap((candidate): readonly KnowledgeSearchResult[] => {
      const result = resultsByCanonicalKey.get(candidate.id);
      return result === undefined
        ? []
        : [
            {
              ...result,
              componentRanks: candidate.componentRanks,
              score: candidate.fusedScore,
            },
          ];
    });
};

const asThreadResult = (evidence: TeamsThreadContext, index: number): KnowledgeSearchResult => ({
  id: `teams:${evidence.sourceId}`,
  source: "teams",
  sourceId: evidence.sourceId,
  title: evidence.title,
  excerpt: evidence.excerpt,
  citationUrl: evidence.citationUrl,
  sourceUpdatedAt: evidence.sourceUpdatedAt,
  sensitivity: evidence.sensitivity,
  authority: 0.9,
  freshness: 1,
  componentRanks: { teams: index + 1 },
  score: 0,
});

export const queryKnowledgeAcrossSources = (
  repository: KnowledgeRepository,
  embeddings: KnowledgeEmbeddingPort,
  liveSearches: readonly KnowledgeLiveSearch[],
  query: KnowledgeQuery,
  teamsThreadContext: readonly TeamsThreadContext[] = [],
): Effect.Effect<readonly KnowledgeSearchResult[], RepositoryError> =>
  Effect.all(
    [
      queryKnowledge(repository, embeddings, query),
      ...liveSearches.map((backend) => backend.search(query)),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(([indexed = [], ...live]) => {
      const rankedLists: Record<string, readonly KnowledgeSearchResult[]> = {
        indexed,
        teams: teamsThreadContext.map(asThreadResult),
      };
      liveSearches.forEach((backend, index) => {
        rankedLists[`live:${backend.source}:${index}`] = live[index] ?? [];
      });
      return fuseKnowledgeResults(rankedLists, query.topK);
    }),
  );

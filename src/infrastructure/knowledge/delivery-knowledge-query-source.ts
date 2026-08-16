import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { isSensitivityAtOrBelow } from "../../domain/policy.ts";
import {
  childDeliveryExecution,
  endDeliveryExecution,
  observeDeliveryEffect,
} from "../../modules/delivery-execution-observability/index.ts";
import type {
  DeliveryQuerySource,
  DeliveryRelevanceProfile,
} from "../../modules/delivery-intelligence/index.ts";
import {
  type KnowledgeEmbeddingPort,
  type KnowledgeRepository,
  queryKnowledgeLexically,
  rerankKnowledgeCandidates,
} from "../../modules/knowledge-layer/index.ts";
import { repositoryFromGitHubHtmlUrl } from "../github/github-repository-scope.ts";

type DeliveryKnowledgeQuerySourceConfiguration = {
  readonly repository: KnowledgeRepository;
  readonly embeddings?: KnowledgeEmbeddingPort | undefined;
  readonly workspaceId: string;
  readonly allowedActorIds: ReadonlySet<string>;
  readonly audienceIds: readonly string[];
  readonly allowedGitHubRepositories?: readonly string[] | undefined;
  readonly relevanceProfile?: DeliveryRelevanceProfile | undefined;
};

const operationalMetadata = (title: string, citationUrl: string): boolean => {
  const location = new URL(citationUrl);
  const descriptor = `${title} ${decodeURIComponent(location.pathname)} ${decodeURIComponent(location.hash)}`;
  return /\b(?:agent prompt|prompt playbook|agent trigger|trigger keywords?|routing keywords?|navigation)\b/i.test(
    descriptor.replaceAll("-", " "),
  );
};

const allowedKnowledgeCitation = (
  source: string,
  citationUrl: string,
  allowedRepositories: ReadonlySet<string> | undefined,
): boolean => {
  if (allowedRepositories === undefined || (source !== "github" && source !== "vault")) return true;
  const repository = repositoryFromGitHubHtmlUrl(citationUrl);
  return repository !== undefined && allowedRepositories.has(repository.toLocaleLowerCase("en"));
};

export const createDeliveryKnowledgeQuerySource = (
  configuration: DeliveryKnowledgeQuerySourceConfiguration,
): DeliveryQuerySource => {
  const relevanceProfile = configuration.relevanceProfile ?? "expanded";
  const allowedRepositories =
    configuration.allowedGitHubRepositories === undefined
      ? undefined
      : new Set(
          configuration.allowedGitHubRepositories.map((repository) =>
            repository.toLocaleLowerCase("en"),
          ),
        );
  return {
    source: "knowledge",
    selectors: ["knowledge"],
    execute: (context, plan) =>
      Effect.gen(function* () {
        if (
          context.workspaceId !== configuration.workspaceId ||
          !configuration.allowedActorIds.has(context.actorId)
        )
          return {
            items: [],
            conflicts: [],
            unavailableSources: [],
            complete: true,
          };
        const operation = plan.operations.find(({ select }) => select === "knowledge");
        if (operation === undefined)
          return {
            items: [],
            conflicts: [],
            unavailableSources: [],
            complete: true,
          };
        const audienceIds =
          context.audienceIds === undefined
            ? configuration.audienceIds
            : configuration.audienceIds.filter((audienceId) =>
                context.audienceIds?.includes(audienceId),
              );
        const sources = context.permittedSourceScopes?.filter((scope) => scope !== "strategy");
        const candidateLimit =
          relevanceProfile === "legacy" ? operation.limit : Math.min(50, operation.limit * 5);
        const query = {
          question: context.question,
          audience: {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            audienceIds,
            maximumSensitivity: context.maximumSensitivity,
          },
          ...(sources === undefined ? {} : { sources }),
          topK: candidateLimit,
          ...(plan.subject?.externalKey !== undefined
            ? { subject: plan.subject.externalKey }
            : plan.subject?.phrase !== undefined
              ? { subject: plan.subject.phrase }
              : {}),
          ...(plan.facets === undefined ? {} : { facets: plan.facets }),
          expandParents: false,
        } as const;
        const queryVector = yield* (() => {
          if (configuration.embeddings === undefined || relevanceProfile === "legacy")
            return Effect.succeed(undefined);
          return configuration.embeddings.embed([query.question]).pipe(
            Effect.flatMap((vectors) =>
              vectors[0] === undefined
                ? Effect.fail(
                    new RepositoryError({
                      message: "Embedding provider returned no query vector.",
                      operation: "knowledge-query",
                    }),
                  )
                : Effect.succeed(vectors[0]),
            ),
          );
        })();
        const results = yield* queryVector === undefined
          ? queryKnowledgeLexically(configuration.repository, query)
          : configuration.repository.search(query, queryVector);
        const rerankExecution =
          context.execution === undefined
            ? undefined
            : childDeliveryExecution(context.execution, "domain.rerank", {
                "candidates.retrieved": results.length,
              });
        const reranked =
          relevanceProfile === "reranked" || relevanceProfile === "expanded"
            ? rerankKnowledgeCandidates(query, results)
            : results;
        const selected = reranked.slice(0, operation.limit);
        if (rerankExecution !== undefined)
          endDeliveryExecution(rerankExecution, "success", {
            "candidates.retrieved": results.length,
            "candidates.unique": reranked.length,
            "candidates.excluded": Math.max(0, reranked.length - selected.length),
          });
        const contextualized = yield* (() => {
          if (relevanceProfile !== "expanded" || queryVector === undefined || selected.length === 0)
            return Effect.succeed(selected);
          const expand = () =>
            Effect.gen(function* () {
              const expanded = yield* configuration.repository.search(
                { ...query, expandParents: true },
                queryVector,
              );
              const expandedById = new Map(expanded.map((candidate) => [candidate.id, candidate]));
              return selected.map((candidate) => {
                const parentContext = expandedById.get(candidate.id);
                return parentContext === undefined
                  ? candidate
                  : {
                      ...parentContext,
                      componentRanks: candidate.componentRanks,
                      score: candidate.score,
                    };
              });
            });
          return context.execution === undefined
            ? expand()
            : observeDeliveryEffect(
                context.execution,
                "parent.expand",
                { "candidates.unique": selected.length },
                expand,
              );
        })();
        return {
          items: contextualized
            .filter(
              (result) =>
                (sources === undefined || sources.includes(result.source)) &&
                isSensitivityAtOrBelow(result.sensitivity, context.maximumSensitivity) &&
                allowedKnowledgeCitation(result.source, result.citationUrl, allowedRepositories) &&
                !operationalMetadata(result.title, result.citationUrl),
            )
            .map((result) => ({
              id: result.id,
              workspaceId: context.workspaceId,
              source: result.source,
              selector: "knowledge" as const,
              intent: operation.purpose,
              title: result.title,
              summary: result.excerpt,
              citationUrl: result.citationUrl,
              sensitivity: result.sensitivity,
              authority: result.authority,
              observedAt: result.sourceUpdatedAt,
              dedupeKey: result.citationUrl,
              subjectAliases: [
                ...(result.hierarchy ?? []),
                ...Object.values(result.attributes ?? {}).flatMap((value) =>
                  typeof value === "string" ? [value] : value,
                ),
              ],
            })),
          conflicts: [],
          unavailableSources: [],
          complete: true,
        };
      }).pipe(
        Effect.mapError(
          () =>
            new RepositoryError({
              message: "Connected project knowledge is unavailable.",
              operation: "delivery-query-knowledge",
            }),
        ),
      ),
  };
};

import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import { isSensitivityAtOrBelow } from "../../domain/policy.ts";
import type { DeliveryQuerySource } from "../../modules/delivery-intelligence/index.ts";
import {
  type KnowledgeRepository,
  queryKnowledgeLexically,
} from "../../modules/knowledge-layer/index.ts";

type DeliveryKnowledgeQuerySourceConfiguration = {
  readonly repository: KnowledgeRepository;
  readonly workspaceId: string;
  readonly allowedActorIds: ReadonlySet<string>;
  readonly audienceIds: readonly string[];
};

const operationalMetadata = (title: string, citationUrl: string): boolean => {
  const location = new URL(citationUrl);
  const descriptor = `${title} ${decodeURIComponent(location.pathname)} ${decodeURIComponent(location.hash)}`;
  return /\b(?:agent prompt|prompt playbook|agent trigger|trigger keywords?|routing keywords?|navigation)\b/i.test(
    descriptor.replaceAll("-", " "),
  );
};

export const createDeliveryKnowledgeQuerySource = (
  configuration: DeliveryKnowledgeQuerySourceConfiguration,
): DeliveryQuerySource => ({
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
      const results = yield* queryKnowledgeLexically(configuration.repository, {
        question: context.question,
        audience: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          audienceIds: configuration.audienceIds,
          maximumSensitivity: context.maximumSensitivity,
        },
        topK: operation.limit,
      });
      return {
        items: results
          .filter(
            (result) =>
              isSensitivityAtOrBelow(result.sensitivity, context.maximumSensitivity) &&
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
});

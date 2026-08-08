import { Effect } from "effect";
import type { RepositoryError, ValidationError } from "../../../domain/errors.ts";
import type {
  ProductEntityId,
  ProductModelError,
  ProductRelation,
} from "../domain/product-model.ts";
import type {
  ProductHierarchyNode,
  ProductModelGraphRepository,
  ProductModelReadPoint,
} from "../ports/product-model-graph-repository.ts";
import type {
  ProductModelQueryAuthorizer,
  ProductModelQueryOperation,
  ProductModelRequestContext,
} from "../ports/product-model-query-authorizer.ts";

export class ProductModelAccessDenied extends Error {
  readonly _tag = "ProductModelAccessDenied";

  constructor(
    message: string,
    readonly operation: ProductModelQueryOperation,
  ) {
    super(message);
    this.name = "ProductModelAccessDenied";
  }
}

export class ProductModelQueryUnavailable extends Error {
  readonly _tag = "ProductModelQueryUnavailable";

  constructor(readonly operation: ProductModelQueryOperation) {
    super("The requested product-model revision is not available.");
    this.name = "ProductModelQueryUnavailable";
  }
}

export type ProductModelQueryError =
  | ProductModelAccessDenied
  | ProductModelQueryUnavailable
  | ProductModelError
  | RepositoryError
  | ValidationError;

export type ProductGraphPage = {
  readonly maximumDepth: number;
  readonly maximumNodes: number;
  readonly truncated: boolean;
};

export type ProductRelationPage = {
  readonly maximumRelations: number;
  readonly truncated: boolean;
};

export type ProductGraphEnvelope = {
  readonly workspaceId: string;
  readonly asOf: string;
  readonly revision: number;
  readonly entities: readonly ProductHierarchyNode[];
  readonly relations: readonly ProductRelation[];
  readonly page: ProductGraphPage;
  readonly relationPage: ProductRelationPage;
  readonly safeWarnings: readonly string[];
};

export type ProductSubgraphEnvelope = {
  readonly workspaceId: string;
  readonly asOf: string;
  readonly revision: number;
  readonly rootEntityId: ProductEntityId;
  readonly ancestors: readonly ProductHierarchyNode[];
  readonly descendants: readonly ProductHierarchyNode[];
  readonly relations: readonly ProductRelation[];
  readonly pages: {
    readonly ancestors: ProductGraphPage;
    readonly descendants: ProductGraphPage;
    readonly relations: ProductRelationPage;
  };
  readonly safeWarnings: readonly string[];
};

export type ProductMapQuery = {
  readonly at: string;
  readonly maximumDepth?: number | undefined;
  readonly maximumNodes?: number | undefined;
  readonly maximumRelations?: number | undefined;
};

export type ProductHistoricalGraphQuery = {
  readonly validAt: string;
  readonly maximumDepth?: number | undefined;
  readonly maximumNodes?: number | undefined;
  readonly maximumRelations?: number | undefined;
};

export type ProductSubgraphQuery = {
  readonly rootEntityId: ProductEntityId;
  readonly at: string;
  readonly maximumAncestorDepth?: number | undefined;
  readonly maximumDescendantDepth?: number | undefined;
  readonly maximumNodesPerDirection?: number | undefined;
  readonly maximumRelations?: number | undefined;
};

export type ProductModelQueryService = {
  readonly getProductMap: (
    context: ProductModelRequestContext,
    query: ProductMapQuery,
  ) => Effect.Effect<ProductGraphEnvelope, ProductModelQueryError>;
  readonly getProductGraphAtTime: (
    context: ProductModelRequestContext,
    query: ProductHistoricalGraphQuery,
  ) => Effect.Effect<ProductGraphEnvelope, ProductModelQueryError>;
  readonly getCapabilitySubgraph: (
    context: ProductModelRequestContext,
    query: ProductSubgraphQuery,
  ) => Effect.Effect<ProductSubgraphEnvelope, ProductModelQueryError>;
};

const authorize = (
  authorizer: ProductModelQueryAuthorizer,
  context: ProductModelRequestContext,
  operation: ProductModelQueryOperation,
) =>
  authorizer
    .authorize(context, operation)
    .pipe(
      Effect.flatMap((decision) =>
        decision.allowed
          ? Effect.void
          : Effect.fail(new ProductModelAccessDenied(decision.reason, operation)),
      ),
    );

const visibility = (context: ProductModelRequestContext) => ({
  audienceIds: context.effectiveAudience,
  maximumSensitivity: context.maximumSensitivity,
});

const requiredRevision = (
  repository: ProductModelGraphRepository,
  workspaceId: string,
  point: ProductModelReadPoint,
  operation: ProductModelQueryOperation,
) =>
  repository
    .resolveRevision({ workspaceId, point })
    .pipe(
      Effect.flatMap((revision) =>
        revision === undefined
          ? Effect.fail(new ProductModelQueryUnavailable(operation))
          : Effect.succeed(revision),
      ),
    );

const page = (maximumDepth: number, maximumNodes: number, truncated: boolean) => ({
  maximumDepth,
  maximumNodes,
  truncated,
});

const warnings = (truncated: boolean): readonly string[] =>
  truncated ? ["Product graph results were truncated at the authorized query bound."] : [];

export const createProductModelQueryService = (
  authorizer: ProductModelQueryAuthorizer,
  repository: ProductModelGraphRepository,
): ProductModelQueryService => {
  const graph = (
    context: ProductModelRequestContext,
    operation: "get-map" | "get-historical-graph",
    point: ProductModelReadPoint,
    asOf: string,
    maximumDepth: number,
    maximumNodes: number,
    maximumRelations: number,
  ) =>
    Effect.gen(function* () {
      yield* authorize(authorizer, context, operation);
      const revision = yield* requiredRevision(repository, context.workspaceId, point, operation);
      const result = yield* repository.traverseHierarchy({
        workspaceId: context.workspaceId,
        direction: "descendants",
        maximumDepth,
        maximumNodes,
        point,
        visibility: visibility(context),
      });
      const relationResult = yield* repository.readRelations({
        workspaceId: context.workspaceId,
        entityIds: result.nodes.map(({ entityId }) => entityId),
        maximumRelations,
        point,
        visibility: visibility(context),
      });
      const isTruncated = result.truncated || relationResult.truncated;
      return {
        workspaceId: context.workspaceId,
        asOf,
        revision,
        entities: result.nodes,
        relations: relationResult.relations,
        page: page(maximumDepth, maximumNodes, result.truncated),
        relationPage: { maximumRelations, truncated: relationResult.truncated },
        safeWarnings: warnings(isTruncated),
      };
    });

  return {
    getProductMap: (context, query) => {
      const maximumDepth = query.maximumDepth ?? 4;
      const maximumNodes = query.maximumNodes ?? 250;
      const maximumRelations = query.maximumRelations ?? 250;
      return graph(
        context,
        "get-map",
        { kind: "current", at: query.at },
        query.at,
        maximumDepth,
        maximumNodes,
        maximumRelations,
      );
    },
    getProductGraphAtTime: (context, query) => {
      const maximumDepth = query.maximumDepth ?? 4;
      const maximumNodes = query.maximumNodes ?? 250;
      const maximumRelations = query.maximumRelations ?? 250;
      return graph(
        context,
        "get-historical-graph",
        { kind: "valid_time", at: query.validAt },
        query.validAt,
        maximumDepth,
        maximumNodes,
        maximumRelations,
      );
    },
    getCapabilitySubgraph: (context, query) =>
      Effect.gen(function* () {
        yield* authorize(authorizer, context, "get-subgraph");
        const point = { kind: "current" as const, at: query.at };
        const revision = yield* requiredRevision(
          repository,
          context.workspaceId,
          point,
          "get-subgraph",
        );
        const maximumAncestorDepth = query.maximumAncestorDepth ?? 4;
        const maximumDescendantDepth = query.maximumDescendantDepth ?? 4;
        const maximumNodes = query.maximumNodesPerDirection ?? 100;
        const maximumRelations = query.maximumRelations ?? 250;
        const [ancestors, descendants] = yield* Effect.all(
          [
            repository.traverseHierarchy({
              workspaceId: context.workspaceId,
              rootEntityId: query.rootEntityId,
              direction: "ancestors",
              maximumDepth: maximumAncestorDepth,
              maximumNodes,
              point,
              visibility: visibility(context),
            }),
            repository.traverseHierarchy({
              workspaceId: context.workspaceId,
              rootEntityId: query.rootEntityId,
              direction: "descendants",
              maximumDepth: maximumDescendantDepth,
              maximumNodes,
              point,
              visibility: visibility(context),
            }),
          ],
          { concurrency: 2 },
        );
        const entityIds = [
          ...new Set([...ancestors.nodes, ...descendants.nodes].map(({ entityId }) => entityId)),
        ];
        const relationResult = yield* repository.readRelations({
          workspaceId: context.workspaceId,
          entityIds,
          maximumRelations,
          point,
          visibility: visibility(context),
        });
        const isTruncated =
          ancestors.truncated || descendants.truncated || relationResult.truncated;
        return {
          workspaceId: context.workspaceId,
          asOf: query.at,
          revision,
          rootEntityId: query.rootEntityId,
          ancestors: ancestors.nodes,
          descendants: descendants.nodes,
          relations: relationResult.relations,
          pages: {
            ancestors: page(maximumAncestorDepth, maximumNodes, ancestors.truncated),
            descendants: page(maximumDescendantDepth, maximumNodes, descendants.truncated),
            relations: { maximumRelations, truncated: relationResult.truncated },
          },
          safeWarnings: warnings(isTruncated),
        };
      }),
  };
};

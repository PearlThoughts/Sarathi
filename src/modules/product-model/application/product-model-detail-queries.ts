import { Effect } from "effect";
import type { RepositoryError, ValidationError } from "../../../domain/errors.ts";
import {
  type ProductEntityId,
  type ProductModel,
  type ProductModelError,
  type ProductRelation,
  type ProductVariantAxis,
  type ResolvedProductVariant,
  resolveProductVariant,
} from "../domain/product-model.ts";
import type {
  ProductCoverageItem,
  ProductDossierSnapshot,
  ProductEntityHistoryEvent,
  ProductModelDetailRepository,
} from "../ports/product-model-detail-repository.ts";
import type { ProductModelGraphRepository } from "../ports/product-model-graph-repository.ts";
import type {
  ProductModelQueryAuthorizer,
  ProductModelRequestContext,
} from "../ports/product-model-query-authorizer.ts";
import { ProductModelAccessDenied, ProductModelQueryUnavailable } from "./product-model-queries.ts";

export type ProductModelDetailQueryError =
  | ProductModelAccessDenied
  | ProductModelQueryUnavailable
  | ProductModelError
  | RepositoryError
  | ValidationError;

export type ProductFeatureDossier = ProductDossierSnapshot & {
  readonly workspaceId: string;
  readonly asOf: string;
  readonly revision: number;
  readonly relations: readonly ProductRelation[];
  readonly safeWarnings: readonly string[];
};

export type ProductCoverage = {
  readonly workspaceId: string;
  readonly asOf: string;
  readonly revision: number;
  readonly items: readonly ProductCoverageItem[];
  readonly page: { readonly maximumItems: number; readonly truncated: boolean };
  readonly safeWarnings: readonly string[];
};

export type ProductAvailability = {
  readonly workspaceId: string;
  readonly asOf: string;
  readonly revision: number;
  readonly entityId: ProductEntityId;
  readonly lifecycle: ProductDossierSnapshot["entity"]["lifecycle"];
  readonly resolvedVariant: ResolvedProductVariant;
  readonly availabilityClaims: ProductDossierSnapshot["claims"];
  readonly availabilityReferences: ProductDossierSnapshot["externalReferences"];
  readonly deliveryStages: readonly [];
  readonly safeWarnings: readonly string[];
};

export type ProductEntityHistory = {
  readonly workspaceId: string;
  readonly asOf: string;
  readonly revision: number;
  readonly entityId: ProductEntityId;
  readonly events: readonly ProductEntityHistoryEvent[];
  readonly page: { readonly maximumItems: number; readonly truncated: boolean };
  readonly safeWarnings: readonly string[];
};

export type ProductModelDetailQueryService = {
  readonly getFeatureDossier: (
    context: ProductModelRequestContext,
    query: { readonly entityId: ProductEntityId; readonly at: string },
  ) => Effect.Effect<ProductFeatureDossier, ProductModelDetailQueryError>;
  readonly getProductCoverage: (
    context: ProductModelRequestContext,
    query: {
      readonly at: string;
      readonly staleBefore: string;
      readonly maximumItems?: number | undefined;
    },
  ) => Effect.Effect<ProductCoverage, ProductModelDetailQueryError>;
  readonly getProductAvailability: (
    context: ProductModelRequestContext,
    query: {
      readonly entityId: ProductEntityId;
      readonly at: string;
      readonly qualifiers: Readonly<Partial<Record<ProductVariantAxis, string>>>;
    },
  ) => Effect.Effect<ProductAvailability, ProductModelDetailQueryError>;
  readonly getEntityHistory: (
    context: ProductModelRequestContext,
    query: {
      readonly entityId: ProductEntityId;
      readonly at: string;
      readonly maximumItems?: number | undefined;
    },
  ) => Effect.Effect<ProductEntityHistory, ProductModelDetailQueryError>;
};

const authorize = (
  authorizer: ProductModelQueryAuthorizer,
  context: ProductModelRequestContext,
  operation: "get-dossier" | "get-coverage" | "get-availability" | "get-historical-graph",
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

const revision = (
  repository: ProductModelGraphRepository,
  context: ProductModelRequestContext,
  at: string,
  operation: "get-dossier" | "get-coverage" | "get-availability",
) =>
  repository
    .resolveRevision({
      workspaceId: context.workspaceId,
      point: { kind: "current", at },
    })
    .pipe(
      Effect.flatMap((value) =>
        value === undefined
          ? Effect.fail(new ProductModelQueryUnavailable(operation))
          : Effect.succeed(value),
      ),
    );

const requiredDossier = (
  repository: ProductModelDetailRepository,
  context: ProductModelRequestContext,
  entityId: ProductEntityId,
  at: string,
  operation: "get-dossier" | "get-availability",
) =>
  repository
    .readDossier({
      workspaceId: context.workspaceId,
      entityId,
      at,
      visibility: visibility(context),
    })
    .pipe(
      Effect.flatMap((dossier) =>
        dossier === undefined
          ? Effect.fail(new ProductModelQueryUnavailable(operation))
          : Effect.succeed(dossier),
      ),
    );

const variantModel = (dossier: ProductDossierSnapshot, revisionValue: number): ProductModel => ({
  workspaceId: dossier.entity.workspaceId,
  revision: revisionValue,
  entities: [dossier.entity],
  aliases: dossier.aliases,
  hierarchy: [],
  relations: [],
  variants: dossier.variants,
  attachments: [],
  redirects: [],
  orphans: [],
  revisions: [],
  identityEvents: [],
});

export const createProductModelDetailQueryService = (
  authorizer: ProductModelQueryAuthorizer,
  graphRepository: ProductModelGraphRepository,
  detailRepository: ProductModelDetailRepository,
): ProductModelDetailQueryService => ({
  getFeatureDossier: (context, query) =>
    Effect.gen(function* () {
      yield* authorize(authorizer, context, "get-dossier");
      const revisionValue = yield* revision(graphRepository, context, query.at, "get-dossier");
      const dossier = yield* requiredDossier(
        detailRepository,
        context,
        query.entityId,
        query.at,
        "get-dossier",
      );
      const relationResult = yield* graphRepository.readRelations({
        workspaceId: context.workspaceId,
        entityIds: [query.entityId],
        maximumRelations: 100,
        point: { kind: "current", at: query.at },
        visibility: visibility(context),
      });
      return {
        ...dossier,
        workspaceId: context.workspaceId,
        asOf: query.at,
        revision: revisionValue,
        relations: relationResult.relations,
        safeWarnings: relationResult.truncated
          ? ["Product dossier relations were truncated at the authorized query bound."]
          : [],
      };
    }),
  getProductCoverage: (context, query) =>
    Effect.gen(function* () {
      yield* authorize(authorizer, context, "get-coverage");
      const revisionValue = yield* revision(graphRepository, context, query.at, "get-coverage");
      const maximumItems = query.maximumItems ?? 250;
      const result = yield* detailRepository.readCoverage({
        workspaceId: context.workspaceId,
        at: query.at,
        staleBefore: query.staleBefore,
        maximumItems,
        visibility: visibility(context),
      });
      return {
        workspaceId: context.workspaceId,
        asOf: query.at,
        revision: revisionValue,
        items: result.items,
        page: { maximumItems, truncated: result.truncated },
        safeWarnings: result.truncated
          ? ["Product coverage results were truncated at the authorized query bound."]
          : [],
      };
    }),
  getProductAvailability: (context, query) =>
    Effect.gen(function* () {
      yield* authorize(authorizer, context, "get-availability");
      const revisionValue = yield* revision(graphRepository, context, query.at, "get-availability");
      const dossier = yield* requiredDossier(
        detailRepository,
        context,
        query.entityId,
        query.at,
        "get-availability",
      );
      const resolvedVariant = yield* resolveProductVariant(
        variantModel(dossier, revisionValue),
        query.entityId,
        query.qualifiers,
        query.at,
      );
      return {
        workspaceId: context.workspaceId,
        asOf: query.at,
        revision: revisionValue,
        entityId: query.entityId,
        lifecycle: dossier.entity.lifecycle,
        resolvedVariant,
        availabilityClaims: dossier.claims.filter(({ type }) => type === "availability"),
        availabilityReferences: dossier.externalReferences.filter(
          ({ kind }) => kind === "availability" || kind === "runtime",
        ),
        deliveryStages: [],
        safeWarnings: [
          "Delivery and verification stages are supplied by the existing delivery-intelligence projection.",
        ],
      };
    }),
  getEntityHistory: (context, query) =>
    Effect.gen(function* () {
      yield* authorize(authorizer, context, "get-historical-graph");
      const revisionValue = yield* revision(graphRepository, context, query.at, "get-dossier");
      yield* requiredDossier(detailRepository, context, query.entityId, query.at, "get-dossier");
      const maximumItems = query.maximumItems ?? 100;
      const result = yield* detailRepository.readEntityHistory({
        workspaceId: context.workspaceId,
        entityId: query.entityId,
        maximumItems,
      });
      return {
        workspaceId: context.workspaceId,
        asOf: query.at,
        revision: revisionValue,
        entityId: query.entityId,
        events: result.events.map((event) => ({
          ...event,
          validFrom: new Date(event.validFrom).toISOString(),
          recordedAt: new Date(event.recordedAt).toISOString(),
        })),
        page: { maximumItems, truncated: result.truncated },
        safeWarnings: result.truncated
          ? ["Product entity history was truncated at the authorized query bound."]
          : [],
      };
    }),
});

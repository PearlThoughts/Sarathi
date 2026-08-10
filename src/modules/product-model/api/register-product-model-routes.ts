import { Effect } from "effect";
import type { Context, Hono } from "hono";
import { type RepositoryError, ValidationError } from "../../../domain/errors.ts";
import { runEffect } from "../../../platform/http.ts";
import {
  ProductModelCommandAccessDenied,
  ProductModelCommandApprovalRequired,
  type ProductModelCommandError,
  type ProductModelCommandService,
  ProductModelCommandUnavailable,
} from "../application/product-model-commands.ts";
import type { ProductModelDetailQueryService } from "../application/product-model-detail-queries.ts";
import type { ProductModelQueryService } from "../application/product-model-queries.ts";
import {
  ProductModelAccessDenied,
  ProductModelQueryUnavailable,
} from "../application/product-model-queries.ts";
import {
  ProductModelError,
  type ProductVariantAxis,
  parseProductEntityId,
} from "../domain/product-model.ts";
import { ProductCommandPersistenceError } from "../ports/product-model-command-repository.ts";
import type { ProductModelRequestContext } from "../ports/product-model-query-authorizer.ts";
import { parseProductModelCommand } from "./product-model-command-transport.ts";

export type ProductModelApiContextResolver = {
  readonly resolve: (
    request: Request,
    workspaceId: string,
    surface: "api" | "product-studio",
  ) => Effect.Effect<
    ProductModelRequestContext,
    ProductModelAccessDenied | RepositoryError | ValidationError
  >;
};

export type ProductModelApiDependencies = {
  readonly queries: ProductModelQueryService;
  readonly details: ProductModelDetailQueryService;
  readonly commands?: ProductModelCommandService | undefined;
  readonly context: ProductModelApiContextResolver;
  readonly now: () => string;
};

type ProductModelTransportError =
  | ProductModelAccessDenied
  | ProductModelQueryUnavailable
  | ProductModelError
  | RepositoryError
  | ValidationError;

type ProductModelCommandTransportError =
  | ProductModelAccessDenied
  | ProductModelCommandError
  | ValidationError;

const safeError = (error: ProductModelTransportError) => {
  if (error instanceof ProductModelAccessDenied)
    return { error: { code: "PRODUCT_MODEL_ACCESS_DENIED", message: "Access denied." } };
  if (error instanceof ProductModelQueryUnavailable)
    return {
      error: { code: "PRODUCT_MODEL_NOT_FOUND", message: "Product-model data is unavailable." },
    };
  if (error instanceof ProductModelError)
    return { error: { code: error.code, message: error.message } };
  if (error instanceof ValidationError)
    return { error: { code: "INVALID_REQUEST", message: error.message } };
  return {
    error: {
      code: "PRODUCT_MODEL_UNAVAILABLE",
      message: "The product-model service is unavailable.",
    },
  };
};

const respondError = (context: Context, error: ProductModelTransportError) => {
  const body = safeError(error);
  if (error instanceof ProductModelAccessDenied) return context.json(body, 403);
  if (error instanceof ProductModelQueryUnavailable) return context.json(body, 404);
  if (error instanceof ProductModelError || error instanceof ValidationError)
    return context.json(body, 400);
  return context.json(body, 503);
};

const safeCommandError = (error: ProductModelCommandTransportError) => {
  if (error instanceof ProductModelAccessDenied || error instanceof ProductModelCommandAccessDenied)
    return {
      status: 403 as const,
      code: "PRODUCT_MODEL_COMMAND_ACCESS_DENIED",
      message: "Access denied.",
    };
  if (error instanceof ProductModelCommandUnavailable)
    return {
      status: 404 as const,
      code: "PRODUCT_MODEL_NOT_FOUND",
      message: "Product-model data is unavailable.",
    };
  if (error instanceof ProductModelCommandApprovalRequired)
    return {
      status: 409 as const,
      code: "approval_required",
      message: "Additional approval is required for hidden impacts.",
    };
  if (error instanceof ProductCommandPersistenceError) {
    if (error.code === "transaction_failed")
      return {
        status: 503 as const,
        code: "PRODUCT_MODEL_UNAVAILABLE",
        message: "The product-model service is unavailable.",
      };
    return { status: 409 as const, code: error.code, message: error.message };
  }
  if (error instanceof ProductModelError)
    return {
      status: error.code === "invalid_input" ? (400 as const) : (422 as const),
      code: error.code,
      message: error.message,
    };
  if (error instanceof ValidationError)
    return { status: 400 as const, code: "INVALID_REQUEST", message: error.message };
  return {
    status: 503 as const,
    code: "PRODUCT_MODEL_UNAVAILABLE",
    message: "The product-model service is unavailable.",
  };
};

const respondCommandError = (context: Context, error: ProductModelCommandTransportError) => {
  const safe = safeCommandError(error);
  return context.json({ error: { code: safe.code, message: safe.message } }, safe.status);
};

const unavailable = (context: Context) =>
  context.json(
    {
      error: {
        code: "PRODUCT_MODEL_UNAVAILABLE",
        message: "The product-model service is unavailable.",
      },
    },
    503,
  );

const boundedInteger = (
  value: string | undefined,
  fallback: number,
  maximum: number,
): Effect.Effect<number, ValidationError> => {
  if (value === undefined) return Effect.succeed(fallback);
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum
    ? Effect.succeed(parsed)
    : Effect.fail(
        new ValidationError({
          message: `Query bound must be an integer from 1 to ${maximum}.`,
          field: "query",
        }),
      );
};

const parseInstant = (
  value: string | undefined,
  fallback: string,
  field: string,
): Effect.Effect<string, ValidationError> => {
  const candidate = value ?? fallback;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed)
    ? Effect.succeed(new Date(parsed).toISOString())
    : Effect.fail(
        new ValidationError({
          message: `${field} must be an ISO-8601 instant.`,
          field,
        }),
      );
};

const variantAxes = new Set<ProductVariantAxis>([
  "client",
  "tenant",
  "brand",
  "role",
  "environment",
  "version",
  "build",
  "feature_flag",
]);

const parseQualifiers = (
  values: readonly string[],
): Effect.Effect<Readonly<Partial<Record<ProductVariantAxis, string>>>, ValidationError> =>
  Effect.try({
    try: () => {
      const entries = values.map((value) => {
        const separator = value.indexOf(":");
        const axis = value.slice(0, separator) as ProductVariantAxis;
        const qualifier = value.slice(separator + 1).trim();
        if (separator <= 0 || !variantAxes.has(axis) || qualifier === "")
          throw new Error("invalid qualifier");
        return [axis, qualifier] as const;
      });
      if (new Set(entries.map(([axis]) => axis)).size !== entries.length)
        throw new Error("duplicate qualifier");
      return Object.fromEntries(entries);
    },
    catch: () =>
      new ValidationError({
        message: "Qualifiers must use one unique supported axis:value pair.",
        field: "qualifier",
      }),
  });

const authorizedContext = (
  dependencies: ProductModelApiDependencies,
  context: Context,
  workspaceId: string,
  surface: "api" | "product-studio" = "api",
) =>
  dependencies.context
    .resolve(context.req.raw, workspaceId, surface)
    .pipe(
      Effect.flatMap((resolved) =>
        resolved.workspaceId === workspaceId && resolved.surface === surface
          ? Effect.succeed(resolved)
          : Effect.fail(new ProductModelAccessDenied("Workspace denied.", "get-map")),
      ),
    );

const commandFromRequest = (context: Context) =>
  Effect.tryPromise({
    try: () => context.req.json<unknown>(),
    catch: () =>
      new ValidationError({
        message: "Product command body is invalid.",
        field: "body",
      }),
  }).pipe(Effect.flatMap(parseProductModelCommand));

export const registerProductModelRoutes = (
  app: Hono,
  dependencies?: ProductModelApiDependencies | undefined,
): void => {
  const base = "/v1/workspaces/:workspaceId/product-model";

  const commandRoute = (operation: "preview" | "execute", context: Context) => {
    if (dependencies === undefined || dependencies.commands === undefined)
      return Promise.resolve(unavailable(context));
    const workspaceId = context.req.param("workspaceId") ?? "";
    const commands = dependencies.commands;
    return runEffect(
      Effect.gen(function* () {
        const requestContext = yield* authorizedContext(
          dependencies,
          context,
          workspaceId,
          "product-studio",
        );
        const command = yield* commandFromRequest(context);
        if (operation === "execute" && command.previewToken === undefined)
          return yield* Effect.fail(
            new ValidationError({
              message: "previewToken is required for Product Studio commands.",
              field: "previewToken",
            }),
          );
        return yield* operation === "preview"
          ? commands.preview(requestContext, command)
          : commands.execute(requestContext, command);
      }),
    ).then((result) =>
      result.ok ? context.json({ data: result.value }) : respondCommandError(context, result.error),
    );
  };

  app.post(`${base}/changes/preview`, (context) => commandRoute("preview", context));
  app.post(`${base}/commands`, (context) => commandRoute("execute", context));

  app.get(`${base}/map`, async (context) => {
    if (dependencies === undefined) return unavailable(context);
    const workspaceId = context.req.param("workspaceId");
    const result = await runEffect(
      Effect.gen(function* () {
        const requestContext = yield* authorizedContext(dependencies, context, workspaceId);
        const maximumDepth = yield* boundedInteger(context.req.query("maximumDepth"), 4, 8);
        const maximumNodes = yield* boundedInteger(context.req.query("maximumNodes"), 250, 500);
        const maximumRelations = yield* boundedInteger(
          context.req.query("maximumRelations"),
          250,
          500,
        );
        const at = yield* parseInstant(context.req.query("at"), dependencies.now(), "at");
        return yield* dependencies.queries.getProductMap(requestContext, {
          at,
          maximumDepth,
          maximumNodes,
          maximumRelations,
        });
      }),
    );
    return result.ok ? context.json({ data: result.value }) : respondError(context, result.error);
  });

  app.get(`${base}/history`, async (context) => {
    if (dependencies === undefined) return unavailable(context);
    const workspaceId = context.req.param("workspaceId");
    const result = await runEffect(
      Effect.gen(function* () {
        const requestContext = yield* authorizedContext(dependencies, context, workspaceId);
        const maximumDepth = yield* boundedInteger(context.req.query("maximumDepth"), 4, 8);
        const maximumNodes = yield* boundedInteger(context.req.query("maximumNodes"), 250, 500);
        const maximumRelations = yield* boundedInteger(
          context.req.query("maximumRelations"),
          250,
          500,
        );
        const validAt = context.req.query("validAt");
        if (validAt === undefined)
          return yield* Effect.fail(
            new ValidationError({
              message: "validAt is required.",
              field: "validAt",
            }),
          );
        const parsedValidAt = yield* parseInstant(validAt, validAt, "validAt");
        return yield* dependencies.queries.getProductGraphAtTime(requestContext, {
          validAt: parsedValidAt,
          maximumDepth,
          maximumNodes,
          maximumRelations,
        });
      }),
    );
    return result.ok ? context.json({ data: result.value }) : respondError(context, result.error);
  });

  app.get(`${base}/entities/:entityId`, async (context) => {
    if (dependencies === undefined) return unavailable(context);
    const workspaceId = context.req.param("workspaceId");
    const result = await runEffect(
      Effect.gen(function* () {
        const requestContext = yield* authorizedContext(dependencies, context, workspaceId);
        const entityId = yield* parseProductEntityId(context.req.param("entityId"));
        const at = yield* parseInstant(context.req.query("at"), dependencies.now(), "at");
        return yield* dependencies.details.getFeatureDossier(requestContext, {
          entityId,
          at,
        });
      }),
    );
    return result.ok ? context.json({ data: result.value }) : respondError(context, result.error);
  });

  app.get(`${base}/entities/:entityId/subgraph`, async (context) => {
    if (dependencies === undefined) return unavailable(context);
    const workspaceId = context.req.param("workspaceId");
    const result = await runEffect(
      Effect.gen(function* () {
        const requestContext = yield* authorizedContext(dependencies, context, workspaceId);
        const entityId = yield* parseProductEntityId(context.req.param("entityId"));
        const maximumAncestorDepth = yield* boundedInteger(
          context.req.query("maximumAncestorDepth"),
          4,
          8,
        );
        const maximumDescendantDepth = yield* boundedInteger(
          context.req.query("maximumDescendantDepth"),
          4,
          8,
        );
        const maximumNodesPerDirection = yield* boundedInteger(
          context.req.query("maximumNodesPerDirection"),
          100,
          250,
        );
        const maximumRelations = yield* boundedInteger(
          context.req.query("maximumRelations"),
          250,
          500,
        );
        const at = yield* parseInstant(context.req.query("at"), dependencies.now(), "at");
        return yield* dependencies.queries.getCapabilitySubgraph(requestContext, {
          rootEntityId: entityId,
          at,
          maximumAncestorDepth,
          maximumDescendantDepth,
          maximumNodesPerDirection,
          maximumRelations,
        });
      }),
    );
    return result.ok ? context.json({ data: result.value }) : respondError(context, result.error);
  });

  app.get(`${base}/coverage`, async (context) => {
    if (dependencies === undefined) return unavailable(context);
    const workspaceId = context.req.param("workspaceId");
    const result = await runEffect(
      Effect.gen(function* () {
        const requestContext = yield* authorizedContext(dependencies, context, workspaceId);
        const maximumItems = yield* boundedInteger(context.req.query("maximumItems"), 250, 500);
        const at = yield* parseInstant(context.req.query("at"), dependencies.now(), "at");
        const staleBefore = context.req.query("staleBefore");
        if (staleBefore === undefined)
          return yield* Effect.fail(
            new ValidationError({
              message: "staleBefore is required.",
              field: "staleBefore",
            }),
          );
        const parsedStaleBefore = yield* parseInstant(staleBefore, staleBefore, "staleBefore");
        return yield* dependencies.details.getProductCoverage(requestContext, {
          at,
          staleBefore: parsedStaleBefore,
          maximumItems,
        });
      }),
    );
    return result.ok ? context.json({ data: result.value }) : respondError(context, result.error);
  });

  app.get(`${base}/availability/:entityId`, async (context) => {
    if (dependencies === undefined) return unavailable(context);
    const workspaceId = context.req.param("workspaceId");
    const result = await runEffect(
      Effect.gen(function* () {
        const requestContext = yield* authorizedContext(dependencies, context, workspaceId);
        const entityId = yield* parseProductEntityId(context.req.param("entityId"));
        const qualifiers = yield* parseQualifiers(context.req.queries("qualifier") ?? []);
        const at = yield* parseInstant(context.req.query("at"), dependencies.now(), "at");
        return yield* dependencies.details.getProductAvailability(requestContext, {
          entityId,
          at,
          qualifiers,
        });
      }),
    );
    return result.ok ? context.json({ data: result.value }) : respondError(context, result.error);
  });
};

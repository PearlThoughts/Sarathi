import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import { ValidationError } from "../../domain/errors.ts";
import { stableSha256 } from "../../domain/hash.ts";
import {
  ProductModelAccessDenied,
  type ProductModelApiContextResolver,
  type ProductModelCommandAuthorizer,
  type ProductModelQueryAuthorizer,
  type ProductModelQueryOperation,
  type ProductModelRequestContext,
} from "../../modules/product-model/index.ts";
import type { ProductModelPrincipalConfiguration } from "../../platform/config.ts";

const bearerToken = (request: Request): string | undefined => {
  const authorization = request.headers.get("authorization");
  if (authorization === null) return undefined;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1];
};

const sameSecret = (left: string, right: string): boolean => {
  const leftHash = Buffer.from(stableSha256(left));
  const rightHash = Buffer.from(stableSha256(right));
  return leftHash.length === rightHash.length && timingSafeEqual(leftHash, rightHash);
};

const principalKey = (workspaceId: string, actorId: string) => `${workspaceId}\u0000${actorId}`;

type ProductModelApiSecurity = {
  readonly context: ProductModelApiContextResolver;
  readonly queries: ProductModelQueryAuthorizer;
  readonly commands: ProductModelCommandAuthorizer;
};

export const createProductModelApiSecurity = (
  principals: readonly ProductModelPrincipalConfiguration[],
): ProductModelApiSecurity => {
  const byActor = new Map(
    principals.map((principal) => [
      principalKey(principal.workspaceId, principal.actorId),
      principal,
    ]),
  );
  const denied = (operation: ProductModelQueryOperation) =>
    Effect.fail(new ProductModelAccessDenied("Product-model principal denied.", operation));

  const context: ProductModelApiContextResolver = {
    resolve: (request, workspaceId, surface) => {
      const token = bearerToken(request);
      const principal =
        token === undefined
          ? undefined
          : principals.find(
              (candidate) =>
                candidate.workspaceId === workspaceId &&
                candidate.surfaces.includes(surface) &&
                sameSecret(candidate.accessToken, token),
            );
      if (principal === undefined) return denied("get-map");
      return Effect.succeed({
        organizationId: principal.organizationId,
        workspaceId: principal.workspaceId,
        actorId: principal.actorId,
        trustTier: principal.trustTier,
        effectiveAudience: principal.effectiveAudience,
        maximumSensitivity: principal.maximumSensitivity,
        modelEgress: principal.modelEgress,
        permittedCorpusScopes: principal.permittedCorpusScopes,
        requestId: globalThis.crypto.randomUUID(),
        surface,
      } satisfies ProductModelRequestContext);
    },
  };

  const configuredPrincipal = (requestContext: ProductModelRequestContext) =>
    byActor.get(principalKey(requestContext.workspaceId, requestContext.actorId));

  const queries: ProductModelQueryAuthorizer = {
    authorize: (requestContext, operation) => {
      const principal = configuredPrincipal(requestContext);
      const allowed = principal?.queryOperations.includes(operation) === true;
      return Effect.succeed({
        allowed,
        reason: allowed ? "Configured product-model read permission." : "Read permission denied.",
        policyVersion: principal?.policyVersion ?? "product-model-deny-v1",
      });
    },
  };

  const commands: ProductModelCommandAuthorizer = {
    authorize: (requestContext, request) => {
      const principal = configuredPrincipal(requestContext);
      const allowed = principal?.commandOperations.includes(request.operation) === true;
      if (principal === undefined)
        return Effect.fail(
          new ValidationError({
            message: "Product-model command principal is invalid.",
            field: "authorization",
          }),
        );
      return Effect.succeed({
        allowed,
        reason: allowed
          ? "Configured product-model command permission."
          : "Command permission denied.",
        policyVersion: principal.policyVersion,
        entityScope:
          principal.entityIds === undefined
            ? { kind: "all" as const }
            : { kind: "entities" as const, entityIds: principal.entityIds },
        allowHiddenImpacts: principal.allowHiddenImpacts,
      });
    },
  };

  return { context, queries, commands };
};

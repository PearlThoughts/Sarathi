import type { Effect } from "effect";
import type { RepositoryError, ValidationError } from "../../../domain/errors.ts";
import type { ProductEntityId } from "../domain/product-model.ts";
import type { ProductModelRequestContext } from "./product-model-query-authorizer.ts";

export type ProductModelCommandOperation = "preview-change" | "execute-command";

export type ProductModelCommandAuthorizationDecision = {
  readonly allowed: boolean;
  readonly reason: string;
  readonly policyVersion: string;
  readonly entityScope:
    | { readonly kind: "all" }
    | { readonly kind: "entities"; readonly entityIds: readonly ProductEntityId[] };
  readonly allowHiddenImpacts: boolean;
};

export type ProductModelCommandAuthorizer = {
  readonly authorize: (
    context: ProductModelRequestContext,
    request: {
      readonly operation: ProductModelCommandOperation;
      readonly commandType: string;
      readonly declaredEntityIds: readonly ProductEntityId[];
    },
  ) => Effect.Effect<ProductModelCommandAuthorizationDecision, ValidationError | RepositoryError>;
};

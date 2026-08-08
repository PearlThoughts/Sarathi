import type { Effect } from "effect";
import type { ProductModel, ProductModelError } from "../domain/product-model.ts";

export type ProductModelRepository = {
  readonly save: (model: ProductModel) => Effect.Effect<void, ProductModelError>;
  readonly current: (
    workspaceId: string,
  ) => Effect.Effect<ProductModel | undefined, ProductModelError>;
  readonly atRevision: (
    workspaceId: string,
    revision: number,
  ) => Effect.Effect<ProductModel | undefined, ProductModelError>;
  readonly atValidTime: (
    workspaceId: string,
    validAt: string,
  ) => Effect.Effect<ProductModel | undefined, ProductModelError>;
};

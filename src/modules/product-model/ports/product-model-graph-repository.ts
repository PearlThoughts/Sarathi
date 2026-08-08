import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { SensitivityTier } from "../../../domain/policy.ts";
import type {
  ProductEntityId,
  ProductEntityKind,
  ProductLifecycle,
  ProductModelError,
  ProductRegistration,
} from "../domain/product-model.ts";

export type ProductModelReadPoint =
  | { readonly kind: "current"; readonly at: string }
  | { readonly kind: "revision"; readonly revision: number }
  | { readonly kind: "valid_time"; readonly at: string };

export type ProductModelVisibility = {
  readonly audienceIds: readonly string[];
  readonly maximumSensitivity: SensitivityTier;
};

export type ProductHierarchyTraversal = {
  readonly workspaceId: string;
  readonly rootEntityId?: ProductEntityId | undefined;
  readonly direction: "ancestors" | "descendants";
  readonly maximumDepth: number;
  readonly maximumNodes: number;
  readonly point: ProductModelReadPoint;
  readonly visibility: ProductModelVisibility;
};

export type ProductHierarchyNode = {
  readonly entityId: ProductEntityId;
  readonly parentId?: ProductEntityId | undefined;
  readonly kind: ProductEntityKind;
  readonly canonicalName: string;
  readonly description?: string | undefined;
  readonly registration: ProductRegistration;
  readonly lifecycle: ProductLifecycle;
  readonly sensitivity: SensitivityTier;
  readonly audience: readonly string[];
  readonly revision: number;
  readonly depth: number;
};

export type ProductHierarchyTraversalResult = {
  readonly nodes: readonly ProductHierarchyNode[];
  readonly truncated: boolean;
};

export type ProductModelRevisionRequest = {
  readonly workspaceId: string;
  readonly point: ProductModelReadPoint;
};

export type ProductModelGraphRepository = {
  readonly resolveRevision: (
    request: ProductModelRevisionRequest,
  ) => Effect.Effect<number | undefined, ProductModelError | RepositoryError>;
  readonly traverseHierarchy: (
    request: ProductHierarchyTraversal,
  ) => Effect.Effect<ProductHierarchyTraversalResult, ProductModelError | RepositoryError>;
};

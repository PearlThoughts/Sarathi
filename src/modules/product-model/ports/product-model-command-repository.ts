import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { SensitivityTier } from "../../../domain/policy.ts";
import type { ProductEntityId, ProductModel, ProductModelError } from "../domain/product-model.ts";

export type ProductCommandAuditRecord = {
  readonly id: string;
  readonly workspaceId: string;
  readonly requestId: string;
  readonly actorId: string;
  readonly commandType: string;
  readonly idempotencyKey: string;
  readonly commandHash: string;
  readonly justification: string;
  readonly resultingRevision: number;
  readonly eventId: string;
  readonly impactSummary: Readonly<Record<string, unknown>>;
  readonly sensitivity: SensitivityTier;
  readonly audience: readonly string[];
  readonly recordedAt: string;
};

export type ProductOutboxRecord = {
  readonly id: string;
  readonly workspaceId: string;
  readonly revision: number;
  readonly eventType: string;
  readonly aggregateIds: readonly ProductEntityId[];
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sensitivity: SensitivityTier;
  readonly audience: readonly string[];
  readonly createdAt: string;
};

export type ProductCommandCommit = {
  readonly expectedRevision: number;
  readonly commandHash: string;
  readonly idempotencyKey: string;
  readonly model: ProductModel;
  readonly audit: ProductCommandAuditRecord;
  readonly outbox: ProductOutboxRecord;
  readonly responseEntityIds: readonly ProductEntityId[];
  readonly resolvedProposalId?: string | undefined;
};

export type ProductCommandCommitResult = {
  readonly revision: number;
  readonly eventId: string;
  readonly changedEntityIds: readonly ProductEntityId[];
  readonly replayed: boolean;
};

export type ProductCommandPersistenceErrorCode =
  | "stale_revision"
  | "idempotency_conflict"
  | "transaction_failed";

export class ProductCommandPersistenceError extends Error {
  readonly _tag = "ProductCommandPersistenceError";

  constructor(
    readonly code: ProductCommandPersistenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProductCommandPersistenceError";
  }
}

export type ProductModelCommandRepository = {
  readonly replay: (
    workspaceId: string,
    idempotencyKey: string,
    commandHash: string,
  ) => Effect.Effect<
    ProductCommandCommitResult | undefined,
    ProductCommandPersistenceError | RepositoryError
  >;
  readonly current: (
    workspaceId: string,
  ) => Effect.Effect<ProductModel | undefined, ProductModelError | RepositoryError>;
  readonly commit: (
    change: ProductCommandCommit,
  ) => Effect.Effect<
    ProductCommandCommitResult,
    ProductCommandPersistenceError | ProductModelError | RepositoryError
  >;
};

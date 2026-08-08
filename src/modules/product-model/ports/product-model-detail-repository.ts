import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type { ModelEgressPolicy, SensitivityTier } from "../../../domain/policy.ts";
import type {
  ProductEntity,
  ProductEntityAlias,
  ProductEntityId,
  ProductModelError,
  ProductRegistration,
  ProductVariant,
} from "../domain/product-model.ts";
import type { ProductModelVisibility } from "./product-model-graph-repository.ts";

export type ProductClaimSummary = {
  readonly id: string;
  readonly entityId: ProductEntityId;
  readonly type: "definition" | "invariant" | "exclusion" | "availability" | "behavior";
  readonly predicate: string;
  readonly value: unknown;
  readonly evidenceReferenceCount: number;
  readonly registration: ProductRegistration;
  readonly sourceClass: string;
  readonly sensitivity: SensitivityTier;
  readonly audience: readonly string[];
  readonly validFrom: string;
  readonly validTo?: string | undefined;
  readonly createdRevision: number;
};

export type ProductExternalReferenceSummary = {
  readonly id: string;
  readonly entityId: ProductEntityId;
  readonly kind:
    | "delivery"
    | "intent"
    | "technical"
    | "runtime"
    | "evidence"
    | "policy"
    | "availability";
  readonly sourceClass: string;
  readonly externalId: string;
  readonly canonicalUrl?: string | undefined;
  readonly sensitivity: SensitivityTier;
  readonly audience: readonly string[];
  readonly modelEgress: ModelEgressPolicy;
  readonly validFrom: string;
  readonly validTo?: string | undefined;
  readonly createdRevision: number;
};

export type ProductChangeProposalSummary = {
  readonly id: string;
  readonly commandType: string;
  readonly targetEntityIds: readonly ProductEntityId[];
  readonly expectedRevision: number;
  readonly state: "pending" | "approved" | "rejected" | "expired" | "withdrawn";
  readonly sourceClass: string;
  readonly sensitivity: SensitivityTier;
  readonly audience: readonly string[];
  readonly proposedAt: string;
  readonly expiresAt: string;
};

export type ProductDossierSnapshot = {
  readonly entity: ProductEntity;
  readonly aliases: readonly ProductEntityAlias[];
  readonly variants: readonly ProductVariant[];
  readonly claims: readonly ProductClaimSummary[];
  readonly externalReferences: readonly ProductExternalReferenceSummary[];
  readonly proposals: readonly ProductChangeProposalSummary[];
};

export type ProductCoverageFlag =
  | "stale"
  | "contested"
  | "unmapped"
  | "weakly_evidenced"
  | "unavailable"
  | "variant_ambiguous";

export type ProductCoverageItem = {
  readonly entityId: ProductEntityId;
  readonly canonicalName: string;
  readonly kind: ProductEntity["kind"];
  readonly flags: readonly ProductCoverageFlag[];
  readonly claimCount: number;
  readonly referenceCount: number;
  readonly variantCount: number;
  readonly updatedRevision: number;
};

export type ProductDetailReadRequest = {
  readonly workspaceId: string;
  readonly entityId: ProductEntityId;
  readonly at: string;
  readonly visibility: ProductModelVisibility;
};

export type ProductCoverageReadRequest = {
  readonly workspaceId: string;
  readonly at: string;
  readonly staleBefore: string;
  readonly maximumItems: number;
  readonly visibility: ProductModelVisibility;
};

export type ProductCoverageReadResult = {
  readonly items: readonly ProductCoverageItem[];
  readonly truncated: boolean;
};

export type ProductModelDetailRepository = {
  readonly readDossier: (
    request: ProductDetailReadRequest,
  ) => Effect.Effect<ProductDossierSnapshot | undefined, ProductModelError | RepositoryError>;
  readonly readCoverage: (
    request: ProductCoverageReadRequest,
  ) => Effect.Effect<ProductCoverageReadResult, ProductModelError | RepositoryError>;
};

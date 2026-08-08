import type { Effect } from "effect";
import type { RepositoryError, ValidationError } from "../../../domain/errors.ts";
import type { ModelEgressPolicy, SensitivityTier, TrustTier } from "../../../domain/policy.ts";

export type ProductModelQueryOperation =
  | "get-map"
  | "get-subgraph"
  | "get-dossier"
  | "get-historical-graph"
  | "get-coverage"
  | "get-availability"
  | "list-proposals";

export type ProductModelRequestContext = {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly trustTier: TrustTier;
  readonly effectiveAudience: readonly string[];
  readonly maximumSensitivity: SensitivityTier;
  readonly modelEgress: ModelEgressPolicy;
  readonly permittedCorpusScopes: readonly string[];
  readonly requestId: string;
  readonly surface: "api" | "product-studio" | "teams" | "internal";
};

export type ProductModelQueryAuthorizationDecision = {
  readonly allowed: boolean;
  readonly reason: string;
  readonly policyVersion: string;
};

export type ProductModelQueryAuthorizer = {
  readonly authorize: (
    context: ProductModelRequestContext,
    operation: ProductModelQueryOperation,
  ) => Effect.Effect<ProductModelQueryAuthorizationDecision, ValidationError | RepositoryError>;
};

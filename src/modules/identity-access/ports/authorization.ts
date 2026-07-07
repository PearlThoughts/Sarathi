import type { Effect } from "effect";
import type { RepositoryError, ValidationError } from "../../../domain/errors.ts";
import type { SensitivityTier, TrustTier } from "../../../domain/policy.ts";

export type AuthorizationAction = "read-context" | "invoke-tool" | "egress-model" | "approve";

export type AuthorizationObjectType =
  | "organization"
  | "operating-team"
  | "source-thread"
  | "repository"
  | "issue"
  | "policy-boundary";

export type AuthorizationObject = {
  readonly type: AuthorizationObjectType;
  readonly id: string;
  readonly sensitivity: SensitivityTier;
};

export type AuthorizationCheck = {
  readonly principalId: string;
  readonly principalTrustTier: TrustTier;
  readonly action: AuthorizationAction;
  readonly object: AuthorizationObject;
};

export type AuthorizationDecision = {
  readonly allowed: boolean;
  readonly reason: string;
};

export type AuthorizationError = ValidationError | RepositoryError;

export type AuthorizationService = {
  readonly provider: "sarathi-policy";
  readonly check: (
    input: AuthorizationCheck,
  ) => Effect.Effect<AuthorizationDecision, AuthorizationError>;
};

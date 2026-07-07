import type { Effect, Option } from "effect";
import type { RepositoryError, ValidationError } from "../../../domain/errors.ts";

export type PrincipalRole =
  | "owner"
  | "admin"
  | "maintainer"
  | "trusted_member"
  | "member"
  | "viewer"
  | "agent";

export type Principal = {
  readonly id: string;
  readonly roles: readonly PrincipalRole[];
  readonly organizationIds: readonly string[];
  readonly teamIds: readonly string[];
};

export type AuthSession = {
  readonly token: string;
  readonly principal: Principal;
  readonly issuedAt: string;
  readonly expiresAt: string;
};

export type AuthError = ValidationError | RepositoryError;

export type AuthService = {
  readonly provider: "better-auth";
  readonly verifySession: (token: string) => Effect.Effect<Option.Option<AuthSession>, AuthError>;
};

import type { Effect, Option } from "effect";
import type { RepositoryError, ValidationError } from "../../../domain/errors.ts";
import type { Principal } from "./auth.ts";

export type ExternalPrincipal = {
  readonly issuer: "microsoft-entra" | "bot-framework" | "manual";
  readonly subject: string;
  readonly displayName?: string | undefined;
};

export type ExternalPrincipalMappingError = ValidationError | RepositoryError;

export type ExternalPrincipalMapper = {
  readonly provider: "external-principal-mapper";
  readonly mapPrincipal: (
    principal: ExternalPrincipal,
  ) => Effect.Effect<Option.Option<Principal>, ExternalPrincipalMappingError>;
};

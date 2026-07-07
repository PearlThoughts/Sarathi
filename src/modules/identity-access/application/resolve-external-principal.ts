import { Effect, Option } from "effect";
import { ValidationError } from "../../../domain/errors.ts";
import type { Principal } from "../ports/auth.ts";
import type {
  ExternalPrincipal,
  ExternalPrincipalMapper,
  ExternalPrincipalMappingError,
} from "../ports/external-principal.ts";

export const resolveExternalPrincipal = (
  mapper: ExternalPrincipalMapper,
  externalPrincipal: ExternalPrincipal,
): Effect.Effect<Principal, ExternalPrincipalMappingError> =>
  Effect.gen(function* () {
    const principal = yield* mapper.mapPrincipal(externalPrincipal);

    if (Option.isNone(principal)) {
      return yield* Effect.fail(
        new ValidationError({
          field: "externalPrincipal",
          message: "external principal is not mapped to a Sarathi principal",
        }),
      );
    }

    return principal.value;
  });

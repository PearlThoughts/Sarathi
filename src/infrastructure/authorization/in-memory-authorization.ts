import { Effect } from "effect";
import { defaultBoundaryForSensitivity } from "../../domain/policy.ts";
import { evaluateBoundaryAccess } from "../../modules/boundary-policy/index.ts";
import type {
  AuthorizationCheck,
  AuthorizationDecision,
  AuthorizationService,
} from "../../modules/identity-access/index.ts";

const decide = (input: AuthorizationCheck): AuthorizationDecision => {
  const decision = evaluateBoundaryAccess({
    subject: {
      principalId: input.principalId,
      trustTier: input.principalTrustTier,
    },
    action: input.action,
    target: {
      type: input.object.type,
      id: input.object.id,
      boundary: defaultBoundaryForSensitivity(input.object.sensitivity),
    },
  });

  return {
    allowed: decision.allowed,
    reason: decision.reason,
  };
};

export const makeInMemoryAuthorizationService = (): AuthorizationService => ({
  provider: "sarathi-policy",
  check: (input) => Effect.sync(() => decide(input)),
});

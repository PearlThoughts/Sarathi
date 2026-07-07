import { Effect, Option } from "effect";
import type { AuthService } from "../../modules/identity-access/index.ts";

export const makeStaticAuthService = (): AuthService => ({
  provider: "better-auth",
  verifySession: () => Effect.succeed(Option.none()),
});

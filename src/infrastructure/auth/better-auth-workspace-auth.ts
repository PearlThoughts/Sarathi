import { betterAuth } from "better-auth";
import { bearer, organization } from "better-auth/plugins";
import { Effect, Option } from "effect";
import { PostgresDialect } from "kysely";
import { Pool } from "pg";
import { RepositoryError } from "../../domain/errors.ts";
import type { AuthService, AuthSession, Principal } from "../../modules/identity-access/index.ts";

type BetterAuthWorkspaceConfig = {
  readonly databaseUrl: string;
  readonly baseUrl: string;
  readonly secret: string;
};

const principalForUser = (userId: string, organizationId: string | undefined): Principal => ({
  id: userId,
  roles: ["member"],
  organizationIds: organizationId === undefined ? [] : [organizationId],
  teamIds: [],
});

export const makeBetterAuthWorkspaceAuth = (config: BetterAuthWorkspaceConfig): AuthService => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const auth = betterAuth({
    database: new PostgresDialect({ pool }),
    baseURL: config.baseUrl,
    secret: config.secret,
    plugins: [
      bearer(),
      organization({
        teams: {
          enabled: true,
          allowRemovingAllTeams: false,
        },
      }),
    ],
  });

  return {
    provider: "better-auth",
    verifySession: (token) =>
      Effect.tryPromise({
        try: async () => {
          const result = await auth.api.getSession({
            headers: new Headers({ authorization: `Bearer ${token}` }),
          });

          if (result === null) {
            return Option.none<AuthSession>();
          }

          const session: AuthSession = {
            token: result.session.token,
            principal: principalForUser(
              result.user.id,
              result.session.activeOrganizationId ?? undefined,
            ),
            issuedAt: result.session.createdAt.toISOString(),
            expiresAt: result.session.expiresAt.toISOString(),
          };

          return Option.some(session);
        },
        catch: (error) =>
          new RepositoryError({
            operation: "auth.verifySession",
            message: error instanceof Error ? error.message : "Unknown Better Auth error",
          }),
      }),
  };
};

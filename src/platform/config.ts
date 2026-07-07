import { Effect } from "effect";

export type PlatformEnvironment = "local" | "test" | "production";

export type SarathiConfig = {
  readonly serviceName: "sarathi";
  readonly environment: PlatformEnvironment;
  readonly http: {
    readonly port: number;
  };
  readonly overlayPath: string;
  readonly auth:
    | {
        readonly provider: "better-auth-postgres";
        readonly databaseUrl: string;
        readonly baseUrl: string;
        readonly secret: string;
      }
    | {
        readonly provider: "static";
      };
};

const environmentFrom = (value: string | undefined): PlatformEnvironment => {
  if (value === "production" || value === "test") {
    return value;
  }

  return "local";
};

const authModeFrom = (value: string | undefined): "static" | "better-auth-postgres" | undefined => {
  if (value === "static" || value === "better-auth-postgres") {
    return value;
  }

  return undefined;
};

export const loadPlatformConfig = (): Effect.Effect<SarathiConfig> =>
  Effect.sync(() => {
    const environment = environmentFrom(Bun.env.SARATHI_ENVIRONMENT ?? Bun.env.NODE_ENV);
    const authMode = authModeFrom(Bun.env.SARATHI_AUTH_MODE);
    const databaseUrl = Bun.env.SARATHI_AUTH_DATABASE_URL;
    const secret = Bun.env.SARATHI_AUTH_SECRET;
    const baseUrl = Bun.env.SARATHI_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const auth =
      authMode === "better-auth-postgres" ||
      (authMode === undefined && databaseUrl !== undefined && secret !== undefined)
        ? {
            provider: "better-auth-postgres" as const,
            databaseUrl: databaseUrl ?? "",
            baseUrl,
            secret: secret ?? "",
          }
        : { provider: "static" as const };

    if (
      auth.provider === "better-auth-postgres" &&
      (auth.databaseUrl === "" || auth.secret === "")
    ) {
      throw new Error(
        "SARATHI_AUTH_MODE=better-auth-postgres requires SARATHI_AUTH_DATABASE_URL and SARATHI_AUTH_SECRET",
      );
    }

    if (environment === "production" && auth.provider === "static") {
      throw new Error("Production Sarathi requires SARATHI_AUTH_MODE=better-auth-postgres");
    }

    return {
      serviceName: "sarathi",
      environment,
      http: {
        port: Number.parseInt(Bun.env.PORT ?? "3000", 10),
      },
      overlayPath: Bun.env.SARATHI_WORKSPACE_OVERLAY_PATH ?? "config/workspace.overlay.yaml",
      auth,
    };
  });

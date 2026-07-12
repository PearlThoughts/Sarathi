type StrictHostRoutingConfiguration = {
  readonly apiHost: string;
  readonly appHost: string;
  readonly railwayOriginHost: string;
  readonly legacyApiHost?: string;
};

type HostSurface = "api" | "app" | "railway-health" | "legacy-api" | "denied";

const normalizedHost = (host: string): string => host.trim().toLowerCase().split(":", 1)[0] ?? "";

const isApiPath = (path: string): boolean =>
  path === "/api/messages" ||
  path === "/health" ||
  path === "/ready" ||
  path.startsWith("/internal/");

const isRailwayHealthPath = (path: string): boolean => path === "/health" || path === "/ready";

const isAppPath = (path: string): boolean =>
  path === "/" ||
  path.startsWith("/api/auth/") ||
  path.startsWith("/oauth/") ||
  path.startsWith("/session/");

export const classifyHostSurface = (
  host: string,
  path: string,
  configuration: StrictHostRoutingConfiguration,
): HostSurface => {
  const normalized = normalizedHost(host);
  if (normalized === normalizedHost(configuration.apiHost))
    return isApiPath(path) ? "api" : "denied";
  if (normalized === normalizedHost(configuration.appHost))
    return isAppPath(path) ? "app" : "denied";
  if (normalized === normalizedHost(configuration.railwayOriginHost)) {
    return isRailwayHealthPath(path) ? "railway-health" : "denied";
  }
  if (
    configuration.legacyApiHost !== undefined &&
    normalized === normalizedHost(configuration.legacyApiHost)
  ) {
    return isApiPath(path) ? "legacy-api" : "denied";
  }
  return "denied";
};

export const strictHostRoutingConfigurationFromEnvironment = (
  environment: Record<string, string | undefined> = process.env,
): StrictHostRoutingConfiguration | undefined => {
  if (environment.SARATHI_STRICT_HOSTS_ENABLED?.trim().toLowerCase() !== "true") return undefined;
  const requiredHost = (name: string): string => {
    const value = environment[name]?.trim();
    if (value === undefined || value === "")
      throw new Error(`${name} is required for strict host routing.`);
    return value;
  };
  const legacyApiHost = environment.SARATHI_LEGACY_API_HOST?.trim();
  return {
    apiHost: requiredHost("SARATHI_API_HOST"),
    appHost: requiredHost("SARATHI_APP_HOST"),
    railwayOriginHost: requiredHost("SARATHI_RAILWAY_ORIGIN_HOST"),
    ...(legacyApiHost === undefined || legacyApiHost === "" ? {} : { legacyApiHost }),
  };
};

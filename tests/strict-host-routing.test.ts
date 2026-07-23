import { describe, expect, it } from "vitest";
import {
  classifyHostSurface,
  strictHostRoutingConfigurationFromEnvironment,
} from "../src/teams-ingress/host-routing.ts";

const configuration = {
  apiHost: "api.sarathi.example.test",
  appHost: "app.sarathi.example.test",
  railwayOriginHost: "sarathi-production.example.test",
  legacyApiHost: "sarathi.example.test",
} as const;

describe("strict host routing", () => {
  it("allows Bot ingress and machine operations only on the API surface", () => {
    expect(classifyHostSurface(configuration.apiHost, "/api/messages", configuration)).toBe("api");
    expect(
      classifyHostSurface(configuration.apiHost, "/api/teams/notifications", configuration),
    ).toBe("api");
    expect(
      classifyHostSurface(
        configuration.apiHost,
        "/internal/finance/reminders/dry-run",
        configuration,
      ),
    ).toBe("api");
    expect(
      classifyHostSurface(
        configuration.apiHost,
        "/internal/finance/reminders/shadow-acceptance",
        configuration,
      ),
    ).toBe("api");
    expect(classifyHostSurface(configuration.apiHost, "/oauth/callback", configuration)).toBe(
      "denied",
    );
  });

  it("allows browser and session paths only on the app surface", () => {
    expect(classifyHostSurface(configuration.appHost, "/oauth/callback", configuration)).toBe(
      "app",
    );
    expect(classifyHostSurface(configuration.appHost, "/api/messages", configuration)).toBe(
      "denied",
    );
    expect(
      classifyHostSurface(
        configuration.appHost,
        "/internal/finance/reminders/dry-run",
        configuration,
      ),
    ).toBe("denied");
  });

  it("keeps the Railway origin limited to platform health checks", () => {
    expect(classifyHostSurface(configuration.railwayOriginHost, "/health", configuration)).toBe(
      "railway-health",
    );
    expect(
      classifyHostSurface(configuration.railwayOriginHost, "/api/messages", configuration),
    ).toBe("denied");
  });

  it("allows Railway deployment probes only on documented health paths", () => {
    expect(classifyHostSurface("healthcheck.railway.app", "/health", configuration)).toBe(
      "railway-health",
    );
    expect(classifyHostSurface("healthcheck.railway.app", "/ready", configuration)).toBe(
      "railway-health",
    );
    expect(classifyHostSurface("healthcheck.railway.app", "/api/messages", configuration)).toBe(
      "denied",
    );
  });

  it("retains the legacy host only as a temporary API migration surface", () => {
    expect(classifyHostSurface(configuration.legacyApiHost, "/api/messages", configuration)).toBe(
      "legacy-api",
    );
    expect(
      classifyHostSurface(configuration.legacyApiHost, "/session/current", configuration),
    ).toBe("denied");
  });

  it("fails closed for unknown or cross-surface hosts", () => {
    expect(classifyHostSurface("attacker.example.test", "/api/messages", configuration)).toBe(
      "denied",
    );
    expect(classifyHostSurface("attacker.example.test", "/health", configuration)).toBe("denied");
    expect(classifyHostSurface(configuration.apiHost, "/", configuration)).toBe("denied");
    expect(classifyHostSurface(configuration.appHost, "/ready", configuration)).toBe("denied");
  });

  it("is disabled by default and requires a complete explicit configuration", () => {
    expect(strictHostRoutingConfigurationFromEnvironment({})).toBeUndefined();
    expect(() =>
      strictHostRoutingConfigurationFromEnvironment({ SARATHI_STRICT_HOSTS_ENABLED: "true" }),
    ).toThrow("SARATHI_API_HOST is required");
    expect(
      strictHostRoutingConfigurationFromEnvironment({
        SARATHI_STRICT_HOSTS_ENABLED: "true",
        SARATHI_API_HOST: configuration.apiHost,
        SARATHI_APP_HOST: configuration.appHost,
        SARATHI_RAILWAY_ORIGIN_HOST: configuration.railwayOriginHost,
      }),
    ).toEqual({
      apiHost: configuration.apiHost,
      appHost: configuration.appHost,
      railwayOriginHost: configuration.railwayOriginHost,
    });
  });
});

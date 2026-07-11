import { describe, expect, it } from "vitest";
import { teamsIngressConfigurationFromEnvironment } from "../src/teams-ingress/node-server.ts";

describe("Teams ingress configuration", () => {
  it("fails closed when bot credentials are incomplete", () => {
    expect(() => teamsIngressConfigurationFromEnvironment({ MICROSOFT_APP_ID: "app" })).toThrow(
      "MICROSOFT_APP_PASSWORD is required",
    );
  });

  it("accepts a complete bot configuration without exposing it", () => {
    expect(
      teamsIngressConfigurationFromEnvironment({
        MICROSOFT_APP_ID: "app",
        MICROSOFT_APP_PASSWORD: "secret",
        MICROSOFT_APP_TENANT_ID: "tenant",
      }),
    ).toEqual({ appId: "app", appPassword: "secret", tenantId: "tenant" });
  });
});

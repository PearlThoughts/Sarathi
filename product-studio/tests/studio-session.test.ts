import { type Collection, generatePayloadCookie } from "payload";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REMEMBERED_SESSION_SECONDS,
  sessionLifetimeSeconds,
  withStudioSessionLifetime,
} from "../src/domain/studio-session";

const collectionWithLifetime = (tokenExpiration: number): Collection =>
  ({
    config: {
      auth: {
        cookies: { sameSite: "Lax", secure: true },
        tokenExpiration,
      },
    },
  }) as Collection;

afterEach(() => vi.useRealTimers());

describe("Product Studio session lifetime", () => {
  it("retains the configured lifetime unless Remember me is explicitly true", () => {
    expect(sessionLifetimeSeconds(7_200, false)).toBe(7_200);
    expect(sessionLifetimeSeconds(7_200, undefined)).toBe(7_200);
    expect(sessionLifetimeSeconds(7_200, "true")).toBe(7_200);
    expect(sessionLifetimeSeconds(7_200, true)).toBe(REMEMBERED_SESSION_SECONDS);
  });

  it("creates a request-scoped auth configuration without mutating Payload config", () => {
    const configured = collectionWithLifetime(7_200);
    const remembered = withStudioSessionLifetime(configured, true);

    expect(remembered).not.toBe(configured);
    expect(remembered.config).not.toBe(configured.config);
    expect(remembered.config.auth).not.toBe(configured.config.auth);
    expect(configured.config.auth.tokenExpiration).toBe(7_200);
    expect(remembered.config.auth.tokenExpiration).toBe(REMEMBERED_SESSION_SECONDS);
  });

  it("produces Payload's secure HttpOnly cookie with a 365-day expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T06:30:00.000Z"));
    const remembered = withStudioSessionLifetime(collectionWithLifetime(7_200), true);

    const cookie = generatePayloadCookie({
      collectionAuthConfig: remembered.config.auth,
      cookiePrefix: "sarathi-product-studio",
      returnCookieAsObject: true,
      token: "test-token",
    });

    expect(cookie).toMatchObject({
      httpOnly: true,
      name: "sarathi-product-studio-token",
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: "test-token",
    });
    expect(cookie.expires).toBe("Fri, 13 Aug 2027 06:30:00 GMT");
  });
});

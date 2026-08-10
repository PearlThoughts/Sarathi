import { describe, expect, it } from "vitest";
import { GET } from "../src/app/health/route";

describe("Product Studio health route", () => {
  it("returns a privacy-safe liveness response", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "sarathi-product-studio",
      status: "ok",
    });
    expect([...response.headers]).not.toContainEqual(expect.arrayContaining(["authorization"]));
  });
});

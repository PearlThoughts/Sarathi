import { describe, expect, it } from "vitest";
import { classifyKnowledgeReconcileFailure } from "../src/infrastructure/postgres/knowledge-repository.ts";

describe("knowledge reconcile failure classification", () => {
  it("maps a nested known constraint without exposing database details", () => {
    const failure = {
      message: "query contains private evidence",
      cause: {
        code: "23505",
        constraint_name: "delivery_claim_source_value",
        detail: "private row values",
      },
    };

    const operation = classifyKnowledgeReconcileFailure(failure);

    expect(operation).toBe("knowledge-reconcile.claim-duplicate");
    expect(operation).not.toContain("private");
  });

  it("falls back to an allowlisted PostgreSQL failure class", () => {
    expect(classifyKnowledgeReconcileFailure({ cause: { code: "23503" } })).toBe(
      "knowledge-reconcile.foreign-key",
    );
  });

  it("does not reflect unknown error metadata", () => {
    const secret = "provider-secret-and-private-body";
    expect(
      classifyKnowledgeReconcileFailure({
        code: secret,
        constraint_name: secret,
        message: secret,
      }),
    ).toBe("knowledge-reconcile");
  });
});

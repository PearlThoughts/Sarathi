import { describe, expect, it } from "vitest";
import {
  boundedPostgresBindBatches,
  classifyKnowledgeReconcileFailure,
} from "../src/infrastructure/postgres/knowledge-repository.ts";

describe("knowledge reconcile failure classification", () => {
  it("partitions protocol-limit-sized mutation inputs into bounded batches", () => {
    const values = Array.from({ length: 65_537 }, (_, index) => index);
    const batches = boundedPostgresBindBatches(values);

    expect(batches).toHaveLength(66);
    expect(batches.every((batch) => batch.length > 0 && batch.length <= 1_000)).toBe(true);
    expect(batches.reduce((total, batch) => total + batch.length, 0)).toBe(values.length);
    expect(batches[0]?.[0]).toBe(0);
    expect(batches.at(-1)?.at(-1)).toBe(65_536);
  });

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
    expect(classifyKnowledgeReconcileFailure({ cause: { code: "54000" } })).toBe(
      "knowledge-reconcile.program-limit",
    );
    expect(classifyKnowledgeReconcileFailure({ cause: { code: "57014" } })).toBe(
      "knowledge-reconcile.query-cancelled",
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

  it("returns only an allowlisted reconcile stage", () => {
    expect(
      classifyKnowledgeReconcileFailure({
        reconcileStage: "delivery",
        cause: { message: "private delivery row" },
      }),
    ).toBe("knowledge-reconcile.delivery-stage");
    expect(
      classifyKnowledgeReconcileFailure({
        reconcileStage: "private-stage-name",
        message: "private body",
      }),
    ).toBe("knowledge-reconcile");
  });

  it("returns the deepest allowlisted delivery substage", () => {
    expect(
      classifyKnowledgeReconcileFailure({
        reconcileStage: "delivery",
        cause: {
          reconcileStage: "deliveryObservations",
          cause: { message: "private observation body" },
        },
      }),
    ).toBe("knowledge-reconcile.delivery-observations-stage");
    expect(
      classifyKnowledgeReconcileFailure({
        reconcileStage: "deliveryDeactivate",
        cause: {
          reconcileStage: "deliveryDeactivateAcl",
          cause: { message: "private ACL row" },
        },
      }),
    ).toBe("knowledge-reconcile.delivery-deactivate-acl-stage");
  });
});

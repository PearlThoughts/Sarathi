import { describe, expect, it } from "vitest";
import {
  boundedPostgresBindBatches,
  classifyKnowledgeReconcileFailure,
  collectReusableVectorsCacheFirst,
  queryPostgresBindBatches,
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

  it("executes bind batches sequentially and preserves result order", async () => {
    const activeBatches = new Set<number>();
    const observedBatchSizes: number[] = [];
    let maximumConcurrency = 0;
    const values = Array.from({ length: 2_501 }, (_, index) => index);

    const results = await queryPostgresBindBatches(values, async (batch) => {
      const identity = batch[0] ?? -1;
      activeBatches.add(identity);
      maximumConcurrency = Math.max(maximumConcurrency, activeBatches.size);
      observedBatchSizes.push(batch.length);
      await Promise.resolve();
      activeBatches.delete(identity);
      return batch.map((value) => `result-${value}`);
    });

    expect(observedBatchSizes).toEqual([1_000, 1_000, 501]);
    expect(maximumConcurrency).toBe(1);
    expect(results).toHaveLength(values.length);
    expect(results[0]).toBe("result-0");
    expect(results.at(-1)).toBe("result-2500");
  });

  it("streams complete cached vectors without querying projection history", async () => {
    const cacheBatchSizes: number[] = [];
    let projectionQueries = 0;
    const contentHashes = Array.from({ length: 1_001 }, (_, index) => `hash-${index}`);

    const vectors = await collectReusableVectorsCacheFirst(
      contentHashes,
      2,
      async (batch) => {
        cacheBatchSizes.push(batch.length);
        return batch.map((contentHash) => ({ contentHash, embedding: [1, 2] }));
      },
      async () => {
        projectionQueries += 1;
        return [];
      },
    );

    expect(cacheBatchSizes).toEqual([1_000, 1]);
    expect(projectionQueries).toBe(0);
    expect(vectors.size).toBe(contentHashes.length);
  });

  it("queries projection history only for hashes missing from a partial cache", async () => {
    const projectionBatches: string[][] = [];

    const vectors = await collectReusableVectorsCacheFirst(
      ["cached", "invalid-cache-entry", "projection-only", "cached"],
      2,
      async () => [
        { contentHash: "cached", embedding: [1, 1] },
        { contentHash: "invalid-cache-entry", embedding: [1] },
      ],
      async (batch) => {
        projectionBatches.push([...batch]);
        return batch.map((contentHash) => ({ contentHash, embedding: [2, 2] }));
      },
    );

    expect(projectionBatches).toEqual([["invalid-cache-entry", "projection-only"]]);
    expect(vectors.get("cached")).toEqual([1, 1]);
    expect(vectors.get("invalid-cache-entry")).toEqual([2, 2]);
    expect(vectors.get("projection-only")).toEqual([2, 2]);
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

import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { KnowledgePostgresDatabase } from "../src/infrastructure/postgres/knowledge-migrations.ts";
import { executePostgresKnowledgeSearch } from "../src/infrastructure/postgres/knowledge-repository.ts";
import {
  createInMemoryDeliveryExecutionObserver,
  startDeliveryExecution,
} from "../src/modules/delivery-execution-observability/index.ts";

describe("controlled PostgreSQL knowledge search", () => {
  it("cancels the active backend and releases the client when the report signal aborts", async () => {
    const observer = createInMemoryDeliveryExecutionObserver();
    const controller = new AbortController();
    const execution = startDeliveryExecution({
      observer,
      deadlineEpochMs: Date.now() + 10_000,
      signal: controller.signal,
    });
    let rejectActiveQuery: ((failure: Error) => void) | undefined;
    const activeQuery = new Promise<never>((_resolve, reject) => {
      rejectActiveQuery = reject;
    });
    const release = vi.fn();
    const client = {
      processID: 42,
      query: vi.fn(() => activeQuery),
      release,
    };
    const cancelQuery = vi.fn((_statement: string, _parameters: readonly unknown[]) => {
      rejectActiveQuery?.(new Error("cancelled"));
      return Promise.resolve({ rows: [] });
    });
    const database = {
      $client: {
        connect: vi.fn(() => Promise.resolve(client)),
        query: cancelQuery,
      },
    } as unknown as KnowledgePostgresDatabase;

    const pending = executePostgresKnowledgeSearch(
      database,
      sql`select 1`,
      "knowledge.vector",
      execution,
      controller.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.query).toHaveBeenCalledOnce();
    controller.abort("test-deadline");

    await expect(pending).rejects.toThrow("cancelled");
    expect(cancelQuery).toHaveBeenCalledWith("select pg_cancel_backend($1)", [42]);
    expect(release).toHaveBeenCalledOnce();
    expect(observer.spans.find(({ span }) => span.stage === "database.query")).toMatchObject({
      outcome: "cancelled",
      attributes: { "cancellation.state": "acknowledged" },
    });
  });
});

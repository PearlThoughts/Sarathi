import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { RepositoryError } from "../src/domain/errors.ts";
import {
  type KnowledgeEmbeddingPort,
  type KnowledgeRepository,
  type KnowledgeSourceReader,
  readSynchronizationSourceStatus,
  type SynchronizationControlRepository,
  type SynchronizationEventDelivery,
  type SynchronizationRun,
  type SynchronizationStatus,
  synchronizeKnowledgeSource,
} from "../src/modules/knowledge-layer/index.ts";

const snapshot = {
  sourceId: "jira-example",
  source: "jira" as const,
  workspaceId: "example",
  cursor: "cursor-after",
  scopeHash: "sha256-scope-after",
  documents: [],
};

const embeddings: KnowledgeEmbeddingPort = {
  model: "test",
  dimensions: 1,
  embed: () => Effect.succeed([]),
};

const repository: KnowledgeRepository = {
  reconcile: () =>
    Effect.succeed({
      sourceId: "jira-example",
      workspaceId: "example",
      cursor: "cursor-after",
      scopeHash: "sha256-scope-after",
      documentsObserved: 0,
      versionsCreated: 0,
      passagesActive: 0,
      itemsDeleted: 0,
      checksum: "sha256-summary",
    }),
  search: () => Effect.succeed([]),
  searchLexical: () => Effect.succeed([]),
};

const source = (readSnapshot = vi.fn(() => Effect.succeed(snapshot))) => ({
  sourceId: "jira-example",
  source: "jira" as const,
  reader: { readSnapshot } satisfies KnowledgeSourceReader,
});

const controlRepository = (overrides: Partial<SynchronizationControlRepository> = {}) => {
  const runs: SynchronizationRun[] = [];
  const events: SynchronizationEventDelivery[] = [];
  const status: SynchronizationStatus = {
    checkpoint: {
      workspaceId: "example",
      sourceId: "jira-example",
      cursor: "cursor-before",
      scopeHash: "sha256-scope-before",
      newestSourceUpdatedAt: "2026-07-22T10:00:00.000Z",
      lastSucceededAt: "2026-07-22T10:30:00.000Z",
      retryCount: 0,
    },
  };
  const control: SynchronizationControlRepository = {
    registerEvent: (delivery) => Effect.succeed({ disposition: "accepted" as const, delivery }),
    saveSubscription: () => Effect.void,
    acquireLease: () => Effect.succeed(true),
    heartbeatLease: () => Effect.succeed(true),
    releaseLease: () => Effect.void,
    startRun: (run) => Effect.sync(() => runs.push(run)).pipe(Effect.asVoid),
    completeRun: (run) => Effect.sync(() => runs.push(run)).pipe(Effect.asVoid),
    updateEvent: (event) => Effect.sync(() => events.push(event)).pipe(Effect.asVoid),
    readStatus: () => Effect.succeed(status),
    ...overrides,
  };
  return { control, events, runs, status };
};

const times = (...values: readonly string[]) => {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? "2026-07-22T11:00:00.000Z";
};

describe("knowledge synchronization service", () => {
  it("uses the checkpoint for hourly repair and records a privacy-safe terminal run", async () => {
    const readSnapshot = vi.fn(() => Effect.succeed(snapshot));
    const acquired: string[] = [];
    const { control, runs } = controlRepository({
      acquireLease: (lease) =>
        Effect.sync(() => acquired.push(lease.operation)).pipe(Effect.as(true)),
    });
    const outcome = await Effect.runPromise(
      synchronizeKnowledgeSource(
        {
          workspaceId: "example",
          source: source(readSnapshot),
          trigger: "hourly-reconciliation",
          ownerId: "worker-1",
          leaseSeconds: 300,
          now: times("2026-07-22T11:00:00.000Z", "2026-07-22T11:00:30.000Z"),
        },
        repository,
        embeddings,
        control,
      ),
    );

    expect(readSnapshot).toHaveBeenCalledWith("example", "cursor-before");
    expect(acquired).toEqual(["source-synchronization"]);
    expect(outcome).toMatchObject({ disposition: "succeeded", summary: { documentsObserved: 0 } });
    expect(runs).toEqual([
      expect.objectContaining({ status: "running", cursorBefore: "cursor-before" }),
      expect.objectContaining({
        status: "succeeded",
        cursorAfter: "cursor-after",
        lagSeconds: 3_630,
      }),
    ]);
    expect(JSON.stringify(runs)).not.toContain("source body");
  });

  it("starts a historical backfill without a prior cursor", async () => {
    const readSnapshot = vi.fn(() => Effect.succeed(snapshot));
    const { control } = controlRepository();
    await Effect.runPromise(
      synchronizeKnowledgeSource(
        {
          workspaceId: "example",
          source: source(readSnapshot),
          trigger: "historical-backfill",
          ownerId: "worker-1",
          leaseSeconds: 300,
          now: times("2026-07-22T11:00:00.000Z", "2026-07-22T11:00:30.000Z"),
        },
        repository,
        embeddings,
        control,
      ),
    );
    expect(readSnapshot).toHaveBeenCalledWith("example", undefined);
  });

  it("does not fetch an already completed provider event or a lease-contended source", async () => {
    const readSnapshot = vi.fn(() => Effect.succeed(snapshot));
    const event: SynchronizationEventDelivery = {
      id: "event-1",
      workspaceId: "example",
      sourceId: "jira-example",
      source: "jira",
      providerEventId: "provider-1",
      payloadHash: "sha256-payload",
      receivedAt: "2026-07-22T11:00:00.000Z",
      status: "received",
      attemptCount: 0,
    };
    const duplicate = controlRepository({
      registerEvent: () =>
        Effect.succeed({
          disposition: "duplicate",
          delivery: { ...event, status: "succeeded" },
        }),
    });
    await expect(
      Effect.runPromise(
        synchronizeKnowledgeSource(
          {
            workspaceId: "example",
            source: source(readSnapshot),
            trigger: "source-event",
            ownerId: "worker-1",
            leaseSeconds: 300,
            now: times("2026-07-22T11:00:00.000Z"),
            event,
          },
          repository,
          embeddings,
          duplicate.control,
        ),
      ),
    ).resolves.toMatchObject({ disposition: "duplicate" });
    const contended = controlRepository({ acquireLease: () => Effect.succeed(false) });
    await expect(
      Effect.runPromise(
        synchronizeKnowledgeSource(
          {
            workspaceId: "example",
            source: source(readSnapshot),
            trigger: "hourly-reconciliation",
            ownerId: "worker-2",
            leaseSeconds: 300,
            now: times("2026-07-22T11:00:00.000Z"),
          },
          repository,
          embeddings,
          contended.control,
        ),
      ),
    ).resolves.toMatchObject({ disposition: "lease-unavailable" });
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it("reports freshness from durable control metadata only", async () => {
    const { control } = controlRepository();
    const result = await Effect.runPromise(
      readSynchronizationSourceStatus(
        "example",
        { sourceId: "jira-example", source: "jira" },
        3_600,
        "2026-07-22T11:00:00.000Z",
        control,
      ),
    );
    expect(result).toMatchObject({ freshness: { status: "current", lagSeconds: 1_800 } });
    expect(JSON.stringify(result)).not.toContain("document");
  });

  it("retains the original repository failure while recording failed control state", async () => {
    const releaseLease = vi.fn(() => Effect.void);
    const { control, runs } = controlRepository({ releaseLease });
    const failing: KnowledgeRepository = {
      ...repository,
      reconcile: () =>
        Effect.fail(
          new RepositoryError({
            message: "synthetic private failure",
            operation: "synthetic-reconcile",
          }),
        ),
    };
    await expect(
      Effect.runPromise(
        synchronizeKnowledgeSource(
          {
            workspaceId: "example",
            source: source(),
            trigger: "hourly-reconciliation",
            ownerId: "worker-1",
            leaseSeconds: 300,
            now: times("2026-07-22T11:00:00.000Z", "2026-07-22T11:00:30.000Z"),
          },
          failing,
          embeddings,
          control,
        ),
      ),
    ).rejects.toThrow("synthetic private failure");
    expect(runs.at(-1)).toMatchObject({ status: "failed", failureClass: "reconciliation" });
    expect(releaseLease).toHaveBeenCalledOnce();
  });
});

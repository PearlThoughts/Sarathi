import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  type SynchronizationCheckpoint,
  type SynchronizationControlRepository,
  type SynchronizationEventRegistration,
  type SynchronizationFreshness,
  type SynchronizationLease,
  type SynchronizationRetryPolicy,
  type SynchronizationRun,
  type SynchronizationStatus,
  synchronizationEventDeliveryId,
  synchronizationFreshness,
  synchronizationLeaseAvailable,
  synchronizationRetryAt,
} from "../src/modules/knowledge-layer/index.ts";

const checkpoint = (
  overrides: Partial<SynchronizationCheckpoint> = {},
): SynchronizationCheckpoint => ({
  workspaceId: "example",
  sourceId: "jira-example",
  cursor: "cursor-1",
  scopeHash: "sha256-scope",
  retryCount: 0,
  lastSucceededAt: "2026-07-22T10:00:00.000Z",
  newestSourceUpdatedAt: "2026-07-22T09:58:00.000Z",
  ...overrides,
});

describe("knowledge synchronization control plane", () => {
  it("derives a stable idempotency identity without retaining an event body", () => {
    const identity = {
      workspaceId: "example",
      sourceId: "teams-example",
      source: "teams" as const,
      providerEventId: "event-42",
    };

    expect(synchronizationEventDeliveryId(identity)).toBe(
      synchronizationEventDeliveryId({ ...identity }),
    );
    expect(
      synchronizationEventDeliveryId({
        ...identity,
        providerEventId: "event-43",
      }),
    ).not.toBe(synchronizationEventDeliveryId(identity));
    expect(synchronizationEventDeliveryId(identity)).toMatch(/^sha256-/);
    expect(() => synchronizationEventDeliveryId({ ...identity, providerEventId: " " })).toThrow(
      "providerEventId must not be blank",
    );
  });

  it("reports unavailable, current, and stale sources from the last successful checkpoint", () => {
    expect(synchronizationFreshness(undefined, "2026-07-22T10:30:00.000Z", 3_600)).toEqual({
      status: "unavailable",
      lagSeconds: null,
    });
    expect(synchronizationFreshness(checkpoint(), "2026-07-22T10:30:00.000Z", 3_600)).toEqual({
      status: "current",
      lagSeconds: 1_800,
      lastSucceededAt: "2026-07-22T10:00:00.000Z",
      newestSourceUpdatedAt: "2026-07-22T09:58:00.000Z",
    });
    expect(synchronizationFreshness(checkpoint(), "2026-07-22T11:00:01.000Z", 3_600).status).toBe(
      "stale",
    );
    expect(() => synchronizationFreshness(checkpoint(), "invalid", 3_600)).toThrow(
      "now must be an ISO timestamp",
    );
  });

  it("calculates bounded exponential retries and stops at the attempt limit", () => {
    const policy: SynchronizationRetryPolicy = {
      maximumAttempts: 4,
      baseDelaySeconds: 30,
      maximumDelaySeconds: 60,
    };

    expect(synchronizationRetryAt(1, "2026-07-22T10:00:00.000Z", policy)).toBe(
      "2026-07-22T10:00:30.000Z",
    );
    expect(synchronizationRetryAt(3, "2026-07-22T10:00:00.000Z", policy)).toBe(
      "2026-07-22T10:01:00.000Z",
    );
    expect(synchronizationRetryAt(4, "2026-07-22T10:00:00.000Z", policy)).toBeUndefined();
    expect(() => synchronizationRetryAt(0, "2026-07-22T10:00:00.000Z", policy)).toThrow(
      "failedAttemptCount must be a positive integer",
    );
  });

  it("keeps provider implementations behind one typed synchronization control port", async () => {
    const run: SynchronizationRun = {
      id: "run-1",
      workspaceId: "example",
      sourceId: "jira-example",
      trigger: "hourly-reconciliation",
      status: "running",
      scopeHash: "sha256-scope",
      startedAt: "2026-07-22T10:00:00.000Z",
      attemptCount: 1,
    };
    const registration: SynchronizationEventRegistration = {
      disposition: "accepted",
      delivery: {
        id: "delivery-1",
        workspaceId: "example",
        sourceId: "jira-example",
        source: "jira",
        providerEventId: "event-1",
        payloadHash: "sha256-payload",
        receivedAt: "2026-07-22T10:00:00.000Z",
        status: "received",
        attemptCount: 0,
      },
    };
    const status: SynchronizationStatus = {
      checkpoint: checkpoint(),
      latestRun: run,
    };
    const repository: SynchronizationControlRepository = {
      registerEvent: () => Effect.succeed(registration),
      saveSubscription: () => Effect.void,
      acquireLease: () => Effect.succeed(true),
      heartbeatLease: () => Effect.succeed(true),
      releaseLease: () => Effect.void,
      startRun: () => Effect.void,
      completeRun: () => Effect.void,
      updateEvent: () => Effect.void,
      readStatus: () => Effect.succeed(status),
    };

    const saved = await Effect.runPromise(repository.registerEvent(registration.delivery));
    const observed: SynchronizationFreshness = synchronizationFreshness(
      status.checkpoint,
      "2026-07-22T10:30:00.000Z",
      3_600,
    );
    expect(saved.disposition).toBe("accepted");
    expect(observed.status).toBe("current");
    expect(await Effect.runPromise(repository.readStatus("example", "jira-example"))).toEqual(
      status,
    );
  });

  it("allows the current owner to renew and another owner only after lease expiry", () => {
    const lease: SynchronizationLease = {
      workspaceId: "example",
      sourceId: "vault-example",
      operation: "hourly-reconciliation",
      ownerId: "worker-1",
      acquiredAt: "2026-07-22T10:00:00.000Z",
      heartbeatAt: "2026-07-22T10:04:00.000Z",
      expiresAt: "2026-07-22T10:10:00.000Z",
    };

    expect(synchronizationLeaseAvailable(lease, "worker-1", "2026-07-22T10:05:00.000Z")).toBe(true);
    expect(synchronizationLeaseAvailable(lease, "worker-2", "2026-07-22T10:05:00.000Z")).toBe(
      false,
    );
    expect(synchronizationLeaseAvailable(lease, "worker-2", "2026-07-22T10:10:00.000Z")).toBe(true);
  });
});

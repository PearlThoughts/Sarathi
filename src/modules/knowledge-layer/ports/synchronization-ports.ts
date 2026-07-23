import type { Effect } from "effect";
import type { RepositoryError } from "../../../domain/errors.ts";
import type {
  SynchronizationCheckpoint,
  SynchronizationEventDelivery,
  SynchronizationFailureClass,
  SynchronizationLease,
  SynchronizationRunStatus,
  SynchronizationSubscription,
  SynchronizationTrigger,
} from "../domain/synchronization.ts";

export type SynchronizationEventRegistration = {
  readonly disposition: "accepted" | "duplicate";
  readonly delivery: SynchronizationEventDelivery;
};

export type SynchronizationRun = {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly trigger: SynchronizationTrigger;
  readonly status: SynchronizationRunStatus;
  readonly cursorBefore?: string | undefined;
  readonly cursorAfter?: string | undefined;
  readonly scopeHash: string;
  readonly startedAt: string;
  readonly completedAt?: string | undefined;
  readonly attemptCount: number;
  readonly newestSourceUpdatedAt?: string | undefined;
  readonly lagSeconds?: number | undefined;
  readonly failureClass?: SynchronizationFailureClass | undefined;
};

export type SynchronizationStatus = {
  readonly checkpoint?: SynchronizationCheckpoint | undefined;
  readonly subscription?: SynchronizationSubscription | undefined;
  readonly activeLease?: SynchronizationLease | undefined;
  readonly latestRun?: SynchronizationRun | undefined;
};

export type SynchronizationControlRepository = {
  readonly registerEvent: (
    delivery: SynchronizationEventDelivery,
  ) => Effect.Effect<SynchronizationEventRegistration, RepositoryError>;
  readonly saveSubscription: (
    subscription: SynchronizationSubscription,
  ) => Effect.Effect<void, RepositoryError>;
  readonly readSubscriptions: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<readonly SynchronizationSubscription[], RepositoryError>;
  readonly acquireLease: (lease: SynchronizationLease) => Effect.Effect<boolean, RepositoryError>;
  readonly heartbeatLease: (lease: SynchronizationLease) => Effect.Effect<boolean, RepositoryError>;
  readonly releaseLease: (lease: SynchronizationLease) => Effect.Effect<void, RepositoryError>;
  readonly startRun: (run: SynchronizationRun) => Effect.Effect<void, RepositoryError>;
  readonly completeRun: (run: SynchronizationRun) => Effect.Effect<void, RepositoryError>;
  readonly updateEvent: (
    delivery: SynchronizationEventDelivery,
  ) => Effect.Effect<void, RepositoryError>;
  readonly readStatus: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<SynchronizationStatus, RepositoryError>;
};

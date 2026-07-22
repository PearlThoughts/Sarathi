import { stableSha256 } from "../../../domain/hash.ts";
import type { KnowledgeSourceKind } from "./knowledge.ts";

export type SynchronizationTrigger =
  | "source-event"
  | "hourly-reconciliation"
  | "manual-reconciliation"
  | "historical-backfill";

export type SynchronizationRunStatus = "running" | "succeeded" | "failed";
export type SynchronizationDeliveryStatus =
  | "received"
  | "processing"
  | "succeeded"
  | "failed"
  | "ignored";
export type SynchronizationSubscriptionStatus =
  | "active"
  | "renewal-due"
  | "expired"
  | "failed"
  | "disabled";
export type SynchronizationFailureClass =
  | "authorization"
  | "invalid-event"
  | "persistence"
  | "rate-limited"
  | "reconciliation"
  | "scope-mismatch"
  | "source-unavailable"
  | "subscription-expired"
  | "unknown";

export type SynchronizationEventIdentity = {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly source: KnowledgeSourceKind;
  readonly providerEventId: string;
};

export type SynchronizationEventDelivery = SynchronizationEventIdentity & {
  readonly id: string;
  readonly payloadHash: string;
  readonly sourceVersion?: string | undefined;
  readonly sourceOccurredAt?: string | undefined;
  readonly receivedAt: string;
  readonly status: SynchronizationDeliveryStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt?: string | undefined;
  readonly processedAt?: string | undefined;
  readonly failureClass?: SynchronizationFailureClass | undefined;
};

export type SynchronizationSubscription = {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly source: KnowledgeSourceKind;
  readonly provider: string;
  readonly resourceHash: string;
  readonly status: SynchronizationSubscriptionStatus;
  readonly expiresAt?: string | undefined;
  readonly renewedAt?: string | undefined;
  readonly nextRenewalAt?: string | undefined;
  readonly retryCount: number;
  readonly failureClass?: SynchronizationFailureClass | undefined;
  readonly updatedAt: string;
};

export type SynchronizationLease = {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly operation: SynchronizationTrigger;
  readonly ownerId: string;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
};

export type SynchronizationCheckpoint = {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly cursor: string;
  readonly scopeHash: string;
  readonly indexedSourceRevision?: string | undefined;
  readonly lastEventAt?: string | undefined;
  readonly lastReconciledAt?: string | undefined;
  readonly newestSourceUpdatedAt?: string | undefined;
  readonly lastSucceededAt?: string | undefined;
  readonly retryCount: number;
  readonly nextReconcileAt?: string | undefined;
  readonly failureClass?: SynchronizationFailureClass | undefined;
};

export type SynchronizationFreshness = {
  readonly status: "current" | "stale" | "unavailable";
  readonly lagSeconds: number | null;
  readonly lastSucceededAt?: string | undefined;
  readonly newestSourceUpdatedAt?: string | undefined;
};

export type SynchronizationRetryPolicy = {
  readonly maximumAttempts: number;
  readonly baseDelaySeconds: number;
  readonly maximumDelaySeconds: number;
};

const nonBlank = (name: string, value: string): string => {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${name} must not be blank.`);
  return normalized;
};

const timestamp = (name: string, value: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an ISO timestamp.`);
  return parsed;
};

export const synchronizationEventDeliveryId = (identity: SynchronizationEventIdentity): string =>
  stableSha256(
    [
      nonBlank("workspaceId", identity.workspaceId),
      nonBlank("sourceId", identity.sourceId),
      identity.source,
      nonBlank("providerEventId", identity.providerEventId),
    ].join("\n"),
  );

export const synchronizationRetryAt = (
  failedAttemptCount: number,
  failedAt: string,
  policy: SynchronizationRetryPolicy,
): string | undefined => {
  if (!Number.isInteger(failedAttemptCount) || failedAttemptCount < 1)
    throw new Error("failedAttemptCount must be a positive integer.");
  if (!Number.isInteger(policy.maximumAttempts) || policy.maximumAttempts < 1)
    throw new Error("maximumAttempts must be a positive integer.");
  if (policy.baseDelaySeconds <= 0 || policy.maximumDelaySeconds < policy.baseDelaySeconds)
    throw new Error("Retry delays must be positive and bounded.");
  if (failedAttemptCount >= policy.maximumAttempts) return undefined;
  const delaySeconds = Math.min(
    policy.maximumDelaySeconds,
    policy.baseDelaySeconds * 2 ** (failedAttemptCount - 1),
  );
  return new Date(timestamp("failedAt", failedAt) + delaySeconds * 1_000).toISOString();
};

export const synchronizationLeaseAvailable = (
  lease: SynchronizationLease | undefined,
  ownerId: string,
  now: string,
): boolean =>
  lease === undefined ||
  lease.ownerId === nonBlank("ownerId", ownerId) ||
  timestamp("expiresAt", lease.expiresAt) <= timestamp("now", now);

export const synchronizationFreshness = (
  checkpoint: SynchronizationCheckpoint | undefined,
  now: string,
  staleAfterSeconds: number,
): SynchronizationFreshness => {
  if (!Number.isFinite(staleAfterSeconds) || staleAfterSeconds <= 0)
    throw new Error("staleAfterSeconds must be positive.");
  if (checkpoint?.lastSucceededAt === undefined) return { status: "unavailable", lagSeconds: null };

  const lagSeconds = Math.max(
    0,
    Math.floor(
      (timestamp("now", now) - timestamp("lastSucceededAt", checkpoint.lastSucceededAt)) / 1_000,
    ),
  );
  return {
    status: lagSeconds > staleAfterSeconds ? "stale" : "current",
    lagSeconds,
    lastSucceededAt: checkpoint.lastSucceededAt,
    ...(checkpoint.newestSourceUpdatedAt === undefined
      ? {}
      : { newestSourceUpdatedAt: checkpoint.newestSourceUpdatedAt }),
  };
};

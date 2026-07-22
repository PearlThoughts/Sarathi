import { Duration, Effect, Exit } from "effect";
import { RepositoryError } from "../../../domain/errors.ts";
import { stableSha256 } from "../../../domain/hash.ts";
import type { KnowledgeSourceKind } from "../domain/knowledge.ts";
import {
  type SynchronizationEventDelivery,
  type SynchronizationFreshness,
  type SynchronizationTrigger,
  synchronizationFreshness,
} from "../domain/synchronization.ts";
import type {
  KnowledgeEmbeddingPort,
  KnowledgeIngestionSummary,
  KnowledgeRepository,
  KnowledgeSourceReader,
} from "../ports/knowledge-ports.ts";
import type {
  SynchronizationControlRepository,
  SynchronizationStatus,
} from "../ports/synchronization-ports.ts";
import { ingestKnowledgeSource } from "./knowledge-service.ts";

export type SynchronizationSource = {
  readonly sourceId: string;
  readonly source: KnowledgeSourceKind;
  readonly reader: KnowledgeSourceReader;
};

type SynchronizationRequest = {
  readonly workspaceId: string;
  readonly source: SynchronizationSource;
  readonly trigger: SynchronizationTrigger;
  readonly ownerId: string;
  readonly leaseSeconds: number;
  readonly now: () => string;
  readonly event?: SynchronizationEventDelivery | undefined;
};

type SynchronizationOutcome = {
  readonly sourceId: string;
  readonly source: KnowledgeSourceKind;
  readonly trigger: SynchronizationTrigger;
  readonly disposition: "succeeded" | "duplicate" | "lease-unavailable";
  readonly summary?: KnowledgeIngestionSummary | undefined;
};

type SynchronizationSourceStatus = {
  readonly sourceId: string;
  readonly source: KnowledgeSourceKind;
  readonly freshness: SynchronizationFreshness;
  readonly control: SynchronizationStatus;
};

const timestamp = (value: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Synchronization clock returned an invalid time.");
  return parsed;
};

const runId = (request: SynchronizationRequest, startedAt: string): string =>
  `sync-run:${stableSha256(
    `${request.workspaceId}:${request.source.sourceId}:${request.trigger}:${request.ownerId}:${startedAt}`,
  )}`;

const failure = (operation: string): RepositoryError =>
  new RepositoryError({
    message: "Knowledge synchronization failed; inspect privacy-safe control metadata.",
    operation,
  });

export const synchronizeKnowledgeSource = (
  request: SynchronizationRequest,
  repository: KnowledgeRepository,
  embeddings: KnowledgeEmbeddingPort,
  control: SynchronizationControlRepository,
): Effect.Effect<SynchronizationOutcome, RepositoryError> =>
  Effect.gen(function* () {
    if (!Number.isInteger(request.leaseSeconds) || request.leaseSeconds < 30)
      return yield* Effect.fail(failure("knowledge-sync.invalid-lease"));
    if (request.event !== undefined) {
      if (
        request.event.workspaceId !== request.workspaceId ||
        request.event.sourceId !== request.source.sourceId ||
        request.event.source !== request.source.source
      )
        return yield* Effect.fail(failure("knowledge-sync.event-scope"));
      const registration = yield* control.registerEvent(request.event);
      if (
        registration.disposition === "duplicate" &&
        (registration.delivery.status === "succeeded" || registration.delivery.status === "ignored")
      )
        return {
          sourceId: request.source.sourceId,
          source: request.source.source,
          trigger: request.trigger,
          disposition: "duplicate",
        };
    }

    const before = yield* control.readStatus(request.workspaceId, request.source.sourceId);
    const startedAt = request.now();
    const lease = {
      workspaceId: request.workspaceId,
      sourceId: request.source.sourceId,
      operation: "source-synchronization" as const,
      ownerId: request.ownerId,
      acquiredAt: startedAt,
      heartbeatAt: startedAt,
      expiresAt: new Date(timestamp(startedAt) + request.leaseSeconds * 1_000).toISOString(),
    } as const;
    const acquired = yield* control.acquireLease(lease);
    if (!acquired)
      return {
        sourceId: request.source.sourceId,
        source: request.source.source,
        trigger: request.trigger,
        disposition: "lease-unavailable",
      };

    const id = runId(request, startedAt);
    const running = {
      id,
      workspaceId: request.workspaceId,
      sourceId: request.source.sourceId,
      trigger: request.trigger,
      status: "running" as const,
      ...(before.checkpoint === undefined ? {} : { cursorBefore: before.checkpoint.cursor }),
      scopeHash: before.checkpoint?.scopeHash ?? "uninitialized",
      startedAt,
      attemptCount: 1,
    };
    const operation = Effect.gen(function* () {
      yield* control.startRun(running);
      if (request.event !== undefined)
        yield* control.updateEvent({
          ...request.event,
          status: "processing",
          attemptCount: request.event.attemptCount + 1,
        });
      return yield* ingestKnowledgeSource(
        request.source.reader,
        repository,
        embeddings,
        request.workspaceId,
        request.trigger === "historical-backfill" ? undefined : before.checkpoint?.cursor,
      );
    }).pipe(
      Effect.flatMap((summary) =>
        Effect.gen(function* () {
          const completedAt = request.now();
          const after = yield* control.readStatus(request.workspaceId, request.source.sourceId);
          const newestSourceUpdatedAt = after.checkpoint?.newestSourceUpdatedAt;
          const lagSeconds =
            newestSourceUpdatedAt === undefined
              ? undefined
              : Math.max(
                  0,
                  Math.floor((timestamp(completedAt) - timestamp(newestSourceUpdatedAt)) / 1_000),
                );
          yield* control.completeRun({
            ...running,
            status: "succeeded",
            cursorAfter: summary.cursor,
            scopeHash: summary.scopeHash,
            completedAt,
            ...(newestSourceUpdatedAt === undefined ? {} : { newestSourceUpdatedAt }),
            ...(lagSeconds === undefined ? {} : { lagSeconds }),
          });
          if (request.event !== undefined)
            yield* control.updateEvent({
              ...request.event,
              status: "succeeded",
              attemptCount: request.event.attemptCount + 1,
              processedAt: completedAt,
            });
          return {
            sourceId: request.source.sourceId,
            source: request.source.source,
            trigger: request.trigger,
            disposition: "succeeded" as const,
            summary,
          };
        }),
      ),
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) return Effect.void;
        const completedAt = request.now();
        return Effect.all(
          [
            control.completeRun({
              ...running,
              status: "failed",
              completedAt,
              failureClass: "reconciliation",
            }),
            ...(request.event === undefined
              ? []
              : [
                  control.updateEvent({
                    ...request.event,
                    status: "failed",
                    attemptCount: request.event.attemptCount + 1,
                    processedAt: completedAt,
                    failureClass: "reconciliation",
                  }),
                ]),
          ],
          { concurrency: 1, discard: true },
        ).pipe(Effect.ignore);
      }),
      Effect.ensuring(control.releaseLease(lease).pipe(Effect.ignore)),
    );
    const heartbeat = Effect.sleep(
      Duration.seconds(Math.max(10, Math.floor(request.leaseSeconds / 3))),
    ).pipe(
      Effect.flatMap(() => {
        const heartbeatAt = request.now();
        return control
          .heartbeatLease({
            ...lease,
            heartbeatAt,
            expiresAt: new Date(
              timestamp(heartbeatAt) + request.leaseSeconds * 1_000,
            ).toISOString(),
          })
          .pipe(
            Effect.flatMap((renewed) =>
              renewed ? Effect.void : Effect.fail(failure("knowledge-sync.lease-lost")),
            ),
          );
      }),
      Effect.forever,
    );
    return yield* Effect.raceFirst(operation, heartbeat);
  });

export const readSynchronizationSourceStatus = (
  workspaceId: string,
  source: Pick<SynchronizationSource, "source" | "sourceId">,
  staleAfterSeconds: number,
  now: string,
  control: SynchronizationControlRepository,
): Effect.Effect<SynchronizationSourceStatus, RepositoryError> =>
  control.readStatus(workspaceId, source.sourceId).pipe(
    Effect.map((status) => ({
      sourceId: source.sourceId,
      source: source.source,
      freshness: synchronizationFreshness(status.checkpoint, now, staleAfterSeconds),
      control: status,
    })),
  );

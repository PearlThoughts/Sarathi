import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import type {
  KnowledgeSourceKind,
  SynchronizationCheckpoint,
  SynchronizationControlRepository,
  SynchronizationEventDelivery,
  SynchronizationLease,
  SynchronizationRun,
  SynchronizationSubscription,
} from "../../modules/knowledge-layer/index.ts";
import type { KnowledgePostgresDatabase } from "./knowledge-migrations.ts";
import {
  knowledgeSyncCheckpointTable,
  knowledgeSyncEventDeliveryTable,
  knowledgeSyncLeaseTable,
  knowledgeSyncRunTable,
  knowledgeSyncSubscriptionTable,
} from "./knowledge-schema.ts";

const repositoryFailure = (operation: string) =>
  new RepositoryError({
    message: "Knowledge synchronization control persistence failed.",
    operation,
  });

const effect = <Value>(operation: string, run: () => Promise<Value>) =>
  Effect.tryPromise({ try: run, catch: () => repositoryFailure(operation) });

const eventFromRow = (
  row: typeof knowledgeSyncEventDeliveryTable.$inferSelect,
): SynchronizationEventDelivery => ({
  id: row.id,
  workspaceId: row.workspaceId,
  sourceId: row.sourceId,
  source: row.sourceKind as KnowledgeSourceKind,
  providerEventId: row.providerEventId,
  payloadHash: row.payloadHash,
  ...(row.sourceVersion === null ? {} : { sourceVersion: row.sourceVersion }),
  ...(row.sourceOccurredAt === null ? {} : { sourceOccurredAt: row.sourceOccurredAt }),
  receivedAt: row.receivedAt,
  status: row.status as SynchronizationEventDelivery["status"],
  attemptCount: row.attemptCount,
  ...(row.nextAttemptAt === null ? {} : { nextAttemptAt: row.nextAttemptAt }),
  ...(row.processedAt === null ? {} : { processedAt: row.processedAt }),
  ...(row.failureClass === null
    ? {}
    : {
        failureClass: row.failureClass as SynchronizationEventDelivery["failureClass"],
      }),
});

const leaseFromRow = (row: typeof knowledgeSyncLeaseTable.$inferSelect): SynchronizationLease => ({
  workspaceId: row.workspaceId,
  sourceId: row.sourceId,
  operation: row.operation as SynchronizationLease["operation"],
  ownerId: row.ownerId,
  acquiredAt: row.acquiredAt,
  heartbeatAt: row.heartbeatAt,
  expiresAt: row.expiresAt,
});

const subscriptionFromRow = (
  row: typeof knowledgeSyncSubscriptionTable.$inferSelect,
): SynchronizationSubscription => ({
  id: row.id,
  workspaceId: row.workspaceId,
  sourceId: row.sourceId,
  source: row.sourceKind as KnowledgeSourceKind,
  provider: row.provider,
  resourceHash: row.resourceHash,
  status: row.status as SynchronizationSubscription["status"],
  ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
  ...(row.renewedAt === null ? {} : { renewedAt: row.renewedAt }),
  ...(row.nextRenewalAt === null ? {} : { nextRenewalAt: row.nextRenewalAt }),
  retryCount: row.retryCount,
  ...(row.failureClass === null
    ? {}
    : {
        failureClass: row.failureClass as SynchronizationSubscription["failureClass"],
      }),
  updatedAt: row.updatedAt,
});

const runFromRow = (row: typeof knowledgeSyncRunTable.$inferSelect): SynchronizationRun => ({
  id: row.id,
  workspaceId: row.workspaceId,
  sourceId: row.sourceId,
  trigger: row.trigger as SynchronizationRun["trigger"],
  status: row.status as SynchronizationRun["status"],
  ...(row.cursorBefore === null ? {} : { cursorBefore: row.cursorBefore }),
  ...(row.cursorAfter === null ? {} : { cursorAfter: row.cursorAfter }),
  scopeHash: row.scopeHash,
  startedAt: row.startedAt,
  ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
  attemptCount: row.attemptCount,
  ...(row.newestSourceUpdatedAt === null
    ? {}
    : { newestSourceUpdatedAt: row.newestSourceUpdatedAt }),
  ...(row.lagSeconds === null ? {} : { lagSeconds: row.lagSeconds }),
  ...(row.failureClass === null
    ? {}
    : { failureClass: row.failureClass as SynchronizationRun["failureClass"] }),
});

const checkpointFromRow = (
  row: typeof knowledgeSyncCheckpointTable.$inferSelect,
): SynchronizationCheckpoint => ({
  workspaceId: row.workspaceId,
  sourceId: row.sourceId,
  cursor: row.cursor,
  scopeHash: row.scopeHash,
  ...(row.indexedSourceRevision === null
    ? {}
    : { indexedSourceRevision: row.indexedSourceRevision }),
  ...(row.lastEventAt === null ? {} : { lastEventAt: row.lastEventAt }),
  ...(row.lastReconciledAt === null ? {} : { lastReconciledAt: row.lastReconciledAt }),
  ...(row.newestSourceUpdatedAt === null
    ? {}
    : { newestSourceUpdatedAt: row.newestSourceUpdatedAt }),
  ...(row.lastSucceededAt === null ? {} : { lastSucceededAt: row.lastSucceededAt }),
  retryCount: row.retryCount,
  ...(row.nextReconcileAt === null ? {} : { nextReconcileAt: row.nextReconcileAt }),
  ...(row.failureClass === null
    ? {}
    : {
        failureClass: row.failureClass as SynchronizationCheckpoint["failureClass"],
      }),
});

export const createPostgresSynchronizationControlRepository = (
  database: KnowledgePostgresDatabase,
): SynchronizationControlRepository => ({
  registerEvent: (delivery) =>
    effect("knowledge-sync.register-event", async () => {
      const inserted = await database
        .insert(knowledgeSyncEventDeliveryTable)
        .values({
          id: delivery.id,
          sourceId: delivery.sourceId,
          workspaceId: delivery.workspaceId,
          sourceKind: delivery.source,
          providerEventId: delivery.providerEventId,
          sourceVersion: delivery.sourceVersion ?? null,
          payloadHash: delivery.payloadHash,
          sourceOccurredAt: delivery.sourceOccurredAt ?? null,
          receivedAt: delivery.receivedAt,
          status: delivery.status,
          attemptCount: delivery.attemptCount,
          nextAttemptAt: delivery.nextAttemptAt ?? null,
          processedAt: delivery.processedAt ?? null,
          failureClass: delivery.failureClass ?? null,
        })
        .onConflictDoNothing({
          target: [
            knowledgeSyncEventDeliveryTable.workspaceId,
            knowledgeSyncEventDeliveryTable.sourceId,
            knowledgeSyncEventDeliveryTable.providerEventId,
          ],
        })
        .returning();
      if (inserted[0] !== undefined)
        return {
          disposition: "accepted" as const,
          delivery: eventFromRow(inserted[0]),
        };
      const existing = await database
        .select()
        .from(knowledgeSyncEventDeliveryTable)
        .where(
          and(
            eq(knowledgeSyncEventDeliveryTable.workspaceId, delivery.workspaceId),
            eq(knowledgeSyncEventDeliveryTable.sourceId, delivery.sourceId),
            eq(knowledgeSyncEventDeliveryTable.providerEventId, delivery.providerEventId),
          ),
        )
        .limit(1);
      if (existing[0] === undefined) throw new Error("Event conflict row was not found.");
      return {
        disposition: "duplicate" as const,
        delivery: eventFromRow(existing[0]),
      };
    }),
  updateEvent: (delivery) =>
    effect("knowledge-sync.update-event", async () => {
      const updated = await database
        .update(knowledgeSyncEventDeliveryTable)
        .set({
          status: delivery.status,
          attemptCount: delivery.attemptCount,
          nextAttemptAt: delivery.nextAttemptAt ?? null,
          processedAt: delivery.processedAt ?? null,
          failureClass: delivery.failureClass ?? null,
        })
        .where(
          and(
            eq(knowledgeSyncEventDeliveryTable.id, delivery.id),
            eq(knowledgeSyncEventDeliveryTable.workspaceId, delivery.workspaceId),
            eq(knowledgeSyncEventDeliveryTable.sourceId, delivery.sourceId),
          ),
        )
        .returning({ id: knowledgeSyncEventDeliveryTable.id });
      if (updated.length !== 1) throw new Error("Event delivery was not found.");
    }),
  saveSubscription: (subscription) =>
    effect("knowledge-sync.save-subscription", async () => {
      await database
        .insert(knowledgeSyncSubscriptionTable)
        .values({
          id: subscription.id,
          sourceId: subscription.sourceId,
          workspaceId: subscription.workspaceId,
          sourceKind: subscription.source,
          provider: subscription.provider,
          resourceHash: subscription.resourceHash,
          status: subscription.status,
          expiresAt: subscription.expiresAt ?? null,
          renewedAt: subscription.renewedAt ?? null,
          nextRenewalAt: subscription.nextRenewalAt ?? null,
          retryCount: subscription.retryCount,
          failureClass: subscription.failureClass ?? null,
          updatedAt: subscription.updatedAt,
        })
        .onConflictDoUpdate({
          target: [
            knowledgeSyncSubscriptionTable.workspaceId,
            knowledgeSyncSubscriptionTable.sourceId,
            knowledgeSyncSubscriptionTable.provider,
            knowledgeSyncSubscriptionTable.resourceHash,
          ],
          set: {
            id: subscription.id,
            sourceKind: subscription.source,
            status: subscription.status,
            expiresAt: subscription.expiresAt ?? null,
            renewedAt: subscription.renewedAt ?? null,
            nextRenewalAt: subscription.nextRenewalAt ?? null,
            retryCount: subscription.retryCount,
            failureClass: subscription.failureClass ?? null,
            updatedAt: subscription.updatedAt,
          },
        });
    }),
  acquireLease: (lease) =>
    effect("knowledge-sync.acquire-lease", async () => {
      const result = await database.execute(sql`
        insert into ${knowledgeSyncLeaseTable}
          (workspace_id, source_id, operation, owner_id, acquired_at, heartbeat_at, expires_at)
        values
          (${lease.workspaceId}, ${lease.sourceId}, ${lease.operation}, ${lease.ownerId},
           ${lease.acquiredAt}, ${lease.heartbeatAt}, ${lease.expiresAt})
        on conflict (workspace_id, source_id, operation) do update set
          owner_id = excluded.owner_id,
          acquired_at = excluded.acquired_at,
          heartbeat_at = excluded.heartbeat_at,
          expires_at = excluded.expires_at
        where ${knowledgeSyncLeaseTable.ownerId} = excluded.owner_id
           or ${knowledgeSyncLeaseTable.expiresAt} <= excluded.acquired_at
        returning owner_id
      `);
      return result.rows.length === 1;
    }),
  heartbeatLease: (lease) =>
    effect("knowledge-sync.heartbeat-lease", async () => {
      const updated = await database
        .update(knowledgeSyncLeaseTable)
        .set({ heartbeatAt: lease.heartbeatAt, expiresAt: lease.expiresAt })
        .where(
          and(
            eq(knowledgeSyncLeaseTable.workspaceId, lease.workspaceId),
            eq(knowledgeSyncLeaseTable.sourceId, lease.sourceId),
            eq(knowledgeSyncLeaseTable.operation, lease.operation),
            eq(knowledgeSyncLeaseTable.ownerId, lease.ownerId),
            gt(knowledgeSyncLeaseTable.expiresAt, lease.heartbeatAt),
          ),
        )
        .returning({ ownerId: knowledgeSyncLeaseTable.ownerId });
      return updated.length === 1;
    }),
  releaseLease: (lease) =>
    effect("knowledge-sync.release-lease", async () => {
      await database
        .delete(knowledgeSyncLeaseTable)
        .where(
          and(
            eq(knowledgeSyncLeaseTable.workspaceId, lease.workspaceId),
            eq(knowledgeSyncLeaseTable.sourceId, lease.sourceId),
            eq(knowledgeSyncLeaseTable.operation, lease.operation),
            eq(knowledgeSyncLeaseTable.ownerId, lease.ownerId),
          ),
        );
    }),
  startRun: (run) =>
    effect("knowledge-sync.start-run", async () => {
      await database.insert(knowledgeSyncRunTable).values({
        id: run.id,
        sourceId: run.sourceId,
        workspaceId: run.workspaceId,
        trigger: run.trigger,
        status: run.status,
        cursorBefore: run.cursorBefore ?? null,
        cursorAfter: run.cursorAfter ?? null,
        scopeHash: run.scopeHash,
        newestSourceUpdatedAt: run.newestSourceUpdatedAt ?? null,
        lagSeconds: run.lagSeconds ?? null,
        attemptCount: run.attemptCount,
        failureClass: run.failureClass ?? null,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? null,
      });
    }),
  completeRun: (run) =>
    effect("knowledge-sync.complete-run", async () => {
      if (run.status === "running" || run.completedAt === undefined)
        throw new Error("A completed run requires a terminal status and completion time.");
      const updated = await database
        .update(knowledgeSyncRunTable)
        .set({
          status: run.status,
          cursorAfter: run.cursorAfter ?? null,
          newestSourceUpdatedAt: run.newestSourceUpdatedAt ?? null,
          lagSeconds: run.lagSeconds ?? null,
          attemptCount: run.attemptCount,
          failureClass: run.failureClass ?? null,
          completedAt: run.completedAt,
        })
        .where(
          and(
            eq(knowledgeSyncRunTable.id, run.id),
            eq(knowledgeSyncRunTable.workspaceId, run.workspaceId),
            eq(knowledgeSyncRunTable.sourceId, run.sourceId),
          ),
        )
        .returning({ id: knowledgeSyncRunTable.id });
      if (updated.length !== 1) throw new Error("Synchronization run was not found.");
    }),
  readStatus: (workspaceId, sourceId) =>
    effect("knowledge-sync.read-status", async () => {
      const [checkpoints, subscriptions, leases, runs] = await Promise.all([
        database
          .select()
          .from(knowledgeSyncCheckpointTable)
          .where(
            and(
              eq(knowledgeSyncCheckpointTable.workspaceId, workspaceId),
              eq(knowledgeSyncCheckpointTable.sourceId, sourceId),
            ),
          )
          .limit(1),
        database
          .select()
          .from(knowledgeSyncSubscriptionTable)
          .where(
            and(
              eq(knowledgeSyncSubscriptionTable.workspaceId, workspaceId),
              eq(knowledgeSyncSubscriptionTable.sourceId, sourceId),
            ),
          )
          .orderBy(desc(knowledgeSyncSubscriptionTable.updatedAt))
          .limit(1),
        database
          .select()
          .from(knowledgeSyncLeaseTable)
          .where(
            and(
              eq(knowledgeSyncLeaseTable.workspaceId, workspaceId),
              eq(knowledgeSyncLeaseTable.sourceId, sourceId),
              gt(knowledgeSyncLeaseTable.expiresAt, sql`now()`),
            ),
          )
          .orderBy(desc(knowledgeSyncLeaseTable.heartbeatAt))
          .limit(1),
        database
          .select()
          .from(knowledgeSyncRunTable)
          .where(
            and(
              eq(knowledgeSyncRunTable.workspaceId, workspaceId),
              eq(knowledgeSyncRunTable.sourceId, sourceId),
            ),
          )
          .orderBy(desc(knowledgeSyncRunTable.startedAt))
          .limit(1),
      ]);
      return {
        ...(checkpoints[0] === undefined ? {} : { checkpoint: checkpointFromRow(checkpoints[0]) }),
        ...(subscriptions[0] === undefined
          ? {}
          : { subscription: subscriptionFromRow(subscriptions[0]) }),
        ...(leases[0] === undefined ? {} : { activeLease: leaseFromRow(leases[0]) }),
        ...(runs[0] === undefined ? {} : { latestRun: runFromRow(runs[0]) }),
      };
    }),
});

import { Effect } from "effect";
import type { ProductEntityId, ProductModel } from "../domain/product-model.ts";
import {
  type ProductCommandAuditRecord,
  type ProductCommandCommit,
  ProductCommandPersistenceError,
  type ProductModelCommandRepository,
  type ProductOutboxRecord,
} from "../ports/product-model-command-repository.ts";

type CommittedCommand = {
  readonly commandHash: string;
  readonly revision: number;
  readonly eventId: string;
  readonly changedEntityIds: readonly ProductEntityId[];
};

type InMemoryProductModelCommandRepository = ProductModelCommandRepository & {
  readonly history: (workspaceId: string) => readonly ProductModel[];
  readonly audits: (workspaceId: string) => readonly ProductCommandAuditRecord[];
  readonly outbox: (workspaceId: string) => readonly ProductOutboxRecord[];
};

export const createInMemoryProductModelCommandRepository = (options?: {
  readonly initialModels?: readonly ProductModel[] | undefined;
  readonly beforeCommit?:
    | ((change: ProductCommandCommit) => Effect.Effect<void, ProductCommandPersistenceError>)
    | undefined;
}): InMemoryProductModelCommandRepository => {
  const snapshots = new Map<string, ProductModel[]>();
  const auditRows = new Map<string, ProductCommandAuditRecord[]>();
  const outboxRows = new Map<string, ProductOutboxRecord[]>();
  const idempotency = new Map<string, CommittedCommand>();

  for (const model of options?.initialModels ?? [])
    snapshots.set(model.workspaceId, [structuredClone(model)]);

  const history = (workspaceId: string) => snapshots.get(workspaceId) ?? [];
  const copy = <Value>(value: Value): Value => structuredClone(value);

  return {
    replay: (workspaceId, idempotencyKey, commandHash) =>
      Effect.suspend(() => {
        const committed = idempotency.get(`${workspaceId}\u0000${idempotencyKey}`);
        if (committed === undefined) return Effect.succeed(undefined);
        if (committed.commandHash !== commandHash)
          return Effect.fail(
            new ProductCommandPersistenceError(
              "idempotency_conflict",
              "The idempotency key is already bound to a different product command.",
            ),
          );
        return Effect.succeed({ ...copy(committed), replayed: true });
      }),
    current: (workspaceId) => Effect.succeed(copy(history(workspaceId).at(-1))),
    commit: (change) =>
      Effect.gen(function* () {
        const key = `${change.model.workspaceId}\u0000${change.idempotencyKey}`;
        const committed = idempotency.get(key);
        if (committed !== undefined) {
          if (committed.commandHash !== change.commandHash)
            return yield* Effect.fail(
              new ProductCommandPersistenceError(
                "idempotency_conflict",
                "The idempotency key is already bound to a different product command.",
              ),
            );
          return { ...copy(committed), replayed: true };
        }

        const current = history(change.model.workspaceId).at(-1);
        const revision = current?.revision ?? 0;
        if (revision !== change.expectedRevision)
          return yield* Effect.fail(
            new ProductCommandPersistenceError(
              "stale_revision",
              `Expected product-model revision ${change.expectedRevision}; current revision is ${revision}.`,
            ),
          );
        if (
          change.model.revision !== revision + 1 ||
          change.audit.resultingRevision !== change.model.revision ||
          change.outbox.revision !== change.model.revision ||
          change.audit.eventId !== change.model.revisions.at(-1)?.eventId ||
          change.model.workspaceId !== change.audit.workspaceId ||
          change.model.workspaceId !== change.outbox.workspaceId
        )
          return yield* Effect.fail(
            new ProductCommandPersistenceError(
              "transaction_failed",
              "The product command transaction bundle is inconsistent.",
            ),
          );

        if (options?.beforeCommit !== undefined) yield* options.beforeCommit(copy(change));

        snapshots.set(change.model.workspaceId, [
          ...history(change.model.workspaceId),
          copy(change.model),
        ]);
        auditRows.set(change.model.workspaceId, [
          ...(auditRows.get(change.model.workspaceId) ?? []),
          copy(change.audit),
        ]);
        outboxRows.set(change.model.workspaceId, [
          ...(outboxRows.get(change.model.workspaceId) ?? []),
          copy(change.outbox),
        ]);
        idempotency.set(key, {
          commandHash: change.commandHash,
          revision: change.model.revision,
          eventId: change.audit.eventId,
          changedEntityIds: copy(change.responseEntityIds),
        });
        return {
          revision: change.model.revision,
          eventId: change.audit.eventId,
          changedEntityIds: copy(change.responseEntityIds),
          replayed: false,
        };
      }),
    history: (workspaceId) => copy(history(workspaceId)),
    audits: (workspaceId) => copy(auditRows.get(workspaceId) ?? []),
    outbox: (workspaceId) => copy(outboxRows.get(workspaceId) ?? []),
  };
};

import { Effect } from "effect";
import { type ProductModel, ProductModelError } from "../domain/product-model.ts";
import type { ProductModelRepository } from "../ports/product-model-repository.ts";

const clone = (model: ProductModel): ProductModel => structuredClone(model);
const failure = (message: string, reference?: string) =>
  Effect.fail(new ProductModelError("revision_conflict", message, reference));

const validateSnapshot = (model: ProductModel) =>
  model.revisions.length === model.revision &&
  model.revisions.every(
    ({ revision, validFrom, recordedAt }, index) =>
      revision === index + 1 &&
      Number.isFinite(Date.parse(validFrom)) &&
      Number.isFinite(Date.parse(recordedAt)),
  ) &&
  model.entities.every(({ workspaceId }) => workspaceId === model.workspaceId) &&
  model.relations.every(({ workspaceId }) => workspaceId === model.workspaceId) &&
  model.variants.every(({ workspaceId }) => workspaceId === model.workspaceId);

export const createInMemoryProductModelRepository = (): ProductModelRepository => {
  const snapshots = new Map<string, ProductModel[]>();

  const historyFor = (workspaceId: string) => snapshots.get(workspaceId) ?? [];
  const copy = (model: ProductModel | undefined) =>
    Effect.succeed(model === undefined ? undefined : clone(model));

  return {
    save: (model) =>
      Effect.suspend(() => {
        const history = historyFor(model.workspaceId);
        const previous = history.at(-1);
        const expectedRevision = previous === undefined ? 0 : previous.revision + 1;
        const currentValidFrom = model.revisions.at(-1)?.validFrom;
        const previousValidFrom = previous?.revisions.at(-1)?.validFrom;
        if (model.workspaceId.trim() === "" || !validateSnapshot(model))
          return failure("The product-model snapshot is structurally invalid.", model.workspaceId);
        if (model.revision !== expectedRevision)
          return failure(
            `Expected product-model revision ${expectedRevision}.`,
            String(model.revision),
          );
        if (
          previousValidFrom !== undefined &&
          currentValidFrom !== undefined &&
          Date.parse(currentValidFrom) < Date.parse(previousValidFrom)
        )
          return failure(
            "The in-memory fixture repository requires nondecreasing valid time.",
            currentValidFrom,
          );
        snapshots.set(model.workspaceId, [...history, clone(model)]);
        return Effect.void;
      }),
    current: (workspaceId) => copy(historyFor(workspaceId).at(-1)),
    atRevision: (workspaceId, revision) =>
      Number.isSafeInteger(revision) && revision >= 0
        ? copy(historyFor(workspaceId).find((model) => model.revision === revision))
        : Effect.fail(
            new ProductModelError(
              "invalid_input",
              "A non-negative integer revision is required.",
              String(revision),
            ),
          ),
    atValidTime: (workspaceId, validAt) => {
      const instant = Date.parse(validAt);
      if (!Number.isFinite(instant))
        return Effect.fail(
          new ProductModelError(
            "invalid_input",
            "A valid historical query instant is required.",
            validAt,
          ),
        );
      const eligible = historyFor(workspaceId).filter((model) => {
        const validFrom = model.revisions.at(-1)?.validFrom;
        return validFrom === undefined || Date.parse(validFrom) <= instant;
      });
      return copy(eligible.at(-1));
    },
  };
};

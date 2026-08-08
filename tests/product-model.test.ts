import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  attachProductEntityParent,
  createProductModel,
  moveProductEntity,
  type ProductEntityId,
  type ProductEntityKind,
  type ProductModel,
  type ProductModelChangeContext,
  parseProductEntityId,
  productParentId,
  registerProductEntity,
  renameProductEntity,
  resolveProductAlias,
} from "../src/modules/product-model/index.ts";

const ids = {
  product: "10000000-0000-4000-8000-000000000001",
  area: "20000000-0000-4000-8000-000000000002",
  capabilityA: "30000000-0000-4000-8000-000000000003",
  capabilityB: "40000000-0000-4000-8000-000000000004",
  feature: "50000000-0000-4000-8000-000000000005",
  extra: "60000000-0000-4000-8000-000000000006",
  skipped: "70000000-0000-4000-8000-000000000007",
} as const;

const entityId = (value: string) => Effect.runSync(parseProductEntityId(value));
const context = (sequence: number): ProductModelChangeContext => ({
  eventId: `synthetic-event-${sequence}`,
  actorId: "synthetic-product-owner",
  validFrom: `2026-01-${String(sequence).padStart(2, "0")}T00:00:00.000Z`,
  recordedAt: `2026-01-${String(sequence).padStart(2, "0")}T01:00:00.000Z`,
});

const register = (
  model: ProductModel,
  sequence: number,
  id: string,
  kind: ProductEntityKind,
  canonicalName: string,
  parentId?: ProductEntityId,
  allowSkippedLevel = false,
) =>
  Effect.runPromise(
    registerProductEntity(
      model,
      {
        id: entityId(id),
        kind,
        canonicalName,
        canonicalAliasId: `alias-${sequence}`,
        registration: "candidate",
        lifecycle: "planned",
        sensitivity: "public",
        audience: ["workspace-members"],
        ...(parentId === undefined ? {} : { parentId }),
        ...(allowSkippedLevel ? { allowSkippedLevel } : {}),
      },
      context(sequence),
    ),
  );

const baseModel = async () => {
  let model = createProductModel("synthetic-workspace");
  model = await register(model, 1, ids.product, "product", "Workspace Suite");
  model = await register(model, 2, ids.area, "area", "Content Operations", entityId(ids.product));
  model = await register(model, 3, ids.capabilityA, "capability", "Publishing", entityId(ids.area));
  model = await register(
    model,
    4,
    ids.capabilityB,
    "capability",
    "Distribution",
    entityId(ids.area),
  );
  return register(
    model,
    5,
    ids.feature,
    "feature",
    "Scheduled Publishing",
    entityId(ids.capabilityA),
  );
};

const errorCode = async (effect: Effect.Effect<unknown, { readonly code: string }>) => {
  const result = await Effect.runPromise(Effect.either(effect));
  expect(result._tag).toBe("Left");
  return result._tag === "Left" ? result.left.code : "unexpected-success";
};

describe("product model domain", () => {
  it("keeps opaque identity stable across rename and preserves both aliases", async () => {
    const before = await baseModel();
    const featureId = entityId(ids.feature);
    const after = await Effect.runPromise(
      renameProductEntity(
        before,
        {
          entityId: featureId,
          canonicalName: "Scheduled Release",
          canonicalAliasId: "alias-rename",
        },
        context(6),
      ),
    );

    expect(after.entities.find(({ id }) => id === featureId)?.canonicalName).toBe(
      "Scheduled Release",
    );
    expect(
      await Effect.runPromise(resolveProductAlias(after, "  Scheduled_Publishing  ", "feature")),
    ).toBe(featureId);
    expect(
      await Effect.runPromise(resolveProductAlias(after, "Scheduled Release", "feature")),
    ).toBe(featureId);
    expect(await errorCode(parseProductEntityId("scheduled-publishing"))).toBe("invalid_input");
    expect(after.identityEvents.map(({ type }) => type)).toEqual([
      "registered",
      "registered",
      "registered",
      "registered",
      "registered",
      "renamed",
    ]);
  });

  it("enforces one parent, kind compatibility, explicit skipped levels, and cycle rejection", async () => {
    let model = await baseModel();
    model = await register(model, 6, ids.extra, "feature", "Release Calendar");
    const attached = await Effect.runPromise(
      attachProductEntityParent(
        model,
        { childId: entityId(ids.extra), parentId: entityId(ids.capabilityA) },
        context(7),
      ),
    );

    expect(
      await errorCode(
        attachProductEntityParent(
          attached,
          { childId: entityId(ids.extra), parentId: entityId(ids.capabilityB) },
          context(8),
        ),
      ),
    ).toBe("parent_conflict");
    expect(
      await errorCode(
        moveProductEntity(
          model,
          { entityId: entityId(ids.capabilityB), newParentId: entityId(ids.feature) },
          context(8),
        ),
      ),
    ).toBe("kind_incompatible");
    expect(
      await errorCode(
        moveProductEntity(
          model,
          { entityId: entityId(ids.product), newParentId: entityId(ids.feature) },
          context(8),
        ),
      ),
    ).toBe("hierarchy_cycle");
    const moved = await Effect.runPromise(
      moveProductEntity(
        model,
        { entityId: entityId(ids.feature), newParentId: entityId(ids.capabilityB) },
        context(8),
      ),
    );
    expect(productParentId(moved, entityId(ids.feature))).toBe(entityId(ids.capabilityB));
    expect(
      await errorCode(
        registerProductEntity(
          model,
          {
            id: entityId(ids.skipped),
            kind: "feature",
            canonicalName: "Direct Release",
            canonicalAliasId: "alias-skipped",
            registration: "candidate",
            lifecycle: "planned",
            sensitivity: "public",
            audience: [],
            parentId: entityId(ids.product),
          },
          context(6),
        ),
      ),
    ).toBe("kind_incompatible");
    const skipped = await register(
      model,
      9,
      ids.skipped,
      "feature",
      "Direct Release",
      entityId(ids.product),
      true,
    );
    expect(productParentId(skipped, entityId(ids.skipped))).toBe(entityId(ids.product));
  });
});

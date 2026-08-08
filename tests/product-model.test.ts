import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  addProductRelation,
  attachProductEntityParent,
  changeProductEntityRegistration,
  moveProductEntity,
  parseProductEntityId,
  productParentId,
  registerProductEntity,
  renameProductEntity,
  resolveProductAlias,
  retireProductEntity,
} from "../src/modules/product-model/index.ts";
import {
  createBaseProductModelFixture as baseModel,
  productChangeContext as context,
  productEntityId as entityId,
  productFixtureIds as ids,
  registerFixtureProductEntity as register,
} from "./fixtures/product-model-fixture.ts";

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

  it("governs registration, supersession, and retirement without deleting identity", async () => {
    const before = await baseModel();
    const featureId = entityId(ids.feature);
    const ratified = await Effect.runPromise(
      changeProductEntityRegistration(
        before,
        { entityId: featureId, registration: "ratified" },
        context(6),
      ),
    );

    expect(ratified.entities.find(({ id }) => id === featureId)?.registration).toBe("ratified");
    expect(ratified.revisions.at(-1)?.eventType).toBe("registration_changed");
    expect(ratified.identityEvents).toHaveLength(before.identityEvents.length);
    expect(
      await errorCode(
        changeProductEntityRegistration(
          ratified,
          { entityId: featureId, registration: "candidate" },
          context(7),
        ),
      ),
    ).toBe("transition_invalid");
    expect(
      await errorCode(retireProductEntity(ratified, entityId(ids.capabilityA), context(7))),
    ).toBe("parent_conflict");

    const retired = await Effect.runPromise(retireProductEntity(ratified, featureId, context(7)));
    expect(retired.entities.find(({ id }) => id === featureId)?.lifecycle).toBe("retired");
    expect(productParentId(retired, featureId)).toBeUndefined();
    expect(await Effect.runPromise(resolveProductAlias(retired, "Scheduled Publishing"))).toBe(
      featureId,
    );
    expect(retired.identityEvents.at(-1)?.type).toBe("retired");

    const capabilityId = entityId(ids.capabilityB);
    const ratifiedCapability = await Effect.runPromise(
      changeProductEntityRegistration(
        before,
        { entityId: capabilityId, registration: "ratified" },
        context(6),
      ),
    );
    const superseded = await Effect.runPromise(
      changeProductEntityRegistration(
        ratifiedCapability,
        { entityId: capabilityId, registration: "superseded" },
        context(7),
      ),
    );
    expect(productParentId(superseded, capabilityId)).toBeUndefined();
    expect(superseded.identityEvents.at(-1)?.type).toBe("superseded");
  });

  it("enforces relation direction, endpoint compatibility, and symmetric uniqueness", async () => {
    const before = await baseModel();
    const capabilityA = entityId(ids.capabilityA);
    const capabilityB = entityId(ids.capabilityB);
    const common = {
      registration: "ratified" as const,
      sourceClass: "synthetic-fixture",
      sensitivity: "public" as const,
      audience: ["workspace-members"],
    };
    const related = await Effect.runPromise(
      addProductRelation(
        before,
        {
          ...common,
          id: "synthetic-relation-alternative",
          type: "alternative_to",
          source: { kind: "entity", entityId: capabilityA },
          target: { kind: "entity", entityId: capabilityB },
        },
        context(6),
      ),
    );

    expect(related.relations).toHaveLength(1);
    expect(related.revisions.at(-1)?.eventType).toBe("relation_added");
    expect(related.identityEvents).toHaveLength(before.identityEvents.length);
    expect(
      await errorCode(
        addProductRelation(
          related,
          {
            ...common,
            id: "synthetic-relation-reversed",
            type: "alternative_to",
            source: { kind: "entity", entityId: capabilityB },
            target: { kind: "entity", entityId: capabilityA },
          },
          context(7),
        ),
      ),
    ).toBe("relation_conflict");
    expect(
      await errorCode(
        addProductRelation(
          related,
          {
            ...common,
            id: "synthetic-relation-kind-mismatch",
            type: "alternative_to",
            source: { kind: "entity", entityId: capabilityA },
            target: { kind: "entity", entityId: entityId(ids.feature) },
          },
          context(7),
        ),
      ),
    ).toBe("relation_incompatible");

    const realized = await Effect.runPromise(
      addProductRelation(
        related,
        {
          ...common,
          id: "synthetic-relation-realization",
          type: "realized_by",
          source: { kind: "entity", entityId: entityId(ids.feature) },
          target: {
            kind: "external",
            referenceKind: "technical",
            referenceId: "synthetic-component",
          },
        },
        context(7),
      ),
    );
    expect(realized.relations.map(({ type }) => type)).toEqual(["alternative_to", "realized_by"]);
    expect(
      await errorCode(
        addProductRelation(
          related,
          {
            ...common,
            id: "synthetic-relation-wrong-direction",
            type: "realized_by",
            source: {
              kind: "external",
              referenceKind: "technical",
              referenceId: "synthetic-component",
            },
            target: { kind: "entity", entityId: entityId(ids.feature) },
          },
          context(7),
        ),
      ),
    ).toBe("relation_incompatible");
    expect(
      await errorCode(
        addProductRelation(
          related,
          {
            ...common,
            id: "synthetic-relation-wrong-external-kind",
            type: "realized_by",
            source: { kind: "entity", entityId: entityId(ids.feature) },
            target: {
              kind: "external",
              referenceKind: "evidence",
              referenceId: "synthetic-observation",
            },
          },
          context(7),
        ),
      ),
    ).toBe("relation_incompatible");

    const withThirdCapability = await register(
      before,
      6,
      ids.extra,
      "capability",
      "Analytics",
      entityId(ids.area),
    );
    const variantOf = await Effect.runPromise(
      addProductRelation(
        withThirdCapability,
        {
          ...common,
          id: "synthetic-variant-of",
          type: "variant_of",
          source: { kind: "entity", entityId: capabilityA },
          target: { kind: "entity", entityId: capabilityB },
        },
        context(7),
      ),
    );
    expect(
      await errorCode(
        addProductRelation(
          variantOf,
          {
            ...common,
            id: "synthetic-second-variant-of",
            type: "variant_of",
            source: { kind: "entity", entityId: capabilityA },
            target: { kind: "entity", entityId: entityId(ids.extra) },
          },
          context(8),
        ),
      ),
    ).toBe("relation_conflict");
  });
});

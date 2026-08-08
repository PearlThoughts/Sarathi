import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  addProductEntityAttachment,
  addProductRelation,
  addProductVariant,
  changeProductEntityRegistration,
  mergeProductEntities,
  productParentId,
  redirectProductEntity,
  resolveProductAlias,
  resolveProductEntityId,
} from "../src/modules/product-model/index.ts";
import {
  createBaseProductModelFixture,
  productChangeContext,
  productEntityId,
  productFixtureIds,
} from "./fixtures/product-model-fixture.ts";

const errorCode = async (effect: Effect.Effect<unknown, { readonly code: string }>) => {
  const result = await Effect.runPromise(Effect.either(effect));
  expect(result._tag).toBe("Left");
  return result._tag === "Left" ? result.left.code : "unexpected-success";
};

describe("product model identity evolution", () => {
  it("merges identities while transferring aliases, hierarchy, relations, variants, and references", async () => {
    let model = await createBaseProductModelFixture();
    const sourceId = productEntityId(productFixtureIds.capabilityA);
    const survivorId = productEntityId(productFixtureIds.capabilityB);
    model = await Effect.runPromise(
      changeProductEntityRegistration(
        model,
        { entityId: sourceId, registration: "ratified" },
        productChangeContext(6),
      ),
    );
    model = await Effect.runPromise(
      changeProductEntityRegistration(
        model,
        { entityId: survivorId, registration: "ratified" },
        productChangeContext(7),
      ),
    );
    model = await Effect.runPromise(
      addProductEntityAttachment(
        model,
        {
          id: "synthetic-claim-link",
          entityId: sourceId,
          kind: "claim",
          referenceId: "synthetic-claim",
          registration: "ratified",
          sourceClass: "synthetic-fixture",
          sensitivity: "public",
          audience: ["workspace-members"],
        },
        productChangeContext(8),
      ),
    );
    model = await Effect.runPromise(
      addProductEntityAttachment(
        model,
        {
          id: "synthetic-delivery-link",
          entityId: sourceId,
          kind: "delivery_reference",
          referenceId: "synthetic-delivery-record",
          registration: "candidate",
          sourceClass: "synthetic-fixture",
          sensitivity: "public",
          audience: [],
        },
        productChangeContext(9),
      ),
    );
    model = await Effect.runPromise(
      addProductRelation(
        model,
        {
          id: "synthetic-merge-relation",
          type: "depends_on",
          source: { kind: "entity", entityId: sourceId },
          target: { kind: "entity", entityId: productEntityId(productFixtureIds.product) },
          registration: "candidate",
          sourceClass: "synthetic-fixture",
          sensitivity: "public",
          audience: [],
        },
        productChangeContext(10),
      ),
    );
    model = await Effect.runPromise(
      addProductRelation(
        model,
        {
          id: "synthetic-collapsed-relation",
          type: "alternative_to",
          source: { kind: "entity", entityId: sourceId },
          target: { kind: "entity", entityId: survivorId },
          registration: "candidate",
          sourceClass: "synthetic-fixture",
          sensitivity: "public",
          audience: [],
        },
        productChangeContext(11),
      ),
    );
    model = await Effect.runPromise(
      addProductVariant(
        model,
        {
          id: "synthetic-merge-variant",
          baseEntityId: sourceId,
          qualifiers: { environment: "preview" },
          delta: { enabled: true },
          precedence: 1,
          registration: "ratified",
          sourceClass: "synthetic-fixture",
          sensitivity: "public",
          audience: [],
        },
        productChangeContext(12),
      ),
    );

    const merged = await Effect.runPromise(
      mergeProductEntities(model, { sourceIds: [sourceId], survivorId }, productChangeContext(13)),
    );

    expect(await Effect.runPromise(resolveProductEntityId(merged, sourceId))).toBe(survivorId);
    expect(await Effect.runPromise(resolveProductAlias(merged, "Publishing"))).toBe(survivorId);
    expect(productParentId(merged, productEntityId(productFixtureIds.feature))).toBe(survivorId);
    expect(merged.relations).toHaveLength(1);
    expect(merged.relations[0]?.source).toEqual({ kind: "entity", entityId: survivorId });
    expect(merged.variants[0]?.baseEntityId).toBe(survivorId);
    expect(merged.attachments.map(({ entityId }) => entityId)).toEqual([survivorId, survivorId]);
    expect(merged.entities.find(({ id }) => id === sourceId)?.registration).toBe("superseded");
    expect(merged.identityEvents.at(-1)?.type).toBe("merged");
    expect(merged.revisions.at(-1)?.eventType).toBe("merged");
  });

  it("creates a canonical redirect and rejects cycles, kind drift, and authority loss", async () => {
    const before = await createBaseProductModelFixture();
    const sourceId = productEntityId(productFixtureIds.capabilityA);
    const survivorId = productEntityId(productFixtureIds.capabilityB);
    const redirected = await Effect.runPromise(
      redirectProductEntity(
        before,
        { fromId: sourceId, toId: survivorId },
        productChangeContext(6),
      ),
    );

    expect(await Effect.runPromise(resolveProductEntityId(redirected, sourceId))).toBe(survivorId);
    expect(await Effect.runPromise(resolveProductAlias(redirected, "Publishing"))).toBe(survivorId);
    expect(redirected.identityEvents.at(-1)?.type).toBe("redirected");
    expect(
      await errorCode(
        addProductEntityAttachment(
          before,
          {
            id: "synthetic-premature-attachment",
            entityId: sourceId,
            kind: "claim",
            referenceId: "synthetic-premature-reference",
            registration: "ratified",
            sourceClass: "synthetic-fixture",
            sensitivity: "public",
            audience: [],
          },
          productChangeContext(6),
        ),
      ),
    ).toBe("transition_invalid");
    expect(
      await errorCode(
        redirectProductEntity(
          redirected,
          { fromId: survivorId, toId: sourceId },
          productChangeContext(7),
        ),
      ),
    ).toBe("redirect_cycle");
    expect(
      await errorCode(
        redirectProductEntity(
          before,
          { fromId: sourceId, toId: productEntityId(productFixtureIds.feature) },
          productChangeContext(6),
        ),
      ),
    ).toBe("identity_incompatible");

    const ratifiedSource = await Effect.runPromise(
      changeProductEntityRegistration(
        before,
        { entityId: sourceId, registration: "ratified" },
        productChangeContext(6),
      ),
    );
    expect(
      await errorCode(
        redirectProductEntity(
          ratifiedSource,
          { fromId: sourceId, toId: survivorId },
          productChangeContext(7),
        ),
      ),
    ).toBe("identity_incompatible");
    expect(
      await errorCode(
        addProductEntityAttachment(
          redirected,
          {
            id: "synthetic-retired-attachment",
            entityId: sourceId,
            kind: "claim",
            referenceId: "synthetic-retired-reference",
            registration: "candidate",
            sourceClass: "synthetic-fixture",
            sensitivity: "public",
            audience: [],
          },
          productChangeContext(7),
        ),
      ),
    ).toBe("entity_retired");
  });
});

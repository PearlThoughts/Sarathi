import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  addProductEntityAttachment,
  addProductRelation,
  addProductVariant,
  changeProductEntityRegistration,
  createProductModel,
  type ProductModel,
  type ProductSplitReferenceDisposition,
  productParentId,
  renameProductEntity,
  resolveProductAlias,
  resolveProductEntityId,
  splitProductEntity,
} from "../src/modules/product-model/index.ts";
import {
  createBaseProductModelFixture,
  productChangeContext,
  productEntityId,
  productFixtureIds,
  registerFixtureProductEntity,
} from "./fixtures/product-model-fixture.ts";

const errorCode = async (effect: Effect.Effect<unknown, { readonly code: string }>) => {
  const result = await Effect.runPromise(Effect.either(effect));
  expect(result._tag).toBe("Left");
  return result._tag === "Left" ? result.left.code : "unexpected-success";
};

const prepareSplitModel = async () => {
  let model = await createBaseProductModelFixture();
  const sourceId = productEntityId(productFixtureIds.capabilityA);
  model = await Effect.runPromise(
    changeProductEntityRegistration(
      model,
      { entityId: sourceId, registration: "ratified" },
      productChangeContext(6),
    ),
  );
  model = await Effect.runPromise(
    renameProductEntity(
      model,
      {
        entityId: sourceId,
        canonicalName: "Publishing Workflow",
        canonicalAliasId: "alias-split-source",
      },
      productChangeContext(7),
    ),
  );
  model = await Effect.runPromise(
    addProductVariant(
      model,
      {
        id: "synthetic-split-variant",
        baseEntityId: sourceId,
        qualifiers: { environment: "preview" },
        delta: { enabled: true },
        precedence: 1,
        registration: "ratified",
        sourceClass: "synthetic-fixture",
        sensitivity: "public",
        audience: [],
      },
      productChangeContext(8),
    ),
  );
  const relationDefaults = {
    registration: "candidate" as const,
    sourceClass: "synthetic-fixture",
    sensitivity: "public" as const,
    audience: [] as const,
  };
  model = await Effect.runPromise(
    addProductRelation(
      model,
      {
        ...relationDefaults,
        id: "synthetic-split-relation-source",
        type: "depends_on",
        source: { kind: "entity", entityId: sourceId },
        target: { kind: "entity", entityId: productEntityId(productFixtureIds.capabilityB) },
      },
      productChangeContext(9),
    ),
  );
  model = await Effect.runPromise(
    addProductRelation(
      model,
      {
        ...relationDefaults,
        id: "synthetic-split-relation-target",
        type: "depends_on",
        source: { kind: "entity", entityId: productEntityId(productFixtureIds.capabilityB) },
        target: { kind: "entity", entityId: sourceId },
      },
      productChangeContext(10),
    ),
  );
  const addAttachment = (
    current: ProductModel,
    sequence: number,
    id: string,
    kind: "claim" | "delivery_reference",
    registration: "ratified" | "candidate",
  ) =>
    Effect.runPromise(
      addProductEntityAttachment(
        current,
        {
          id,
          entityId: sourceId,
          kind,
          referenceId: `${id}-reference`,
          registration,
          sourceClass: "synthetic-fixture",
          sensitivity: "public",
          audience: [],
        },
        productChangeContext(sequence),
      ),
    );
  model = await addAttachment(model, 11, "synthetic-split-claim", "claim", "ratified");
  return addAttachment(model, 12, "synthetic-split-delivery", "delivery_reference", "candidate");
};

const targetA = productEntityId(productFixtureIds.extra);
const targetB = productEntityId(productFixtureIds.skipped);
const splitTargets = [
  {
    id: targetA,
    canonicalName: "Editorial Operations",
    canonicalAliasId: "alias-split-target-a",
    registration: "ratified" as const,
    lifecycle: "planned" as const,
    sensitivity: "public" as const,
    audience: ["workspace-members"],
  },
  {
    id: targetB,
    canonicalName: "Release Operations",
    canonicalAliasId: "alias-split-target-b",
    registration: "ratified" as const,
    lifecycle: "planned" as const,
    sensitivity: "public" as const,
    audience: ["workspace-members"],
  },
] as const;

const completeDisposition: readonly ProductSplitReferenceDisposition[] = [
  { kind: "alias", referenceId: "alias-3", action: "target", targetId: targetA },
  {
    kind: "alias",
    referenceId: "alias-split-source",
    action: "target",
    targetId: targetB,
  },
  {
    kind: "variant",
    referenceId: "synthetic-split-variant",
    action: "target",
    targetId: targetA,
  },
  {
    kind: "relation_source",
    referenceId: "synthetic-split-relation-source",
    action: "target",
    targetId: targetB,
  },
  {
    kind: "relation_target",
    referenceId: "synthetic-split-relation-target",
    action: "target",
    targetId: targetA,
  },
  {
    kind: "attachment",
    referenceId: "synthetic-split-claim",
    action: "target",
    targetId: targetA,
  },
  {
    kind: "attachment",
    referenceId: "synthetic-split-delivery",
    action: "orphan",
  },
  {
    kind: "child",
    referenceId: productFixtureIds.feature,
    action: "target",
    targetId: targetB,
  },
];

describe("product model split evolution", () => {
  it("requires and applies a complete disposition for every active reference", async () => {
    const before = await prepareSplitModel();
    const sourceId = productEntityId(productFixtureIds.capabilityA);
    expect(
      await errorCode(
        splitProductEntity(
          before,
          {
            sourceId,
            targets: splitTargets.map((target) =>
              target.id === targetA ? { ...target, registration: "candidate" } : target,
            ),
            sourceDisposition: { kind: "redirect", targetId: targetB },
            references: completeDisposition,
          },
          productChangeContext(13),
        ),
      ),
    ).toBe("identity_incompatible");
    expect(
      await errorCode(
        splitProductEntity(
          before,
          {
            sourceId,
            targets: splitTargets,
            sourceDisposition: { kind: "redirect", targetId: targetA },
            references: completeDisposition.slice(0, -1),
          },
          productChangeContext(13),
        ),
      ),
    ).toBe("disposition_incomplete");

    const split = await Effect.runPromise(
      splitProductEntity(
        before,
        {
          sourceId,
          targets: splitTargets,
          sourceDisposition: { kind: "redirect", targetId: targetA },
          references: completeDisposition,
        },
        productChangeContext(13),
      ),
    );

    expect(await Effect.runPromise(resolveProductEntityId(split, sourceId))).toBe(targetA);
    expect(await Effect.runPromise(resolveProductAlias(split, "Publishing"))).toBe(targetA);
    expect(await Effect.runPromise(resolveProductAlias(split, "Publishing Workflow"))).toBe(
      targetB,
    );
    expect(split.entities.find(({ id }) => id === sourceId)?.registration).toBe("superseded");
    expect(split.variants[0]?.baseEntityId).toBe(targetA);
    expect(
      split.relations.find(({ id }) => id === "synthetic-split-relation-source")?.source,
    ).toEqual({ kind: "entity", entityId: targetB });
    expect(
      split.relations.find(({ id }) => id === "synthetic-split-relation-target")?.target,
    ).toEqual({ kind: "entity", entityId: targetA });
    expect(split.attachments.map(({ id, entityId }) => ({ id, entityId }))).toEqual([
      { id: "synthetic-split-claim", entityId: targetA },
    ]);
    expect(split.orphans).toEqual([
      {
        workspaceId: "synthetic-workspace",
        sourceEntityId: sourceId,
        kind: "attachment",
        referenceId: "synthetic-split-delivery",
        createdRevision: 13,
      },
    ]);
    expect(productParentId(split, productEntityId(productFixtureIds.feature))).toBe(targetB);
    expect(productParentId(split, targetA)).toBe(productEntityId(productFixtureIds.area));
    expect(productParentId(split, targetB)).toBe(productEntityId(productFixtureIds.area));
    expect(split.identityEvents.at(-1)?.type).toBe("split");
    expect(split.revisions.at(-1)?.eventType).toBe("split");
  });

  it("can preserve the original as a contested shell only with a retained alias", async () => {
    let model = createProductModel("synthetic-shell-workspace");
    model = await registerFixtureProductEntity(
      model,
      1,
      productFixtureIds.product,
      "product",
      "Workspace Suite",
    );
    const sourceId = productEntityId(productFixtureIds.product);
    const split = await Effect.runPromise(
      splitProductEntity(
        model,
        {
          sourceId,
          targets: splitTargets.map((target) => ({ ...target, registration: "candidate" })),
          sourceDisposition: { kind: "contested_shell" },
          references: [{ kind: "alias", referenceId: "alias-1", action: "retain" }],
        },
        productChangeContext(2),
      ),
    );

    expect(split.entities.find(({ id }) => id === sourceId)?.registration).toBe("contested");
    expect(await Effect.runPromise(resolveProductEntityId(split, sourceId))).toBe(sourceId);
    expect(await Effect.runPromise(resolveProductAlias(split, "Workspace Suite"))).toBe(sourceId);
    expect(split.redirects).toHaveLength(0);
  });
});

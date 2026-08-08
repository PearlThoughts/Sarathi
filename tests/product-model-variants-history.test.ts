import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  type AddProductVariantInput,
  addProductVariant,
  changeProductEntityRegistration,
  createProductModel,
  type ProductModel,
  renameProductEntity,
  resolveProductVariant,
  retireProductEntity,
} from "../src/modules/product-model/index.ts";
import { createInMemoryProductModelRepository } from "../src/modules/product-model/infrastructure/memory-product-model-repository.ts";
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

const addVariant = (
  model: ProductModel,
  sequence: number,
  input: Pick<
    AddProductVariantInput,
    "id" | "registration" | "qualifiers" | "delta" | "precedence"
  > &
    Partial<Pick<AddProductVariantInput, "validTo">>,
) =>
  Effect.runPromise(
    addProductVariant(
      model,
      {
        ...input,
        baseEntityId: productEntityId(productFixtureIds.feature),
        sourceClass: "synthetic-fixture",
        sensitivity: "public",
        audience: ["workspace-members"],
      },
      productChangeContext(sequence),
    ),
  );

describe("product model variants and history", () => {
  it("composes ratified qualifiers per field and explains deterministic precedence", async () => {
    let model = await createBaseProductModelFixture();
    model = await addVariant(model, 6, {
      id: "variant-candidate",
      registration: "candidate",
      qualifiers: { environment: "staging" },
      delta: { candidateOnly: true },
      precedence: 100,
    });
    expect(
      await errorCode(
        resolveProductVariant(
          model,
          productEntityId(productFixtureIds.feature),
          { environment: "staging" },
          "2026-01-20T00:00:00.000Z",
        ),
      ),
    ).toBe("transition_invalid");
    expect(
      await errorCode(
        addProductVariant(
          model,
          {
            id: "variant-premature-ratification",
            baseEntityId: productEntityId(productFixtureIds.feature),
            registration: "ratified",
            qualifiers: { environment: "staging" },
            delta: { mode: "premature" },
            precedence: 1,
            sourceClass: "synthetic-fixture",
            sensitivity: "public",
            audience: [],
          },
          productChangeContext(7),
        ),
      ),
    ).toBe("transition_invalid");
    model = await Effect.runPromise(
      changeProductEntityRegistration(
        model,
        {
          entityId: productEntityId(productFixtureIds.feature),
          registration: "ratified",
        },
        productChangeContext(7),
      ),
    );
    model = await addVariant(model, 8, {
      id: "variant-expired",
      registration: "ratified",
      qualifiers: { brand: "classic" },
      delta: { expiredOnly: true },
      precedence: 1,
      validTo: "2026-01-10T00:00:00.000Z",
    });
    model = await addVariant(model, 9, {
      id: "variant-environment",
      registration: "ratified",
      qualifiers: { environment: "staging" },
      delta: { mode: "regional", retentionDays: 30 },
      precedence: 100,
    });
    model = await addVariant(model, 10, {
      id: "variant-flag",
      registration: "ratified",
      qualifiers: { feature_flag: "preview" },
      delta: { enabled: true },
      precedence: 10,
    });
    model = await addVariant(model, 11, {
      id: "variant-specific",
      registration: "ratified",
      qualifiers: { environment: "staging", feature_flag: "preview" },
      delta: { mode: "targeted" },
      precedence: 0,
    });

    const resolved = await Effect.runPromise(
      resolveProductVariant(
        model,
        productEntityId(productFixtureIds.feature),
        { brand: "classic", environment: "staging", feature_flag: "preview" },
        "2026-01-20T00:00:00.000Z",
      ),
    );

    expect(resolved.delta).toEqual({ enabled: true, mode: "targeted", retentionDays: 30 });
    expect(resolved.appliedVariantIds).toEqual([
      "variant-environment",
      "variant-flag",
      "variant-specific",
    ]);
    expect(resolved.appliedVariants).toEqual([
      {
        id: "variant-environment",
        qualifiers: { environment: "staging" },
        fields: ["retentionDays"],
      },
      {
        id: "variant-flag",
        qualifiers: { feature_flag: "preview" },
        fields: ["enabled"],
      },
      {
        id: "variant-specific",
        qualifiers: { environment: "staging", feature_flag: "preview" },
        fields: ["mode"],
      },
    ]);
  });

  it("fails when equally specific axes conflict instead of inventing a global axis ranking", async () => {
    let model = await createBaseProductModelFixture();
    model = await Effect.runPromise(
      changeProductEntityRegistration(
        model,
        {
          entityId: productEntityId(productFixtureIds.feature),
          registration: "ratified",
        },
        productChangeContext(6),
      ),
    );
    model = await addVariant(model, 7, {
      id: "variant-client",
      registration: "ratified",
      qualifiers: { client: "north" },
      delta: { mode: "client" },
      precedence: 5,
    });
    model = await addVariant(model, 8, {
      id: "variant-environment",
      registration: "ratified",
      qualifiers: { environment: "staging" },
      delta: { mode: "environment" },
      precedence: 5,
    });

    expect(
      await errorCode(
        resolveProductVariant(
          model,
          productEntityId(productFixtureIds.feature),
          { client: "north", environment: "staging" },
          "2026-01-20T00:00:00.000Z",
        ),
      ),
    ).toBe("variant_ambiguous");
  });

  it("stores isolated immutable snapshots and answers revision and valid-time history", async () => {
    const repository = createInMemoryProductModelRepository();
    const empty = createProductModel("history-workspace");
    await Effect.runPromise(repository.save(empty));
    const registered = await registerFixtureProductEntity(
      empty,
      1,
      productFixtureIds.product,
      "product",
      "Workspace Suite",
    );
    await Effect.runPromise(repository.save(registered));
    const renamed = await Effect.runPromise(
      renameProductEntity(
        registered,
        {
          entityId: productEntityId(productFixtureIds.product),
          canonicalName: "Workspace Hub",
          canonicalAliasId: "alias-history-rename",
        },
        productChangeContext(2),
      ),
    );
    await Effect.runPromise(repository.save(renamed));
    const backdated = await Effect.runPromise(
      renameProductEntity(
        renamed,
        {
          entityId: productEntityId(productFixtureIds.product),
          canonicalName: "Backdated Hub",
          canonicalAliasId: "alias-backdated-rename",
        },
        {
          ...productChangeContext(3),
          validFrom: "2026-01-01T12:00:00.000Z",
        },
      ),
    );
    expect(await errorCode(repository.save(backdated))).toBe("revision_conflict");
    const retired = await Effect.runPromise(
      retireProductEntity(
        renamed,
        productEntityId(productFixtureIds.product),
        productChangeContext(3),
      ),
    );
    await Effect.runPromise(repository.save(retired));

    const revisionOne = await Effect.runPromise(repository.atRevision("history-workspace", 1));
    const afterRename = await Effect.runPromise(
      repository.atValidTime("history-workspace", "2026-01-02T12:00:00.000Z"),
    );
    const beforeRegistration = await Effect.runPromise(
      repository.atValidTime("history-workspace", "2025-12-31T23:59:59.000Z"),
    );
    const current = await Effect.runPromise(repository.current("history-workspace"));

    expect(revisionOne?.entities[0]?.canonicalName).toBe("Workspace Suite");
    expect(afterRename?.entities[0]?.canonicalName).toBe("Workspace Hub");
    expect(beforeRegistration?.revision).toBe(0);
    expect(current?.entities[0]?.lifecycle).toBe("retired");
    expect(current?.identityEvents.map(({ type }) => type)).toEqual([
      "registered",
      "renamed",
      "retired",
    ]);
    expect(current).not.toBe(retired);
    expect(await Effect.runPromise(repository.current("another-workspace"))).toBeUndefined();
    expect(await errorCode(repository.save(retired))).toBe("revision_conflict");
  });
});

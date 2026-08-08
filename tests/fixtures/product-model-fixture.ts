import { Effect } from "effect";
import {
  createProductModel,
  type ProductEntityId,
  type ProductEntityKind,
  type ProductModel,
  type ProductModelChangeContext,
  parseProductEntityId,
  registerProductEntity,
} from "../../src/modules/product-model/index.ts";

export const productFixtureIds = {
  product: "10000000-0000-4000-8000-000000000001",
  area: "20000000-0000-4000-8000-000000000002",
  capabilityA: "30000000-0000-4000-8000-000000000003",
  capabilityB: "40000000-0000-4000-8000-000000000004",
  feature: "50000000-0000-4000-8000-000000000005",
  extra: "60000000-0000-4000-8000-000000000006",
  skipped: "70000000-0000-4000-8000-000000000007",
} as const;

export const productEntityId = (value: string) => Effect.runSync(parseProductEntityId(value));

export const productChangeContext = (sequence: number): ProductModelChangeContext => ({
  eventId: `synthetic-event-${sequence}`,
  actorId: "synthetic-product-owner",
  validFrom: `2026-01-${String(sequence).padStart(2, "0")}T00:00:00.000Z`,
  recordedAt: `2026-01-${String(sequence).padStart(2, "0")}T01:00:00.000Z`,
});

export const registerFixtureProductEntity = (
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
        id: productEntityId(id),
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
      productChangeContext(sequence),
    ),
  );

export const createBaseProductModelFixture = async () => {
  let model = createProductModel("synthetic-workspace");
  model = await registerFixtureProductEntity(
    model,
    1,
    productFixtureIds.product,
    "product",
    "Workspace Suite",
  );
  model = await registerFixtureProductEntity(
    model,
    2,
    productFixtureIds.area,
    "area",
    "Content Operations",
    productEntityId(productFixtureIds.product),
  );
  model = await registerFixtureProductEntity(
    model,
    3,
    productFixtureIds.capabilityA,
    "capability",
    "Publishing",
    productEntityId(productFixtureIds.area),
  );
  model = await registerFixtureProductEntity(
    model,
    4,
    productFixtureIds.capabilityB,
    "capability",
    "Distribution",
    productEntityId(productFixtureIds.area),
  );
  return registerFixtureProductEntity(
    model,
    5,
    productFixtureIds.feature,
    "feature",
    "Scheduled Publishing",
    productEntityId(productFixtureIds.capabilityA),
  );
};

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  parseProductModelCommand,
  productRelationPolicies,
  productVariantAxes,
} from "../src/modules/product-model/index.ts";

const workspaceId = "workspace-synthetic";
const entityA = "00000000-0000-4000-8000-000000000201";
const entityB = "00000000-0000-4000-8000-000000000202";
const entityC = "00000000-0000-4000-8000-000000000203";

const common = {
  workspaceId,
  expectedRevision: 4,
  idempotencyKey: "synthetic-command-transport-0001",
  justification: "The product owner approved this governed product change.",
  validFrom: "2026-01-02T00:00:00.000Z",
};

const mutationBodies = [
  {
    type: "ProposeEntity",
    targetId: entityC,
    payload: {
      kind: "feature",
      canonicalName: "Synthetic Feature",
      lifecycle: "planned",
      sensitivity: "internal",
      audience: ["workspace:synthetic"],
      canonicalAliasId: "alias-synthetic-feature",
      parentId: entityA,
    },
  },
  { type: "RatifyEntity", targetId: entityA },
  { type: "ContestEntity", targetId: entityA },
  {
    type: "RenameEntity",
    targetId: entityA,
    payload: { canonicalName: "Synthetic Capability", canonicalAliasId: "alias-rename" },
  },
  {
    type: "MoveEntity",
    targetId: entityA,
    payload: { newParentId: entityB, allowSkippedLevel: false },
  },
  {
    type: "AddRelation",
    payload: {
      id: "relation-synthetic",
      type: "depends_on",
      source: { kind: "entity", entityId: entityA },
      target: { kind: "entity", entityId: entityB },
      registration: "candidate",
      sourceClass: "product-studio",
      sensitivity: "internal",
      audience: ["workspace:synthetic"],
    },
  },
  { type: "RemoveRelation", payload: { relationId: "relation-synthetic" } },
  { type: "MergeEntities", targetId: entityA, payload: { sourceIds: [entityB] } },
  {
    type: "SplitEntity",
    payload: {
      sourceId: entityA,
      targets: [
        {
          id: entityB,
          canonicalName: "Synthetic Target One",
          canonicalAliasId: "alias-target-one",
          registration: "candidate",
          lifecycle: "planned",
          sensitivity: "internal",
          audience: ["workspace:synthetic"],
        },
        {
          id: entityC,
          canonicalName: "Synthetic Target Two",
          canonicalAliasId: "alias-target-two",
          registration: "candidate",
          lifecycle: "planned",
          sensitivity: "internal",
          audience: ["workspace:synthetic"],
        },
      ],
      sourceDisposition: { kind: "redirect", targetId: entityB },
      references: [
        {
          kind: "alias",
          referenceId: "alias-source",
          action: "target",
          targetId: entityB,
        },
      ],
    },
  },
  {
    type: "CreateVariant",
    payload: {
      id: "variant-synthetic",
      baseEntityId: entityA,
      qualifiers: { environment: "test" },
      delta: { availability: "limited" },
      precedence: 1,
      registration: "candidate",
      sourceClass: "product-studio",
      sensitivity: "internal",
      audience: ["workspace:synthetic"],
    },
  },
  {
    type: "ChangeVariantPrecedence",
    payload: { variantId: "variant-synthetic", precedence: 2 },
  },
  { type: "DeprecateEntity", targetId: entityA },
  { type: "RetireEntity", targetId: entityA },
  { type: "SupersedeEntity", targetId: entityA },
  {
    type: "PromoteAudience",
    targetId: entityA,
    payload: { audience: ["workspace:synthetic", "leadership:synthetic"] },
  },
] as const;

describe("product-model command transport", () => {
  it("parses the complete governed command vocabulary", async () => {
    const commands = [
      ...mutationBodies.map((body, index) => ({
        ...common,
        ...body,
        idempotencyKey: `${common.idempotencyKey}-${index}`,
      })),
      {
        ...common,
        type: "ResolveProposal",
        payload: { proposalId: "proposal-synthetic", resolution: mutationBodies[3] },
      },
    ];

    const parsed = await Promise.all(
      commands.map((command) => Effect.runPromise(parseProductModelCommand(command))),
    );

    expect(parsed.map(({ type }) => type)).toEqual([
      "ProposeEntity",
      "RatifyEntity",
      "ContestEntity",
      "RenameEntity",
      "MoveEntity",
      "AddRelation",
      "RemoveRelation",
      "MergeEntities",
      "SplitEntity",
      "CreateVariant",
      "ChangeVariantPrecedence",
      "DeprecateEntity",
      "RetireEntity",
      "SupersedeEntity",
      "PromoteAudience",
      "ResolveProposal",
    ]);
  });

  it("rejects fields outside the governed command contract", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        parseProductModelCommand({
          ...common,
          ...mutationBodies[3],
          actorId: "browser-selected-actor",
        }),
      ),
    );

    expect(result._tag).toBe("Left");
  });

  it("stays aligned with domain relation types and variant axes", async () => {
    const relation = mutationBodies[5];
    const variant = mutationBodies[9];

    for (const type of Object.keys(productRelationPolicies))
      await expect(
        Effect.runPromise(
          parseProductModelCommand({
            ...common,
            ...relation,
            payload: { ...relation.payload, type },
          }),
        ),
      ).resolves.toMatchObject({ type: "AddRelation", payload: { type } });

    for (const axis of productVariantAxes)
      await expect(
        Effect.runPromise(
          parseProductModelCommand({
            ...common,
            ...variant,
            payload: { ...variant.payload, qualifiers: { [axis]: "synthetic" } },
          }),
        ),
      ).resolves.toMatchObject({ type: "CreateVariant" });
  });
});

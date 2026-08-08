import { Effect } from "effect";
import { z } from "zod";
import { ValidationError } from "../../../domain/errors.ts";
import type { ProductModelCommand } from "../application/product-model-commands.ts";

const nonBlank = z.string().trim().min(1);
const entityId = z.uuid();
const registration = z.enum(["candidate", "ratified", "contested", "superseded"]);
const lifecycle = z.enum(["planned", "available", "deprecated", "retired", "unknown"]);
const sensitivity = z.enum(["public", "internal", "confidential", "restricted"]);
const audience = z.array(nonBlank).max(100);

const relationEndpoint = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entity"), entityId }).strict(),
  z
    .object({
      kind: z.literal("external"),
      referenceKind: z.enum([
        "delivery",
        "intent",
        "technical",
        "runtime",
        "evidence",
        "policy",
        "availability",
      ]),
      referenceId: nonBlank,
    })
    .strict(),
]);

const proposeEntityBody = z
  .object({
    type: z.literal("ProposeEntity"),
    targetId: entityId,
    payload: z
      .object({
        kind: z.enum(["product", "area", "capability", "feature"]),
        canonicalName: nonBlank,
        description: z.string().optional(),
        lifecycle,
        sensitivity,
        audience,
        canonicalAliasId: nonBlank,
        aliases: z
          .array(
            z
              .object({
                id: nonBlank,
                value: nonBlank,
                kind: z.enum(["alternate", "abbreviation"]),
                sourceClass: nonBlank.optional(),
              })
              .strict(),
          )
          .max(100)
          .optional(),
        parentId: entityId.optional(),
        allowSkippedLevel: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

const mutationBodySchemas = [
  proposeEntityBody,
  z.object({ type: z.literal("RatifyEntity"), targetId: entityId }).strict(),
  z.object({ type: z.literal("ContestEntity"), targetId: entityId }).strict(),
  z
    .object({
      type: z.literal("RenameEntity"),
      targetId: entityId,
      payload: z.object({ canonicalName: nonBlank, canonicalAliasId: nonBlank }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("MoveEntity"),
      targetId: entityId,
      payload: z
        .object({ newParentId: entityId, allowSkippedLevel: z.boolean().optional() })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("AddRelation"),
      payload: z
        .object({
          id: nonBlank,
          type: z.enum([
            "depends_on",
            "enables",
            "conflicts_with",
            "alternative_to",
            "supersedes",
            "implements",
            "contributes_to",
            "governed_by",
            "affected_by",
            "realized_by",
            "exposed_by",
            "configured_by",
            "deployed_as",
            "observed_by",
            "verified_by",
            "constrained_by",
            "available_to",
            "variant_of",
          ]),
          source: relationEndpoint,
          target: relationEndpoint,
          registration,
          sourceClass: nonBlank,
          sensitivity,
          audience,
          validTo: z.iso.datetime().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("RemoveRelation"),
      payload: z.object({ relationId: nonBlank }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("MergeEntities"),
      targetId: entityId,
      payload: z.object({ sourceIds: z.array(entityId).min(1).max(100) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("SplitEntity"),
      payload: z
        .object({
          sourceId: entityId,
          targets: z
            .array(
              z
                .object({
                  id: entityId,
                  canonicalName: nonBlank,
                  canonicalAliasId: nonBlank,
                  description: z.string().optional(),
                  registration,
                  lifecycle,
                  sensitivity,
                  audience,
                })
                .strict(),
            )
            .min(2)
            .max(100),
          sourceDisposition: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("redirect"), targetId: entityId }).strict(),
            z.object({ kind: z.literal("contested_shell") }).strict(),
          ]),
          references: z
            .array(
              z.discriminatedUnion("action", [
                z
                  .object({
                    kind: z.enum([
                      "alias",
                      "variant",
                      "relation_source",
                      "relation_target",
                      "attachment",
                      "child",
                    ]),
                    referenceId: nonBlank,
                    action: z.literal("target"),
                    targetId: entityId,
                  })
                  .strict(),
                z
                  .object({
                    kind: z.enum([
                      "alias",
                      "variant",
                      "relation_source",
                      "relation_target",
                      "attachment",
                      "child",
                    ]),
                    referenceId: nonBlank,
                    action: z.literal("retain"),
                  })
                  .strict(),
                z
                  .object({
                    kind: z.enum([
                      "alias",
                      "variant",
                      "relation_source",
                      "relation_target",
                      "attachment",
                      "child",
                    ]),
                    referenceId: nonBlank,
                    action: z.literal("orphan"),
                  })
                  .strict(),
              ]),
            )
            .max(500),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("CreateVariant"),
      payload: z
        .object({
          id: nonBlank,
          baseEntityId: entityId,
          qualifiers: z.partialRecord(
            z.enum([
              "client",
              "tenant",
              "brand",
              "role",
              "environment",
              "version",
              "build",
              "feature_flag",
            ]),
            nonBlank,
          ),
          delta: z.record(nonBlank, z.union([z.string(), z.number(), z.boolean(), z.null()])),
          precedence: z.number().int(),
          registration,
          sourceClass: nonBlank,
          sensitivity,
          audience,
          validTo: z.iso.datetime().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("ChangeVariantPrecedence"),
      payload: z.object({ variantId: nonBlank, precedence: z.number().int() }).strict(),
    })
    .strict(),
  z.object({ type: z.literal("DeprecateEntity"), targetId: entityId }).strict(),
  z.object({ type: z.literal("RetireEntity"), targetId: entityId }).strict(),
  z.object({ type: z.literal("SupersedeEntity"), targetId: entityId }).strict(),
  z
    .object({
      type: z.literal("PromoteAudience"),
      targetId: entityId,
      payload: z.object({ audience }).strict(),
    })
    .strict(),
] as const;

const mutationBody = z.discriminatedUnion("type", mutationBodySchemas);
const commandFields = {
  workspaceId: nonBlank,
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(8).max(200),
  justification: z.string().trim().min(8).max(4_000),
  validFrom: z.iso.datetime(),
  previewToken: nonBlank.max(4_000).optional(),
} as const;

const withCommandFields = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.object({ ...shape, ...commandFields }).strict();

const commandSchema = z.discriminatedUnion("type", [
  withCommandFields(mutationBodySchemas[0].shape),
  withCommandFields(mutationBodySchemas[1].shape),
  withCommandFields(mutationBodySchemas[2].shape),
  withCommandFields(mutationBodySchemas[3].shape),
  withCommandFields(mutationBodySchemas[4].shape),
  withCommandFields(mutationBodySchemas[5].shape),
  withCommandFields(mutationBodySchemas[6].shape),
  withCommandFields(mutationBodySchemas[7].shape),
  withCommandFields(mutationBodySchemas[8].shape),
  withCommandFields(mutationBodySchemas[9].shape),
  withCommandFields(mutationBodySchemas[10].shape),
  withCommandFields(mutationBodySchemas[11].shape),
  withCommandFields(mutationBodySchemas[12].shape),
  withCommandFields(mutationBodySchemas[13].shape),
  withCommandFields(mutationBodySchemas[14].shape),
  withCommandFields({
    type: z.literal("ResolveProposal"),
    payload: z.object({ proposalId: nonBlank, resolution: mutationBody }).strict(),
  }),
]);

export const parseProductModelCommand = (
  value: unknown,
): Effect.Effect<ProductModelCommand, ValidationError> =>
  Effect.try({
    try: () => commandSchema.parse(value) as ProductModelCommand,
    catch: () =>
      new ValidationError({
        message: "Product command body is invalid.",
        field: "body",
      }),
  });

import { z } from "zod";

const entityId = z.string().uuid();
const registration = z.enum(["candidate", "ratified", "contested", "superseded"]);
const lifecycle = z.enum(["planned", "available", "deprecated", "retired", "unknown"]);
const kind = z.enum(["product", "area", "capability", "feature"]);

export const productHierarchyNodeSchema = z
  .object({
    entityId,
    parentId: entityId.optional(),
    kind,
    canonicalName: z.string().min(1),
    description: z.string().optional(),
    registration,
    lifecycle,
    sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
    audience: z.array(z.string()),
    revision: z.number().int().nonnegative(),
    depth: z.number().int().nonnegative(),
  })
  .strict();

const relationEndpointSchema = z.union([
  z.object({ kind: z.literal("entity"), entityId }).strict(),
  z
    .object({
      kind: z.literal("external"),
      referenceKind: z.string().min(1),
      referenceId: z.string().min(1),
    })
    .strict(),
]);

const productRelationSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    type: z.string().min(1),
    source: relationEndpointSchema,
    target: relationEndpointSchema,
    registration,
    sourceClass: z.string().min(1),
    sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
    audience: z.array(z.string()),
    validFrom: z.string().datetime(),
    validTo: z.string().datetime().optional(),
    createdRevision: z.number().int().nonnegative(),
  })
  .strict();

export const productMapSchema = z
  .object({
    workspaceId: z.string().min(1),
    asOf: z.string().datetime(),
    revision: z.number().int().nonnegative(),
    entities: z.array(productHierarchyNodeSchema),
    relations: z.array(productRelationSchema),
    page: z
      .object({
        maximumDepth: z.number().int().positive(),
        maximumNodes: z.number().int().positive(),
        truncated: z.boolean(),
      })
      .strict(),
    relationPage: z
      .object({
        maximumRelations: z.number().int().positive(),
        truncated: z.boolean(),
      })
      .strict(),
    safeWarnings: z.array(z.string()),
  })
  .strict();

const productEntitySchema = z
  .object({
    id: entityId,
    workspaceId: z.string().min(1),
    kind,
    canonicalName: z.string().min(1),
    description: z.string().optional(),
    registration,
    lifecycle,
    sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
    audience: z.array(z.string()),
    createdRevision: z.number().int().nonnegative(),
    updatedRevision: z.number().int().nonnegative(),
  })
  .strict();

const productVariantSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    baseEntityId: entityId,
    qualifiers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    delta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    precedence: z.number().int(),
    registration,
    sourceClass: z.string().min(1),
    sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
    audience: z.array(z.string()),
    validFrom: z.string().datetime(),
    validTo: z.string().datetime().optional(),
    createdRevision: z.number().int().nonnegative(),
  })
  .strict();

const productClaimSchema = z
  .object({
    id: z.string().min(1),
    entityId,
    type: z.enum(["definition", "invariant", "exclusion", "availability", "behavior"]),
    predicate: z.string().min(1),
    value: z.unknown(),
    evidenceReferenceCount: z.number().int().nonnegative(),
    registration,
    sourceClass: z.string().min(1),
    sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
    audience: z.array(z.string()),
    validFrom: z.string().datetime(),
    validTo: z.string().datetime().optional(),
    createdRevision: z.number().int().nonnegative(),
  })
  .strict();

const productExternalReferenceSchema = z
  .object({
    id: z.string().min(1),
    entityId,
    kind: z.enum([
      "delivery",
      "intent",
      "technical",
      "runtime",
      "evidence",
      "policy",
      "availability",
    ]),
    sourceClass: z.string().min(1),
    externalId: z.string().min(1),
    canonicalUrl: z.string().url().optional(),
    sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
    audience: z.array(z.string()),
    modelEgress: z.enum(["allow", "redact", "approval-required", "block"]),
    validFrom: z.string().datetime(),
    validTo: z.string().datetime().optional(),
    createdRevision: z.number().int().nonnegative(),
  })
  .strict();

const productProposalSchema = z
  .object({
    id: z.string().min(1),
    commandType: z.string().min(1),
    targetEntityIds: z.array(entityId),
    expectedRevision: z.number().int().nonnegative(),
    state: z.enum(["pending", "approved", "rejected", "expired", "withdrawn"]),
    sourceClass: z.string().min(1),
    sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
    audience: z.array(z.string()),
    proposedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const productDossierSchema = z
  .object({
    workspaceId: z.string().min(1),
    asOf: z.string().datetime(),
    revision: z.number().int().nonnegative(),
    entity: productEntitySchema,
    aliases: z.array(
      z.object({
        id: z.string().min(1),
        entityId,
        value: z.string().min(1),
        normalizedValue: z.string(),
        kind: z.enum(["canonical", "former_name", "alternate", "abbreviation"]),
        sourceClass: z.string().optional(),
        createdRevision: z.number().int().nonnegative(),
      }),
    ),
    variants: z.array(productVariantSchema),
    claims: z.array(productClaimSchema),
    externalReferences: z.array(productExternalReferenceSchema),
    proposals: z.array(productProposalSchema),
    relations: z.array(productRelationSchema),
    safeWarnings: z.array(z.string()),
  })
  .strict();

export type ProductHierarchyNode = z.infer<typeof productHierarchyNodeSchema>;
export type ProductMap = z.infer<typeof productMapSchema>;
export type ProductDossier = z.infer<typeof productDossierSchema>;

type ProductMapRow = ProductHierarchyNode & {
  readonly path: readonly string[];
};

export const productMapRows = (map: ProductMap): readonly ProductMapRow[] => {
  const nodes = new Map(map.entities.map((node) => [node.entityId, node]));
  const pathFor = (node: ProductHierarchyNode): readonly string[] => {
    const path = [node.canonicalName];
    const visited = new Set([node.entityId]);
    let parentId = node.parentId;
    while (parentId !== undefined) {
      if (visited.has(parentId)) return ["Invalid hierarchy", ...path];
      visited.add(parentId);
      const parent = nodes.get(parentId);
      if (parent === undefined) return ["Unavailable parent", ...path];
      path.unshift(parent.canonicalName);
      parentId = parent.parentId;
    }
    return path;
  };
  return map.entities
    .map((node) => ({ ...node, path: pathFor(node) }))
    .toSorted(
      (left, right) =>
        left.path.join("\u0000").localeCompare(right.path.join("\u0000")) ||
        left.entityId.localeCompare(right.entityId),
    );
};

export const relationTypes = (map: ProductMap): readonly string[] =>
  [...new Set(map.relations.map(({ type }) => type))].toSorted();

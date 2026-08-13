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

export const productRelationSchema = z
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

export const productCoverageSchema = z
  .object({
    workspaceId: z.string().min(1),
    asOf: z.string().datetime(),
    revision: z.number().int().nonnegative(),
    items: z.array(
      z
        .object({
          entityId,
          canonicalName: z.string().min(1),
          kind,
          flags: z.array(z.string().min(1)),
          claimCount: z.number().int().nonnegative(),
          referenceCount: z.number().int().nonnegative(),
          variantCount: z.number().int().nonnegative(),
          updatedRevision: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    page: z
      .object({
        maximumItems: z.number().int().positive(),
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

export const productSubgraphSchema = z
  .object({
    workspaceId: z.string().min(1),
    asOf: z.string().datetime(),
    revision: z.number().int().nonnegative(),
    rootEntityId: entityId,
    ancestors: z.array(productHierarchyNodeSchema),
    descendants: z.array(productHierarchyNodeSchema),
    relations: z.array(productRelationSchema),
    pages: z
      .object({
        ancestors: z
          .object({
            maximumDepth: z.number().int().positive(),
            maximumNodes: z.number().int().positive(),
            truncated: z.boolean(),
          })
          .strict(),
        descendants: z
          .object({
            maximumDepth: z.number().int().positive(),
            maximumNodes: z.number().int().positive(),
            truncated: z.boolean(),
          })
          .strict(),
        relations: z
          .object({
            maximumRelations: z.number().int().positive(),
            truncated: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    safeWarnings: z.array(z.string()),
  })
  .strict();

const variantAxis = z.enum([
  "client",
  "tenant",
  "brand",
  "role",
  "environment",
  "version",
  "build",
  "feature_flag",
]);

export const productAvailabilitySchema = z
  .object({
    workspaceId: z.string().min(1),
    asOf: z.string().datetime(),
    revision: z.number().int().nonnegative(),
    entityId,
    lifecycle,
    resolvedVariant: z
      .object({
        entityId,
        qualifiers: z.partialRecord(variantAxis, z.string()),
        appliedVariantIds: z.array(z.string().min(1)),
        appliedVariants: z.array(
          z
            .object({
              id: z.string().min(1),
              qualifiers: z.partialRecord(variantAxis, z.string()),
              fields: z.array(z.string().min(1)),
            })
            .strict(),
        ),
        delta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      })
      .strict(),
    availabilityClaims: z.array(productClaimSchema),
    availabilityReferences: z.array(productExternalReferenceSchema),
    deliveryStages: z.array(z.unknown()),
    safeWarnings: z.array(z.string()),
  })
  .strict();

export const productEntityHistorySchema = z
  .object({
    workspaceId: z.string().min(1),
    asOf: z.string().datetime(),
    revision: z.number().int().nonnegative(),
    entityId,
    events: z.array(
      z
        .object({
          id: z.string().min(1),
          revision: z.number().int().nonnegative(),
          type: z.enum([
            "registered",
            "renamed",
            "moved",
            "redirected",
            "merged",
            "split",
            "retired",
            "superseded",
          ]),
          validFrom: z.string().datetime(),
          recordedAt: z.string().datetime(),
        })
        .strict(),
    ),
    page: z
      .object({
        maximumItems: z.number().int().positive(),
        truncated: z.boolean(),
      })
      .strict(),
    safeWarnings: z.array(z.string()),
  })
  .strict();

export const productDeliverySchema = z
  .object({
    workspaceId: z.string().min(1),
    entityId,
    asOf: z.string().datetime(),
    availability: z.enum(["available", "partial", "unavailable"]),
    stages: z.array(
      z
        .object({
          stage: z.enum([
            "proposed",
            "planned",
            "being_implemented",
            "implemented",
            "reviewed",
            "merged",
            "checked",
            "released",
            "migrated",
            "deployed",
            "compatible",
            "verified",
            "accepted",
            "impact_observed",
            "retired",
          ]),
          state: z.enum(["observed", "not_observed"]),
          supportingWorkCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    supportingWork: z.array(
      z
        .object({
          title: z.string().min(1),
          summary: z.string(),
          latestActivityAt: z.string().datetime(),
          lifecycle: z.enum([
            "scoped",
            "implementing",
            "development_ready",
            "qa",
            "production",
            "accepted",
          ]),
          blocked: z.boolean(),
          currentSprint: z.boolean(),
          recentlyCompletedSprint: z.boolean(),
          quarterRelevant: z.boolean(),
          sources: z.array(
            z.enum(["jira", "vault", "github", "teams", "email", "strategy", "telemetry"]),
          ),
          citations: z.array(
            z
              .object({
                source: z.enum([
                  "jira",
                  "vault",
                  "github",
                  "teams",
                  "email",
                  "strategy",
                  "telemetry",
                ]),
                url: z.string().url(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    sourceCoverage: z.array(
      z
        .object({
          source: z.enum(["jira", "vault", "github", "teams", "email", "strategy", "telemetry"]),
          available: z.boolean(),
          checkpointAt: z.string().datetime().optional(),
        })
        .strict(),
    ),
    truncated: z.boolean(),
    safeWarnings: z.array(z.string()),
  })
  .strict();

export const productRelationCatalogSchema = z
  .object({
    workspaceId: z.string().min(1),
    relations: z.array(
      z
        .object({
          type: z.string().min(1),
          label: z.string().min(1),
          reverseLabel: z.string().min(1),
          family: z.enum(["product", "delivery", "realization", "assurance", "variation"]),
          definition: z.string().min(1),
          directional: z.literal(true),
          lenses: z.array(z.string().min(1)),
        })
        .strict(),
    ),
  })
  .strict();

export type ProductHierarchyNode = z.infer<typeof productHierarchyNodeSchema>;
export type ProductMap = z.infer<typeof productMapSchema>;
export type ProductCoverage = z.infer<typeof productCoverageSchema>;
export type ProductDossier = z.infer<typeof productDossierSchema>;
export type ProductRelation = z.infer<typeof productRelationSchema>;
export type ProductSubgraph = z.infer<typeof productSubgraphSchema>;
export type ProductAvailability = z.infer<typeof productAvailabilitySchema>;
export type ProductEntityHistory = z.infer<typeof productEntityHistorySchema>;
export type ProductDelivery = z.infer<typeof productDeliverySchema>;
export type ProductRelationCatalog = z.infer<typeof productRelationCatalogSchema>;

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

type ProductExplorerRelatedEntity = {
  readonly id: string;
  readonly entityId?: string;
  readonly kind: ProductHierarchyNode["kind"] | "external";
  readonly label: string;
};

type ProductExplorerProjection = {
  readonly focus?: ProductHierarchyNode;
  readonly ancestors: readonly ProductHierarchyNode[];
  readonly children: readonly ProductHierarchyNode[];
  readonly relatedEntities: readonly ProductExplorerRelatedEntity[];
  readonly relations: ProductMap["relations"];
};

const compareProductNodes = (left: ProductHierarchyNode, right: ProductHierarchyNode): number =>
  left.canonicalName.localeCompare(right.canonicalName) ||
  left.entityId.localeCompare(right.entityId);

export const productExplorerSearch = (
  map: ProductMap,
  query: string,
  maximumResults = 8,
): readonly ProductHierarchyNode[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return [];

  return map.entities
    .filter((entity) =>
      `${entity.canonicalName}\n${entity.description ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    )
    .toSorted(compareProductNodes)
    .slice(0, maximumResults);
};

export const productExplorerProjection = (
  map: ProductMap,
  options: {
    readonly focusEntityId?: string;
    readonly includeRelations?: boolean;
    readonly relationType?: string;
  } = {},
): ProductExplorerProjection => {
  const entities = new Map(map.entities.map((entity) => [entity.entityId, entity]));
  const roots = map.entities
    .filter(({ parentId }) => parentId === undefined)
    .toSorted(compareProductNodes);
  const requestedFocus =
    options.focusEntityId === undefined ? undefined : entities.get(options.focusEntityId);
  const focus = requestedFocus ?? roots.find(({ kind }) => kind === "product") ?? roots[0];
  if (focus === undefined)
    return { ancestors: [], children: [], relatedEntities: [], relations: [] };

  const ancestors: ProductHierarchyNode[] = [];
  const visited = new Set([focus.entityId]);
  let parentId = focus.parentId;
  while (parentId !== undefined && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = entities.get(parentId);
    if (parent === undefined) break;
    ancestors.unshift(parent);
    parentId = parent.parentId;
  }

  const children = map.entities
    .filter(({ parentId: candidateParentId }) => candidateParentId === focus.entityId)
    .toSorted(compareProductNodes);
  const scope = new Set([focus.entityId, ...children.map(({ entityId }) => entityId)]);
  const endpointTouchesScope = (endpoint: ProductMap["relations"][number]["source"]): boolean =>
    endpoint.kind === "entity" && scope.has(endpoint.entityId);
  const relations =
    options.includeRelations === false
      ? []
      : map.relations.filter(
          (relation) =>
            (options.relationType === undefined || relation.type === options.relationType) &&
            (endpointTouchesScope(relation.source) || endpointTouchesScope(relation.target)),
        );

  const related = new Map<string, ProductExplorerRelatedEntity>();
  const includeRelatedEndpoint = (endpoint: ProductMap["relations"][number]["source"]) => {
    if (endpoint.kind === "external") {
      const id = `external:${endpoint.referenceKind}:${endpoint.referenceId}`;
      related.set(id, {
        id,
        kind: "external",
        label: endpoint.referenceKind.replaceAll("_", " "),
      });
      return;
    }
    if (scope.has(endpoint.entityId)) return;
    const entity = entities.get(endpoint.entityId);
    if (entity === undefined) return;
    related.set(entity.entityId, {
      id: entity.entityId,
      entityId: entity.entityId,
      kind: entity.kind,
      label: entity.canonicalName,
    });
  };
  for (const relation of relations) {
    includeRelatedEndpoint(relation.source);
    includeRelatedEndpoint(relation.target);
  }

  return {
    focus,
    ancestors,
    children,
    relatedEntities: [...related.values()].toSorted(
      (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
    ),
    relations,
  };
};

export const productMapMatching = (map: ProductMap, query: string | undefined): ProductMap => {
  const normalizedQuery = query?.trim().toLocaleLowerCase();
  if (normalizedQuery === undefined || normalizedQuery.length === 0) return map;

  const entities = new Map(map.entities.map((node) => [node.entityId, node]));
  const children = new Map<string, ProductHierarchyNode[]>();
  for (const node of map.entities) {
    if (node.parentId === undefined) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }

  const included = new Set<string>();
  const includeAncestors = (node: ProductHierarchyNode) => {
    let current: ProductHierarchyNode | undefined = node;
    while (current !== undefined && !included.has(current.entityId)) {
      included.add(current.entityId);
      current = current.parentId === undefined ? undefined : entities.get(current.parentId);
    }
  };
  const includeDescendants = (node: ProductHierarchyNode) => {
    for (const child of children.get(node.entityId) ?? []) {
      if (included.has(child.entityId)) continue;
      included.add(child.entityId);
      includeDescendants(child);
    }
  };

  for (const node of map.entities) {
    const searchable = `${node.canonicalName}\n${node.description ?? ""}`.toLocaleLowerCase();
    if (!searchable.includes(normalizedQuery)) continue;
    includeAncestors(node);
    includeDescendants(node);
  }

  const endpointIncluded = (endpoint: ProductMap["relations"][number]["source"]): boolean =>
    endpoint.kind === "external" || included.has(endpoint.entityId);

  return {
    ...map,
    entities: map.entities.filter(({ entityId }) => included.has(entityId)),
    relations: map.relations.filter(
      ({ source, target }) => endpointIncluded(source) && endpointIncluded(target),
    ),
  };
};

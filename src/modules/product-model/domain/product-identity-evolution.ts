import { Effect } from "effect";
import {
  type ProductEntity,
  type ProductEntityAttachment,
  type ProductEntityId,
  type ProductHierarchyEdge,
  type ProductIdentityEvent,
  type ProductIdentityEventType,
  type ProductModel,
  type ProductModelChangeContext,
  ProductModelError,
  type ProductModelErrorCode,
  type ProductRelation,
  type ProductRelationEndpoint,
  type ProductRevisionEventType,
  productRelationPolicies,
} from "./product-model.ts";

const failure = (code: ProductModelErrorCode, message: string, reference?: string) =>
  Effect.fail(new ProductModelError(code, message, reference));
const entityFor = (model: ProductModel, id: ProductEntityId) =>
  model.entities.find((entity) => entity.id === id);
const activeEntity = (entity: ProductEntity) =>
  entity.lifecycle !== "retired" && entity.registration !== "superseded";
const nonBlank = (value: string) => value.trim().length > 0;
const validInstant = (value: string) => Number.isFinite(Date.parse(value));

type EvolutionEvent =
  | Omit<
      ProductIdentityEvent,
      "id" | "workspaceId" | "revision" | "actorId" | "validFrom" | "recordedAt"
    >
  | { readonly type: Exclude<ProductRevisionEventType, ProductIdentityEventType> };

const commit = (
  model: ProductModel,
  context: ProductModelChangeContext,
  next: Omit<ProductModel, "revision" | "revisions" | "identityEvents">,
  event: EvolutionEvent,
): Effect.Effect<ProductModel, ProductModelError> => {
  if (
    !nonBlank(context.eventId) ||
    !nonBlank(context.actorId) ||
    !validInstant(context.validFrom) ||
    !validInstant(context.recordedAt)
  )
    return failure("invalid_input", "Product changes require an event, actor, and valid times.");
  if (model.revisions.some(({ eventId }) => eventId === context.eventId))
    return failure("entity_conflict", "Product change event IDs must be unique.", context.eventId);
  const revision = model.revision + 1;
  const identityEvent: ProductIdentityEvent | undefined =
    "entityIds" in event
      ? {
          ...event,
          id: context.eventId,
          workspaceId: model.workspaceId,
          revision,
          actorId: context.actorId,
          validFrom: context.validFrom,
          recordedAt: context.recordedAt,
        }
      : undefined;
  return Effect.succeed({
    ...next,
    revision,
    revisions: [
      ...model.revisions,
      {
        revision,
        eventId: context.eventId,
        eventType: event.type,
        actorId: context.actorId,
        validFrom: context.validFrom,
        recordedAt: context.recordedAt,
      },
    ],
    identityEvents:
      identityEvent === undefined ? model.identityEvents : [...model.identityEvents, identityEvent],
  });
};

const nextBase = (model: ProductModel) => ({
  workspaceId: model.workspaceId,
  entities: model.entities,
  aliases: model.aliases,
  hierarchy: model.hierarchy,
  relations: model.relations,
  variants: model.variants,
  attachments: model.attachments,
  redirects: model.redirects,
});

const endpointKey = (endpoint: ProductRelationEndpoint) =>
  endpoint.kind === "entity"
    ? `entity:${endpoint.entityId}`
    : `external:${endpoint.referenceKind}:${endpoint.referenceId}`;
const relationKey = (relation: ProductRelation) => {
  const endpoints = [endpointKey(relation.source), endpointKey(relation.target)];
  if (productRelationPolicies[relation.type].direction === "symmetric") endpoints.sort();
  return JSON.stringify([relation.type, ...endpoints]);
};
const dedupeRelations = (relations: readonly ProductRelation[]) => {
  const keys = new Set<string>();
  return relations.filter((relation) => {
    if (endpointKey(relation.source) === endpointKey(relation.target)) return false;
    const key = relationKey(relation);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
};
const rangesOverlap = (first: ProductRelation, second: ProductRelation) =>
  (first.validTo === undefined || Date.parse(first.validTo) > Date.parse(second.validFrom)) &&
  (second.validTo === undefined || Date.parse(second.validTo) > Date.parse(first.validFrom));
const hasCardinalityConflict = (relations: readonly ProductRelation[]) =>
  relations.some(
    (relation, index) =>
      relation.registration !== "superseded" &&
      productRelationPolicies[relation.type].cardinality === "many_to_one" &&
      relations
        .slice(0, index)
        .some(
          (candidate) =>
            candidate.registration !== "superseded" &&
            candidate.type === relation.type &&
            endpointKey(candidate.source) === endpointKey(relation.source) &&
            endpointKey(candidate.target) !== endpointKey(relation.target) &&
            rangesOverlap(candidate, relation),
        ),
  );

export const resolveProductEntityId = (
  model: ProductModel,
  entityId: ProductEntityId,
): Effect.Effect<ProductEntityId, ProductModelError> =>
  Effect.gen(function* () {
    let current = entityId;
    const visited = new Set<ProductEntityId>();
    while (true) {
      if (visited.has(current))
        return yield* failure("redirect_cycle", "Product redirects must remain acyclic.", current);
      if (entityFor(model, current) === undefined)
        return yield* failure("entity_not_found", "Product entity was not found.", current);
      visited.add(current);
      const next = model.redirects.find(({ fromId }) => fromId === current)?.toId;
      if (next === undefined) return current;
      current = next;
    }
  });

export type AddProductEntityAttachmentInput = Omit<
  ProductEntityAttachment,
  "workspaceId" | "createdRevision"
>;

export const addProductEntityAttachment = (
  model: ProductModel,
  input: AddProductEntityAttachmentInput,
  context: ProductModelChangeContext,
): Effect.Effect<ProductModel, ProductModelError> =>
  Effect.gen(function* () {
    const entity = entityFor(model, input.entityId);
    if (entity === undefined)
      return yield* failure("entity_not_found", "Attachment entity was not found.", input.entityId);
    if (!activeEntity(entity))
      return yield* failure("entity_retired", "An inactive entity cannot receive attachments.");
    if (input.registration === "ratified" && entity.registration !== "ratified")
      return yield* failure(
        "transition_invalid",
        "A ratified attachment requires a ratified entity.",
        input.entityId,
      );
    if (
      !nonBlank(input.id) ||
      !nonBlank(input.referenceId) ||
      !nonBlank(input.sourceClass) ||
      input.registration === "superseded" ||
      model.attachments.some(({ id }) => id === input.id)
    )
      return yield* failure("entity_conflict", "The product attachment is invalid.", input.id);
    return yield* commit(
      model,
      context,
      {
        ...nextBase(model),
        attachments: [
          ...model.attachments,
          {
            ...input,
            workspaceId: model.workspaceId,
            audience: [...new Set(input.audience)],
            createdRevision: model.revision + 1,
          },
        ],
      },
      { type: "attachment_added" },
    );
  });

const rewriteEndpoint = (
  endpoint: ProductRelationEndpoint,
  sources: ReadonlySet<ProductEntityId>,
  survivorId: ProductEntityId,
): ProductRelationEndpoint =>
  endpoint.kind === "entity" && sources.has(endpoint.entityId)
    ? { kind: "entity", entityId: survivorId }
    : endpoint;

const evolveToSurvivor = (
  model: ProductModel,
  sourceIds: readonly ProductEntityId[],
  survivorId: ProductEntityId,
  context: ProductModelChangeContext,
  type: "redirected" | "merged",
): Effect.Effect<ProductModel, ProductModelError> =>
  Effect.gen(function* () {
    const sources = new Set(sourceIds);
    if (sourceIds.length === 0 || sources.size !== sourceIds.length || sources.has(survivorId))
      return yield* failure("identity_incompatible", "Identity sources must be distinct.");
    const resolvedSurvivor = yield* resolveProductEntityId(model, survivorId);
    if (sources.has(resolvedSurvivor))
      return yield* failure("redirect_cycle", "The redirect would create a cycle.", survivorId);
    if (resolvedSurvivor !== survivorId)
      return yield* failure(
        "redirect_conflict",
        "The survivor must be a current canonical entity.",
        survivorId,
      );
    const survivor = entityFor(model, survivorId);
    if (survivor === undefined || !activeEntity(survivor))
      return yield* failure("entity_retired", "The survivor must be active.", survivorId);
    for (const sourceId of sourceIds) {
      const source = entityFor(model, sourceId);
      if (source === undefined)
        return yield* failure("entity_not_found", "Identity source was not found.", sourceId);
      if (!activeEntity(source))
        return yield* failure("entity_retired", "Identity sources must be active.", sourceId);
      if (source.kind !== survivor.kind)
        return yield* failure(
          "identity_incompatible",
          "Identity evolution requires matching entity kinds.",
          sourceId,
        );
      if (source.registration === "ratified" && survivor.registration !== "ratified")
        return yield* failure(
          "identity_incompatible",
          "Ratified identity requires a ratified survivor.",
          survivorId,
        );
    }
    const revision = model.revision + 1;
    const relations = dedupeRelations(
      model.relations.map((relation) => ({
        ...relation,
        source: rewriteEndpoint(relation.source, sources, survivorId),
        target: rewriteEndpoint(relation.target, sources, survivorId),
      })),
    );
    if (hasCardinalityConflict(relations))
      return yield* failure(
        "identity_incompatible",
        "Identity evolution would violate relation cardinality.",
        survivorId,
      );
    return yield* commit(
      model,
      context,
      {
        ...nextBase(model),
        entities: model.entities.map((entity) =>
          sources.has(entity.id)
            ? { ...entity, registration: "superseded", updatedRevision: revision }
            : entity.id === survivorId
              ? { ...entity, updatedRevision: revision }
              : entity,
        ),
        aliases: model.aliases.map((alias) =>
          sources.has(alias.entityId)
            ? {
                ...alias,
                entityId: survivorId,
                kind: alias.kind === "canonical" ? "former_name" : alias.kind,
              }
            : alias,
        ),
        hierarchy: model.hierarchy.flatMap((edge): ProductHierarchyEdge[] => {
          if (sources.has(edge.childId)) return [];
          return sources.has(edge.parentId)
            ? [{ ...edge, parentId: survivorId, createdRevision: revision }]
            : [edge];
        }),
        relations,
        variants: model.variants.map((variant) =>
          sources.has(variant.baseEntityId) ? { ...variant, baseEntityId: survivorId } : variant,
        ),
        attachments: model.attachments.map((attachment) =>
          sources.has(attachment.entityId) ? { ...attachment, entityId: survivorId } : attachment,
        ),
        redirects: [
          ...model.redirects
            .filter(({ fromId }) => !sources.has(fromId))
            .map((redirect) =>
              sources.has(redirect.toId) ? { ...redirect, toId: survivorId } : redirect,
            ),
          ...sourceIds.map((fromId) => ({
            workspaceId: model.workspaceId,
            fromId,
            toId: survivorId,
            createdRevision: revision,
          })),
        ],
      },
      {
        type,
        entityIds: [survivorId, ...sourceIds],
        details: { survivorId, sourceIds },
      },
    );
  });

export const redirectProductEntity = (
  model: ProductModel,
  input: { readonly fromId: ProductEntityId; readonly toId: ProductEntityId },
  context: ProductModelChangeContext,
) => evolveToSurvivor(model, [input.fromId], input.toId, context, "redirected");

export const mergeProductEntities = (
  model: ProductModel,
  input: { readonly sourceIds: readonly ProductEntityId[]; readonly survivorId: ProductEntityId },
  context: ProductModelChangeContext,
) => evolveToSurvivor(model, input.sourceIds, input.survivorId, context, "merged");

import { Effect } from "effect";
import {
  normalizeProductAlias,
  type ProductEntity,
  type ProductEntityAttachment,
  type ProductEntityId,
  type ProductHierarchyEdge,
  type ProductIdentityEvent,
  type ProductIdentityEventType,
  type ProductLifecycle,
  type ProductModel,
  type ProductModelChangeContext,
  ProductModelError,
  type ProductModelErrorCode,
  type ProductRegistration,
  type ProductRelation,
  type ProductRelationEndpoint,
  type ProductRevisionEventType,
  type ProductSplitReferenceKind,
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
  orphans: model.orphans,
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

export type SplitProductEntityTarget = {
  readonly id: ProductEntityId;
  readonly canonicalName: string;
  readonly canonicalAliasId: string;
  readonly description?: string | undefined;
  readonly registration: ProductRegistration;
  readonly lifecycle: ProductLifecycle;
  readonly sensitivity: ProductEntity["sensitivity"];
  readonly audience: readonly string[];
};
export type ProductSplitReferenceDisposition = {
  readonly kind: ProductSplitReferenceKind;
  readonly referenceId: string;
} & (
  | { readonly action: "target"; readonly targetId: ProductEntityId }
  | { readonly action: "retain" }
  | { readonly action: "orphan" }
);
export type SplitProductEntityInput = {
  readonly sourceId: ProductEntityId;
  readonly targets: readonly SplitProductEntityTarget[];
  readonly sourceDisposition:
    | { readonly kind: "redirect"; readonly targetId: ProductEntityId }
    | { readonly kind: "contested_shell" };
  readonly references: readonly ProductSplitReferenceDisposition[];
};

const referenceKey = (kind: ProductSplitReferenceKind, referenceId: string) =>
  `${kind}:${referenceId}`;
const activeAt = (
  value: {
    readonly registration: ProductRegistration;
    readonly validFrom: string;
    readonly validTo?: string | undefined;
  },
  instant: number,
) =>
  value.registration !== "superseded" &&
  Date.parse(value.validFrom) <= instant &&
  (value.validTo === undefined || Date.parse(value.validTo) > instant);

const splitReferences = (
  model: ProductModel,
  sourceId: ProductEntityId,
  validAt: string,
): readonly { readonly kind: ProductSplitReferenceKind; readonly referenceId: string }[] => {
  const instant = Date.parse(validAt);
  return [
    ...model.aliases
      .filter(({ entityId }) => entityId === sourceId)
      .map(({ id }) => ({ kind: "alias" as const, referenceId: id })),
    ...model.variants
      .filter((variant) => variant.baseEntityId === sourceId && activeAt(variant, instant))
      .map(({ id }) => ({ kind: "variant" as const, referenceId: id })),
    ...model.relations.flatMap((relation) => {
      if (!activeAt(relation, instant)) return [];
      const references: { kind: ProductSplitReferenceKind; referenceId: string }[] = [];
      if (relation.source.kind === "entity" && relation.source.entityId === sourceId)
        references.push({ kind: "relation_source", referenceId: relation.id });
      if (relation.target.kind === "entity" && relation.target.entityId === sourceId)
        references.push({ kind: "relation_target", referenceId: relation.id });
      return references;
    }),
    ...model.attachments
      .filter(
        (attachment) =>
          attachment.entityId === sourceId && attachment.registration !== "superseded",
      )
      .map(({ id }) => ({ kind: "attachment" as const, referenceId: id })),
    ...model.hierarchy
      .filter(({ parentId }) => parentId === sourceId)
      .filter(({ childId }) => {
        const child = entityFor(model, childId);
        return child !== undefined && activeEntity(child);
      })
      .map(({ childId }) => ({ kind: "child" as const, referenceId: childId })),
  ];
};

export const splitProductEntity = (
  model: ProductModel,
  input: SplitProductEntityInput,
  context: ProductModelChangeContext,
): Effect.Effect<ProductModel, ProductModelError> =>
  Effect.gen(function* () {
    if (!validInstant(context.validFrom))
      return yield* failure("invalid_input", "Split requires a valid business instant.");
    const source = entityFor(model, input.sourceId);
    if (source === undefined)
      return yield* failure("entity_not_found", "Split source was not found.", input.sourceId);
    if (!activeEntity(source) || model.redirects.some(({ fromId }) => fromId === input.sourceId))
      return yield* failure("entity_retired", "Split source must be current and active.");
    const targetIds = new Set(input.targets.map(({ id }) => id));
    const aliasIds = new Set(input.targets.map(({ canonicalAliasId }) => canonicalAliasId));
    const names = input.targets.map(({ canonicalName }) => normalizeProductAlias(canonicalName));
    if (
      input.targets.length < 2 ||
      targetIds.size !== input.targets.length ||
      aliasIds.size !== input.targets.length ||
      names.some((name) => name === "") ||
      new Set(names).size !== names.length ||
      input.targets.some(
        (target) =>
          target.id === input.sourceId ||
          !nonBlank(target.canonicalAliasId) ||
          target.registration === "superseded" ||
          target.lifecycle === "retired" ||
          model.entities.some(({ id }) => id === target.id) ||
          model.aliases.some(({ id }) => id === target.canonicalAliasId) ||
          model.aliases.some(
            (alias) =>
              alias.normalizedValue === normalizeProductAlias(target.canonicalName) &&
              entityFor(model, alias.entityId)?.kind === source.kind,
          ),
      )
    )
      return yield* failure("identity_incompatible", "Split targets are invalid.", input.sourceId);
    const redirectTargetId =
      input.sourceDisposition.kind === "redirect" ? input.sourceDisposition.targetId : undefined;
    if (
      redirectTargetId !== undefined &&
      (!targetIds.has(redirectTargetId) ||
        (source.registration === "ratified" &&
          input.targets.find(({ id }) => id === redirectTargetId)?.registration !== "ratified"))
    )
      return yield* failure("identity_incompatible", "Split redirect target is invalid.");
    const required = splitReferences(model, input.sourceId, context.validFrom);
    const requiredKeys = new Set(
      required.map(({ kind, referenceId }) => referenceKey(kind, referenceId)),
    );
    const suppliedKeys = input.references.map(({ kind, referenceId }) =>
      referenceKey(kind, referenceId),
    );
    if (
      new Set(suppliedKeys).size !== suppliedKeys.length ||
      requiredKeys.size !== suppliedKeys.length ||
      suppliedKeys.some((key) => !requiredKeys.has(key)) ||
      input.references.some(
        (reference) =>
          (reference.action === "target" && !targetIds.has(reference.targetId)) ||
          (reference.action === "retain" && input.sourceDisposition.kind === "redirect"),
      ) ||
      (input.sourceDisposition.kind === "contested_shell" &&
        !input.references.some(({ kind, action }) => kind === "alias" && action === "retain"))
    )
      return yield* failure(
        "disposition_incomplete",
        "Every active split reference requires one valid disposition.",
        input.sourceId,
      );
    const targetById = new Map(input.targets.map((target) => [target.id, target]));
    for (const reference of input.references) {
      if (reference.action !== "target") continue;
      const target = targetById.get(reference.targetId);
      const ratifiedReference =
        (reference.kind === "variant" &&
          model.variants.find(({ id }) => id === reference.referenceId)?.registration ===
            "ratified") ||
        ((reference.kind === "relation_source" || reference.kind === "relation_target") &&
          model.relations.find(({ id }) => id === reference.referenceId)?.registration ===
            "ratified") ||
        (reference.kind === "attachment" &&
          model.attachments.find(({ id }) => id === reference.referenceId)?.registration ===
            "ratified");
      if (ratifiedReference && target?.registration !== "ratified")
        return yield* failure(
          "identity_incompatible",
          "Ratified references require a ratified split target.",
          reference.referenceId,
        );
    }
    const revision = model.revision + 1;
    const dispositions = new Map(
      input.references.map((reference) => [
        referenceKey(reference.kind, reference.referenceId),
        reference,
      ]),
    );
    const dispositionFor = (kind: ProductSplitReferenceKind, referenceId: string) =>
      dispositions.get(referenceKey(kind, referenceId));
    const targetFor = (reference: ProductSplitReferenceDisposition | undefined) =>
      reference?.action === "target" ? reference.targetId : undefined;
    const targetEntities: ProductEntity[] = input.targets.map((target) => ({
      id: target.id,
      workspaceId: model.workspaceId,
      kind: source.kind,
      canonicalName: target.canonicalName.trim(),
      ...(target.description === undefined ? {} : { description: target.description }),
      registration: target.registration,
      lifecycle: target.lifecycle,
      sensitivity: target.sensitivity,
      audience: [...new Set(target.audience)],
      createdRevision: revision,
      updatedRevision: revision,
    }));
    const aliases = model.aliases.flatMap((alias) => {
      if (alias.entityId !== input.sourceId) return [alias];
      const disposition = dispositionFor("alias", alias.id);
      if (disposition === undefined) return [alias];
      if (disposition.action === "orphan") return [];
      const targetId = targetFor(disposition);
      return targetId === undefined
        ? [alias]
        : [
            {
              ...alias,
              entityId: targetId,
              kind: alias.kind === "canonical" ? ("former_name" as const) : alias.kind,
            },
          ];
    });
    const variants = model.variants.flatMap((variant) => {
      if (variant.baseEntityId !== input.sourceId) return [variant];
      const disposition = dispositionFor("variant", variant.id);
      if (disposition?.action === "orphan") return [];
      const targetId = targetFor(disposition);
      return [targetId === undefined ? variant : { ...variant, baseEntityId: targetId }];
    });
    const relations = dedupeRelations(
      model.relations.flatMap((relation) => {
        const sourceReference =
          relation.source.kind === "entity" && relation.source.entityId === input.sourceId
            ? dispositionFor("relation_source", relation.id)
            : undefined;
        const targetReference =
          relation.target.kind === "entity" && relation.target.entityId === input.sourceId
            ? dispositionFor("relation_target", relation.id)
            : undefined;
        if (sourceReference?.action === "orphan" || targetReference?.action === "orphan") return [];
        const sourceTarget = targetFor(sourceReference);
        const targetTarget = targetFor(targetReference);
        return [
          {
            ...relation,
            source:
              sourceTarget === undefined
                ? relation.source
                : { kind: "entity" as const, entityId: sourceTarget },
            target:
              targetTarget === undefined
                ? relation.target
                : { kind: "entity" as const, entityId: targetTarget },
          },
        ];
      }),
    );
    if (hasCardinalityConflict(relations))
      return yield* failure(
        "identity_incompatible",
        "Split disposition would violate relation cardinality.",
        input.sourceId,
      );
    const attachments = model.attachments.flatMap((attachment) => {
      if (attachment.entityId !== input.sourceId) return [attachment];
      const disposition = dispositionFor("attachment", attachment.id);
      if (disposition?.action === "orphan") return [];
      const targetId = targetFor(disposition);
      return [targetId === undefined ? attachment : { ...attachment, entityId: targetId }];
    });
    const sourceParentId = model.hierarchy.find(
      ({ childId }) => childId === input.sourceId,
    )?.parentId;
    const hierarchy = model.hierarchy
      .flatMap((edge): ProductHierarchyEdge[] => {
        if (edge.childId === input.sourceId && input.sourceDisposition.kind === "redirect")
          return [];
        if (edge.parentId !== input.sourceId) return [edge];
        const disposition = dispositionFor("child", edge.childId);
        if (disposition?.action === "orphan") return [];
        const targetId = targetFor(disposition);
        return targetId === undefined
          ? [edge]
          : [{ ...edge, parentId: targetId, createdRevision: revision }];
      })
      .concat(
        sourceParentId === undefined
          ? []
          : input.targets.map(({ id }) => ({
              childId: id,
              parentId: sourceParentId,
              createdRevision: revision,
            })),
      );
    const orphaned = input.references.filter(({ action }) => action === "orphan");
    const sourceRegistration: ProductRegistration =
      input.sourceDisposition.kind === "redirect" ? "superseded" : "contested";
    return yield* commit(
      model,
      context,
      {
        ...nextBase(model),
        entities: [
          ...model.entities.map((entity) =>
            entity.id === input.sourceId
              ? { ...entity, registration: sourceRegistration, updatedRevision: revision }
              : entity,
          ),
          ...targetEntities,
        ],
        aliases: [
          ...aliases,
          ...input.targets.map((target) => ({
            id: target.canonicalAliasId,
            entityId: target.id,
            value: target.canonicalName.trim(),
            normalizedValue: normalizeProductAlias(target.canonicalName),
            kind: "canonical" as const,
            createdRevision: revision,
          })),
        ],
        hierarchy,
        relations,
        variants,
        attachments,
        redirects:
          redirectTargetId === undefined
            ? model.redirects
            : [
                ...model.redirects.map((redirect) =>
                  redirect.toId === input.sourceId
                    ? { ...redirect, toId: redirectTargetId }
                    : redirect,
                ),
                {
                  workspaceId: model.workspaceId,
                  fromId: input.sourceId,
                  toId: redirectTargetId,
                  createdRevision: revision,
                },
              ],
        orphans: [
          ...model.orphans,
          ...orphaned.map(({ kind, referenceId }) => ({
            workspaceId: model.workspaceId,
            sourceEntityId: input.sourceId,
            kind,
            referenceId,
            createdRevision: revision,
          })),
        ],
      },
      {
        type: "split",
        entityIds: [input.sourceId, ...input.targets.map(({ id }) => id)],
        details: {
          sourceDisposition: input.sourceDisposition.kind,
          targetIds: input.targets.map(({ id }) => id),
          orphaned: orphaned.map(({ kind, referenceId }) => referenceKey(kind, referenceId)),
          retained: input.references
            .filter(({ action }) => action === "retain")
            .map(({ kind, referenceId }) => referenceKey(kind, referenceId)),
        },
      },
    );
  });

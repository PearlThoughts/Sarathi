import { Effect } from "effect";
import type { SensitivityTier } from "../../../domain/policy.ts";

declare const productEntityIdBrand: unique symbol;

export type ProductEntityId = string & { readonly [productEntityIdBrand]: true };
export type ProductEntityKind = "product" | "area" | "capability" | "feature";
export type ProductRegistration = "candidate" | "ratified" | "contested" | "superseded";
export type ProductLifecycle = "planned" | "available" | "deprecated" | "retired" | "unknown";

export type ProductEntity = {
  readonly id: ProductEntityId;
  readonly workspaceId: string;
  readonly kind: ProductEntityKind;
  readonly canonicalName: string;
  readonly description?: string | undefined;
  readonly registration: ProductRegistration;
  readonly lifecycle: ProductLifecycle;
  readonly sensitivity: SensitivityTier;
  readonly audience: readonly string[];
  readonly createdRevision: number;
  readonly updatedRevision: number;
};

export type ProductEntityAlias = {
  readonly id: string;
  readonly entityId: ProductEntityId;
  readonly value: string;
  readonly normalizedValue: string;
  readonly kind: "canonical" | "former_name" | "alternate" | "abbreviation";
  readonly sourceClass?: string | undefined;
  readonly createdRevision: number;
};

export type ProductHierarchyEdge = {
  readonly childId: ProductEntityId;
  readonly parentId: ProductEntityId;
  readonly createdRevision: number;
};

export type ProductIdentityEventType = "registered" | "renamed" | "moved";

export type ProductIdentityEvent = {
  readonly id: string;
  readonly workspaceId: string;
  readonly revision: number;
  readonly type: ProductIdentityEventType;
  readonly entityIds: readonly ProductEntityId[];
  readonly details: Readonly<Record<string, string | readonly string[]>>;
  readonly actorId: string;
  readonly validFrom: string;
  readonly recordedAt: string;
};

export type ProductRevision = {
  readonly revision: number;
  readonly eventId: string;
  readonly eventType: ProductIdentityEventType;
  readonly actorId: string;
  readonly validFrom: string;
  readonly recordedAt: string;
};

export type ProductModel = {
  readonly workspaceId: string;
  readonly revision: number;
  readonly entities: readonly ProductEntity[];
  readonly aliases: readonly ProductEntityAlias[];
  readonly hierarchy: readonly ProductHierarchyEdge[];
  readonly revisions: readonly ProductRevision[];
  readonly identityEvents: readonly ProductIdentityEvent[];
};

export type ProductModelChangeContext = {
  readonly eventId: string;
  readonly actorId: string;
  readonly validFrom: string;
  readonly recordedAt: string;
};

export type ProductModelErrorCode =
  | "invalid_input"
  | "entity_not_found"
  | "entity_conflict"
  | "entity_retired"
  | "alias_conflict"
  | "parent_conflict"
  | "kind_incompatible"
  | "hierarchy_cycle"
  | "no_change";

export class ProductModelError extends Error {
  readonly _tag = "ProductModelError";

  constructor(
    readonly code: ProductModelErrorCode,
    message: string,
    readonly reference?: string | undefined,
  ) {
    super(message);
    this.name = "ProductModelError";
  }
}

const failure = (
  code: ProductModelErrorCode,
  message: string,
  reference?: string,
): Effect.Effect<never, ProductModelError> =>
  Effect.fail(new ProductModelError(code, message, reference));

const opaqueIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const parseProductEntityId = (
  value: string,
): Effect.Effect<ProductEntityId, ProductModelError> =>
  opaqueIdPattern.test(value)
    ? Effect.succeed(value as ProductEntityId)
    : failure("invalid_input", "Product entity IDs must be opaque UUIDs.", value);

export const normalizeProductAlias = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

export const createProductModel = (workspaceId: string): ProductModel => ({
  workspaceId,
  revision: 0,
  entities: [],
  aliases: [],
  hierarchy: [],
  revisions: [],
  identityEvents: [],
});

const entityFor = (model: ProductModel, id: ProductEntityId) =>
  model.entities.find((entity) => entity.id === id);
const parentFor = (model: ProductModel, id: ProductEntityId) =>
  model.hierarchy.find((edge) => edge.childId === id)?.parentId;
const activeEntity = (entity: ProductEntity) =>
  entity.lifecycle !== "retired" && entity.registration !== "superseded";
const nonBlank = (value: string) => value.trim().length > 0;
const validInstant = (value: string) => Number.isFinite(Date.parse(value));

const validateContext = (
  model: ProductModel,
  context: ProductModelChangeContext,
): Effect.Effect<void, ProductModelError> => {
  if (
    !nonBlank(context.eventId) ||
    !nonBlank(context.actorId) ||
    !validInstant(context.validFrom) ||
    !validInstant(context.recordedAt)
  )
    return failure("invalid_input", "Product changes require an event, actor, and valid times.");
  if (model.identityEvents.some(({ id }) => id === context.eventId))
    return failure("entity_conflict", "Product change event IDs must be unique.", context.eventId);
  return Effect.void;
};

const commit = (
  model: ProductModel,
  context: ProductModelChangeContext,
  next: Omit<ProductModel, "revision" | "revisions" | "identityEvents">,
  event: Omit<
    ProductIdentityEvent,
    "id" | "workspaceId" | "revision" | "actorId" | "validFrom" | "recordedAt"
  >,
): Effect.Effect<ProductModel, ProductModelError> =>
  validateContext(model, context).pipe(
    Effect.map((): ProductModel => {
      const revision = model.revision + 1;
      const identityEvent: ProductIdentityEvent = {
        ...event,
        id: context.eventId,
        workspaceId: model.workspaceId,
        revision,
        actorId: context.actorId,
        validFrom: context.validFrom,
        recordedAt: context.recordedAt,
      };
      return {
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
        identityEvents: [...model.identityEvents, identityEvent],
      };
    }),
  );

const nextBase = (model: ProductModel) => ({
  workspaceId: model.workspaceId,
  entities: model.entities,
  aliases: model.aliases,
  hierarchy: model.hierarchy,
});

const aliasConflict = (
  model: ProductModel,
  entityId: ProductEntityId,
  kind: ProductEntityKind,
  value: string,
) => {
  const normalized = normalizeProductAlias(value);
  return model.aliases.some(
    (alias) =>
      alias.entityId !== entityId &&
      alias.normalizedValue === normalized &&
      entityFor(model, alias.entityId)?.kind === kind,
  );
};

const kindDepth: Readonly<Record<ProductEntityKind, number>> = {
  product: 0,
  area: 1,
  capability: 2,
  feature: 3,
};

const createsHierarchyCycle = (
  model: ProductModel,
  childId: ProductEntityId,
  parentId: ProductEntityId,
) => {
  let current: ProductEntityId | undefined = parentId;
  const visited = new Set<ProductEntityId>();
  while (current !== undefined && !visited.has(current)) {
    if (current === childId) return true;
    visited.add(current);
    current = parentFor(model, current);
  }
  return false;
};

const validateParent = (
  model: ProductModel,
  child: ProductEntity,
  parentId: ProductEntityId,
  allowSkippedLevel: boolean,
): Effect.Effect<void, ProductModelError> =>
  Effect.gen(function* () {
    if (!activeEntity(child))
      return yield* failure(
        "entity_retired",
        "A retired entity cannot enter the active hierarchy.",
        child.id,
      );
    const parent = entityFor(model, parentId);
    if (parent === undefined)
      return yield* failure("entity_not_found", "Parent entity was not found.", parentId);
    if (!activeEntity(parent))
      return yield* failure("entity_retired", "A retired entity cannot be a parent.", parentId);
    if (createsHierarchyCycle(model, child.id, parentId))
      return yield* failure(
        "hierarchy_cycle",
        "The primary hierarchy must remain acyclic.",
        child.id,
      );
    const distance = kindDepth[child.kind] - kindDepth[parent.kind];
    if (distance < 1 || (distance > 1 && !allowSkippedLevel))
      return yield* failure(
        "kind_incompatible",
        "The parent and child kinds are incompatible.",
        child.id,
      );
  });

export type RegisterProductEntityInput = Omit<
  ProductEntity,
  "workspaceId" | "createdRevision" | "updatedRevision"
> & {
  readonly canonicalAliasId: string;
  readonly aliases?: readonly {
    readonly id: string;
    readonly value: string;
    readonly kind: "alternate" | "abbreviation";
    readonly sourceClass?: string | undefined;
  }[];
  readonly parentId?: ProductEntityId | undefined;
  readonly allowSkippedLevel?: boolean | undefined;
};

export const registerProductEntity = (
  model: ProductModel,
  input: RegisterProductEntityInput,
  context: ProductModelChangeContext,
): Effect.Effect<ProductModel, ProductModelError> =>
  Effect.gen(function* () {
    if (
      !nonBlank(model.workspaceId) ||
      !nonBlank(input.canonicalName) ||
      !nonBlank(input.canonicalAliasId) ||
      model.entities.some(({ id }) => id === input.id)
    )
      return yield* failure(
        "entity_conflict",
        "Product entity identity or name is invalid.",
        input.id,
      );
    const proposedAliases = [
      { id: input.canonicalAliasId, value: input.canonicalName, kind: "canonical" as const },
      ...(input.aliases ?? []),
    ];
    if (
      new Set(proposedAliases.map(({ id }) => id)).size !== proposedAliases.length ||
      proposedAliases.some(({ id }) => model.aliases.some((alias) => alias.id === id)) ||
      proposedAliases.some(({ id, value }) => !nonBlank(id) || !nonBlank(value)) ||
      proposedAliases.some(({ value }) => aliasConflict(model, input.id, input.kind, value))
    )
      return yield* failure(
        "alias_conflict",
        "Product aliases must be non-blank and unambiguous.",
        input.id,
      );
    const revision = model.revision + 1;
    const entity: ProductEntity = {
      id: input.id,
      workspaceId: model.workspaceId,
      kind: input.kind,
      canonicalName: input.canonicalName.trim(),
      ...(input.description === undefined ? {} : { description: input.description }),
      registration: input.registration,
      lifecycle: input.lifecycle,
      sensitivity: input.sensitivity,
      audience: [...new Set(input.audience)],
      createdRevision: revision,
      updatedRevision: revision,
    };
    if (input.parentId !== undefined)
      yield* validateParent(model, entity, input.parentId, input.allowSkippedLevel === true);
    return yield* commit(
      model,
      context,
      {
        ...nextBase(model),
        entities: [...model.entities, entity],
        aliases: [
          ...model.aliases,
          ...proposedAliases.map((alias) => ({
            ...alias,
            entityId: input.id,
            normalizedValue: normalizeProductAlias(alias.value),
            createdRevision: revision,
          })),
        ],
        hierarchy:
          input.parentId === undefined
            ? model.hierarchy
            : [
                ...model.hierarchy,
                { childId: input.id, parentId: input.parentId, createdRevision: revision },
              ],
      },
      { type: "registered", entityIds: [input.id], details: { name: entity.canonicalName } },
    );
  });

export const attachProductEntityParent = (
  model: ProductModel,
  input: {
    readonly childId: ProductEntityId;
    readonly parentId: ProductEntityId;
    readonly allowSkippedLevel?: boolean;
  },
  context: ProductModelChangeContext,
): Effect.Effect<ProductModel, ProductModelError> =>
  Effect.gen(function* () {
    const child = entityFor(model, input.childId);
    if (child === undefined)
      return yield* failure("entity_not_found", "Child entity was not found.", input.childId);
    if (parentFor(model, input.childId) !== undefined)
      return yield* failure(
        "parent_conflict",
        "A structural entity can have only one active parent.",
        input.childId,
      );
    yield* validateParent(model, child, input.parentId, input.allowSkippedLevel === true);
    const revision = model.revision + 1;
    return yield* commit(
      model,
      context,
      {
        ...nextBase(model),
        hierarchy: [
          ...model.hierarchy,
          { childId: input.childId, parentId: input.parentId, createdRevision: revision },
        ],
      },
      { type: "moved", entityIds: [input.childId], details: { newParentId: input.parentId } },
    );
  });

export const moveProductEntity = (
  model: ProductModel,
  input: {
    readonly entityId: ProductEntityId;
    readonly newParentId: ProductEntityId;
    readonly allowSkippedLevel?: boolean;
  },
  context: ProductModelChangeContext,
): Effect.Effect<ProductModel, ProductModelError> =>
  Effect.gen(function* () {
    const entity = entityFor(model, input.entityId);
    if (entity === undefined)
      return yield* failure("entity_not_found", "Product entity was not found.", input.entityId);
    if (!activeEntity(entity))
      return yield* failure("entity_retired", "A retired entity cannot be moved.", input.entityId);
    const formerParentId = parentFor(model, input.entityId);
    if (formerParentId === input.newParentId)
      return yield* failure(
        "no_change",
        "The product entity already has that parent.",
        input.entityId,
      );
    yield* validateParent(model, entity, input.newParentId, input.allowSkippedLevel === true);
    const revision = model.revision + 1;
    return yield* commit(
      model,
      context,
      {
        ...nextBase(model),
        hierarchy: [
          ...model.hierarchy.filter(({ childId }) => childId !== input.entityId),
          { childId: input.entityId, parentId: input.newParentId, createdRevision: revision },
        ],
      },
      {
        type: "moved",
        entityIds: [input.entityId],
        details: {
          ...(formerParentId === undefined ? {} : { formerParentId }),
          newParentId: input.newParentId,
        },
      },
    );
  });

export const renameProductEntity = (
  model: ProductModel,
  input: {
    readonly entityId: ProductEntityId;
    readonly canonicalName: string;
    readonly canonicalAliasId: string;
  },
  context: ProductModelChangeContext,
): Effect.Effect<ProductModel, ProductModelError> =>
  Effect.gen(function* () {
    const entity = entityFor(model, input.entityId);
    if (entity === undefined)
      return yield* failure("entity_not_found", "Product entity was not found.", input.entityId);
    if (!activeEntity(entity))
      return yield* failure(
        "entity_retired",
        "A retired entity cannot be renamed.",
        input.entityId,
      );
    const normalized = normalizeProductAlias(input.canonicalName);
    if (!nonBlank(input.canonicalAliasId) || normalized === "")
      return yield* failure(
        "invalid_input",
        "A canonical name and alias ID are required.",
        input.entityId,
      );
    if (normalized === normalizeProductAlias(entity.canonicalName))
      return yield* failure(
        "no_change",
        "The canonical product name is unchanged.",
        input.entityId,
      );
    if (aliasConflict(model, input.entityId, entity.kind, input.canonicalName))
      return yield* failure(
        "alias_conflict",
        "The canonical name is already owned by another entity.",
        input.entityId,
      );
    const existing = model.aliases.find(
      (alias) => alias.entityId === input.entityId && alias.normalizedValue === normalized,
    );
    if (existing === undefined && model.aliases.some(({ id }) => id === input.canonicalAliasId))
      return yield* failure(
        "alias_conflict",
        "Product alias IDs must be unique.",
        input.canonicalAliasId,
      );
    const revision = model.revision + 1;
    const aliases = model.aliases
      .map(
        (alias): ProductEntityAlias =>
          alias.entityId === input.entityId && alias.kind === "canonical"
            ? { ...alias, kind: "former_name" }
            : existing?.id === alias.id
              ? {
                  ...alias,
                  value: input.canonicalName.trim(),
                  normalizedValue: normalized,
                  kind: "canonical",
                }
              : alias,
      )
      .concat(
        existing === undefined
          ? [
              {
                id: input.canonicalAliasId,
                entityId: input.entityId,
                value: input.canonicalName.trim(),
                normalizedValue: normalized,
                kind: "canonical" as const,
                createdRevision: revision,
              },
            ]
          : [],
      );
    return yield* commit(
      model,
      context,
      {
        ...nextBase(model),
        entities: model.entities.map((candidate) =>
          candidate.id === input.entityId
            ? { ...candidate, canonicalName: input.canonicalName.trim(), updatedRevision: revision }
            : candidate,
        ),
        aliases,
      },
      {
        type: "renamed",
        entityIds: [input.entityId],
        details: { formerName: entity.canonicalName, canonicalName: input.canonicalName.trim() },
      },
    );
  });

export const resolveProductAlias = (
  model: ProductModel,
  value: string,
  kind?: ProductEntityKind,
): Effect.Effect<ProductEntityId | undefined, ProductModelError> => {
  const normalized = normalizeProductAlias(value);
  const matches = new Set(
    model.aliases
      .filter((alias) => alias.normalizedValue === normalized)
      .filter((alias) => kind === undefined || entityFor(model, alias.entityId)?.kind === kind)
      .map(({ entityId }) => entityId),
  );
  return matches.size > 1
    ? failure("alias_conflict", "The product alias is ambiguous.", value)
    : Effect.succeed([...matches][0]);
};

export const productParentId = (model: ProductModel, entityId: ProductEntityId) =>
  parentFor(model, entityId);

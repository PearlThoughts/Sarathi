import { Effect } from "effect";
import type { SensitivityTier } from "../../../domain/policy.ts";

declare const productEntityIdBrand: unique symbol;

export type ProductEntityId = string & { readonly [productEntityIdBrand]: true };
export type ProductEntityKind = "product" | "area" | "capability" | "feature";
export type ProductRegistration = "candidate" | "ratified" | "contested" | "superseded";
export type ProductLifecycle = "planned" | "available" | "deprecated" | "retired" | "unknown";
export type ProductRelationType =
  | "depends_on"
  | "enables"
  | "conflicts_with"
  | "alternative_to"
  | "supersedes"
  | "implements"
  | "contributes_to"
  | "governed_by"
  | "affected_by"
  | "realized_by"
  | "exposed_by"
  | "configured_by"
  | "deployed_as"
  | "observed_by"
  | "verified_by"
  | "constrained_by"
  | "available_to"
  | "variant_of";
export type ProductExternalReferenceKind =
  | "delivery"
  | "intent"
  | "technical"
  | "runtime"
  | "evidence"
  | "policy"
  | "availability";
export type ProductRelationEndpoint =
  | { readonly kind: "entity"; readonly entityId: ProductEntityId }
  | {
      readonly kind: "external";
      readonly referenceKind: ProductExternalReferenceKind;
      readonly referenceId: string;
    };
export type ProductVariantAxis =
  | "client"
  | "tenant"
  | "brand"
  | "role"
  | "environment"
  | "version"
  | "build"
  | "feature_flag";
export type ProductVariantValue = string | number | boolean | null;

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

export type ProductRelation = {
  readonly id: string;
  readonly workspaceId: string;
  readonly type: ProductRelationType;
  readonly source: ProductRelationEndpoint;
  readonly target: ProductRelationEndpoint;
  readonly registration: ProductRegistration;
  readonly sourceClass: string;
  readonly sensitivity: SensitivityTier;
  readonly audience: readonly string[];
  readonly validFrom: string;
  readonly validTo?: string | undefined;
  readonly createdRevision: number;
};

export type ProductVariant = {
  readonly id: string;
  readonly workspaceId: string;
  readonly baseEntityId: ProductEntityId;
  readonly qualifiers: Readonly<Partial<Record<ProductVariantAxis, string>>>;
  readonly delta: Readonly<Record<string, ProductVariantValue>>;
  readonly precedence: number;
  readonly registration: ProductRegistration;
  readonly sourceClass: string;
  readonly sensitivity: SensitivityTier;
  readonly audience: readonly string[];
  readonly validFrom: string;
  readonly validTo?: string | undefined;
  readonly createdRevision: number;
};

export type ProductIdentityEventType =
  | "registered"
  | "renamed"
  | "moved"
  | "retired"
  | "superseded";
export type ProductRevisionEventType =
  | ProductIdentityEventType
  | "registration_changed"
  | "relation_added"
  | "variant_added";

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
  readonly eventType: ProductRevisionEventType;
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
  readonly relations: readonly ProductRelation[];
  readonly variants: readonly ProductVariant[];
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
  | "relation_conflict"
  | "relation_incompatible"
  | "variant_conflict"
  | "variant_ambiguous"
  | "transition_invalid"
  | "revision_conflict"
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
  relations: [],
  variants: [],
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
  if (model.revisions.some(({ eventId }) => eventId === context.eventId))
    return failure("entity_conflict", "Product change event IDs must be unique.", context.eventId);
  return Effect.void;
};

type CommitEvent =
  | Omit<
      ProductIdentityEvent,
      "id" | "workspaceId" | "revision" | "actorId" | "validFrom" | "recordedAt"
    >
  | { readonly type: Exclude<ProductRevisionEventType, ProductIdentityEventType> };

const commit = (
  model: ProductModel,
  context: ProductModelChangeContext,
  next: Omit<ProductModel, "revision" | "revisions" | "identityEvents">,
  event: CommitEvent,
): Effect.Effect<ProductModel, ProductModelError> =>
  validateContext(model, context).pipe(
    Effect.map((): ProductModel => {
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
        identityEvents:
          identityEvent === undefined
            ? model.identityEvents
            : [...model.identityEvents, identityEvent],
      };
    }),
  );

const nextBase = (model: ProductModel) => ({
  workspaceId: model.workspaceId,
  entities: model.entities,
  aliases: model.aliases,
  hierarchy: model.hierarchy,
  relations: model.relations,
  variants: model.variants,
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
    if (input.registration === "superseded" || input.lifecycle === "retired")
      return yield* failure(
        "transition_invalid",
        "New product entities must begin in an active registration and lifecycle state.",
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
    if (entity.lifecycle === "retired")
      return yield* failure(
        "entity_retired",
        "A retired entity cannot change registration.",
        input.entityId,
      );
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

const registrationTransitions: Readonly<
  Record<ProductRegistration, readonly ProductRegistration[]>
> = {
  candidate: ["ratified", "contested"],
  ratified: ["contested", "superseded"],
  contested: ["candidate", "ratified", "superseded"],
  superseded: [],
};

const hasActiveChildren = (model: ProductModel, entityId: ProductEntityId) =>
  model.hierarchy.some((edge) => {
    const child = entityFor(model, edge.childId);
    return edge.parentId === entityId && child !== undefined && activeEntity(child);
  });

export const changeProductEntityRegistration = (
  model: ProductModel,
  input: { readonly entityId: ProductEntityId; readonly registration: ProductRegistration },
  context: ProductModelChangeContext,
): Effect.Effect<ProductModel, ProductModelError> =>
  Effect.gen(function* () {
    const entity = entityFor(model, input.entityId);
    if (entity === undefined)
      return yield* failure("entity_not_found", "Product entity was not found.", input.entityId);
    if (entity.registration === input.registration)
      return yield* failure("no_change", "The registration state is unchanged.", input.entityId);
    if (!registrationTransitions[entity.registration].includes(input.registration))
      return yield* failure(
        "transition_invalid",
        "The registration transition is not allowed.",
        input.entityId,
      );
    if (input.registration === "superseded" && hasActiveChildren(model, input.entityId))
      return yield* failure(
        "parent_conflict",
        "A product entity with active children cannot be superseded.",
        input.entityId,
      );
    const revision = model.revision + 1;
    return yield* commit(
      model,
      context,
      {
        ...nextBase(model),
        entities: model.entities.map((candidate) =>
          candidate.id === input.entityId
            ? { ...candidate, registration: input.registration, updatedRevision: revision }
            : candidate,
        ),
        hierarchy:
          input.registration === "superseded"
            ? model.hierarchy.filter(({ childId }) => childId !== input.entityId)
            : model.hierarchy,
      },
      input.registration === "superseded"
        ? {
            type: "superseded",
            entityIds: [input.entityId],
            details: { formerRegistration: entity.registration },
          }
        : { type: "registration_changed" },
    );
  });

export const retireProductEntity = (
  model: ProductModel,
  entityId: ProductEntityId,
  context: ProductModelChangeContext,
): Effect.Effect<ProductModel, ProductModelError> =>
  Effect.gen(function* () {
    const entity = entityFor(model, entityId);
    if (entity === undefined)
      return yield* failure("entity_not_found", "Product entity was not found.", entityId);
    if (entity.lifecycle === "retired")
      return yield* failure("no_change", "The product entity is already retired.", entityId);
    if (hasActiveChildren(model, entityId))
      return yield* failure(
        "parent_conflict",
        "A product entity with active children cannot be retired.",
        entityId,
      );
    const revision = model.revision + 1;
    return yield* commit(
      model,
      context,
      {
        ...nextBase(model),
        entities: model.entities.map((candidate) =>
          candidate.id === entityId
            ? { ...candidate, lifecycle: "retired", updatedRevision: revision }
            : candidate,
        ),
        hierarchy: model.hierarchy.filter(({ childId }) => childId !== entityId),
      },
      {
        type: "retired",
        entityIds: [entityId],
        details: { formerLifecycle: entity.lifecycle },
      },
    );
  });

export type ProductRelationEndpointRule =
  | { readonly kind: "entity"; readonly sameKind?: boolean }
  | {
      readonly kind: "external";
      readonly referenceKinds: readonly ProductExternalReferenceKind[];
    };

export type ProductRelationPolicy = {
  readonly source: ProductRelationEndpointRule;
  readonly target: ProductRelationEndpointRule;
  readonly direction: "directed" | "symmetric";
  readonly cardinality: "many_to_many" | "many_to_one";
  readonly transitivity: "none" | "declared";
};

const entityEndpoint = { kind: "entity" } as const;
const sameKindEndpoint = { kind: "entity", sameKind: true } as const;
const externalEndpoint = (
  ...referenceKinds: readonly ProductExternalReferenceKind[]
): ProductRelationEndpointRule => ({ kind: "external", referenceKinds });

export const productRelationPolicies: Readonly<Record<ProductRelationType, ProductRelationPolicy>> =
  {
    depends_on: {
      source: entityEndpoint,
      target: entityEndpoint,
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "declared",
    },
    enables: {
      source: entityEndpoint,
      target: entityEndpoint,
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "declared",
    },
    conflicts_with: {
      source: sameKindEndpoint,
      target: sameKindEndpoint,
      direction: "symmetric",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    alternative_to: {
      source: sameKindEndpoint,
      target: sameKindEndpoint,
      direction: "symmetric",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    supersedes: {
      source: sameKindEndpoint,
      target: sameKindEndpoint,
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "declared",
    },
    implements: {
      source: externalEndpoint("delivery", "technical"),
      target: entityEndpoint,
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    contributes_to: {
      source: externalEndpoint("delivery", "intent"),
      target: entityEndpoint,
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    governed_by: {
      source: entityEndpoint,
      target: externalEndpoint("policy", "evidence"),
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    affected_by: {
      source: entityEndpoint,
      target: externalEndpoint("delivery", "runtime", "evidence"),
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    realized_by: {
      source: entityEndpoint,
      target: externalEndpoint("technical"),
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    exposed_by: {
      source: entityEndpoint,
      target: externalEndpoint("technical", "runtime"),
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    configured_by: {
      source: entityEndpoint,
      target: externalEndpoint("technical", "runtime"),
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    deployed_as: {
      source: entityEndpoint,
      target: externalEndpoint("runtime"),
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    observed_by: {
      source: entityEndpoint,
      target: externalEndpoint("runtime", "evidence"),
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    verified_by: {
      source: entityEndpoint,
      target: externalEndpoint("evidence"),
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    constrained_by: {
      source: entityEndpoint,
      target: externalEndpoint("policy", "evidence"),
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    available_to: {
      source: entityEndpoint,
      target: externalEndpoint("availability"),
      direction: "directed",
      cardinality: "many_to_many",
      transitivity: "none",
    },
    variant_of: {
      source: sameKindEndpoint,
      target: sameKindEndpoint,
      direction: "directed",
      cardinality: "many_to_one",
      transitivity: "none",
    },
  };

const endpointKey = (endpoint: ProductRelationEndpoint) =>
  endpoint.kind === "entity"
    ? `entity:${endpoint.entityId}`
    : `external:${endpoint.referenceKind}:${endpoint.referenceId}`;

const relationKey = (
  type: ProductRelationType,
  source: ProductRelationEndpoint,
  target: ProductRelationEndpoint,
) => {
  const endpoints = [endpointKey(source), endpointKey(target)];
  if (productRelationPolicies[type].direction === "symmetric") endpoints.sort();
  return JSON.stringify([type, ...endpoints]);
};

const endpointEntityKind = (
  model: ProductModel,
  endpoint: ProductRelationEndpoint,
  rule: ProductRelationEndpointRule,
): Effect.Effect<ProductEntityKind | undefined, ProductModelError> =>
  Effect.gen(function* () {
    if (endpoint.kind !== rule.kind)
      return yield* failure("relation_incompatible", "The relation endpoint kind is invalid.");
    if (endpoint.kind === "external") {
      if (
        !nonBlank(endpoint.referenceId) ||
        rule.kind !== "external" ||
        !rule.referenceKinds.includes(endpoint.referenceKind)
      )
        return yield* failure(
          "relation_incompatible",
          "The external relation endpoint is invalid.",
          endpoint.referenceId,
        );
      return undefined;
    }
    const entity = entityFor(model, endpoint.entityId);
    if (entity === undefined)
      return yield* failure(
        "entity_not_found",
        "Relation entity was not found.",
        endpoint.entityId,
      );
    if (!activeEntity(entity))
      return yield* failure(
        "entity_retired",
        "A relation cannot target a retired entity.",
        entity.id,
      );
    return entity.kind;
  });

const rangesOverlap = (
  firstFrom: string,
  firstTo: string | undefined,
  secondFrom: string,
  secondTo: string | undefined,
) =>
  (firstTo === undefined || Date.parse(firstTo) > Date.parse(secondFrom)) &&
  (secondTo === undefined || Date.parse(secondTo) > Date.parse(firstFrom));

export type AddProductRelationInput = Omit<
  ProductRelation,
  "workspaceId" | "validFrom" | "createdRevision"
>;

export const addProductRelation = (
  model: ProductModel,
  input: AddProductRelationInput,
  context: ProductModelChangeContext,
): Effect.Effect<ProductModel, ProductModelError> =>
  Effect.gen(function* () {
    if (
      !nonBlank(input.id) ||
      !nonBlank(input.sourceClass) ||
      input.registration === "superseded" ||
      (input.validTo !== undefined &&
        (!validInstant(input.validTo) ||
          Date.parse(input.validTo) <= Date.parse(context.validFrom)))
    )
      return yield* failure("invalid_input", "The relation metadata is invalid.", input.id);
    const policy = productRelationPolicies[input.type];
    const sourceKind = yield* endpointEntityKind(model, input.source, policy.source);
    const targetKind = yield* endpointEntityKind(model, input.target, policy.target);
    if (endpointKey(input.source) === endpointKey(input.target))
      return yield* failure(
        "relation_incompatible",
        "A product relation cannot reference itself.",
        input.id,
      );
    if (
      policy.source.kind === "entity" &&
      policy.source.sameKind === true &&
      sourceKind !== targetKind
    )
      return yield* failure(
        "relation_incompatible",
        "The relation requires matching product entity kinds.",
        input.id,
      );
    const key = relationKey(input.type, input.source, input.target);
    if (
      model.relations.some(
        (relation) =>
          (relation.id === input.id ||
            relationKey(relation.type, relation.source, relation.target) === key ||
            (policy.cardinality === "many_to_one" &&
              relation.type === input.type &&
              endpointKey(relation.source) === endpointKey(input.source))) &&
          relation.registration !== "superseded" &&
          rangesOverlap(relation.validFrom, relation.validTo, context.validFrom, input.validTo),
      )
    )
      return yield* failure("relation_conflict", "The active relation already exists.", input.id);
    const revision = model.revision + 1;
    return yield* commit(
      model,
      context,
      {
        ...nextBase(model),
        relations: [
          ...model.relations,
          {
            ...input,
            workspaceId: model.workspaceId,
            audience: [...new Set(input.audience)],
            validFrom: context.validFrom,
            createdRevision: revision,
          },
        ],
      },
      { type: "relation_added" },
    );
  });

export const productVariantAxes: readonly ProductVariantAxis[] = [
  "client",
  "tenant",
  "brand",
  "role",
  "environment",
  "version",
  "build",
  "feature_flag",
];

export type AddProductVariantInput = Omit<
  ProductVariant,
  "workspaceId" | "validFrom" | "createdRevision"
>;

export const addProductVariant = (
  model: ProductModel,
  input: AddProductVariantInput,
  context: ProductModelChangeContext,
): Effect.Effect<ProductModel, ProductModelError> =>
  Effect.gen(function* () {
    const entity = entityFor(model, input.baseEntityId);
    if (entity === undefined)
      return yield* failure(
        "entity_not_found",
        "Variant base entity was not found.",
        input.baseEntityId,
      );
    if (!activeEntity(entity))
      return yield* failure(
        "entity_retired",
        "A retired entity cannot receive a variant.",
        input.baseEntityId,
      );
    if (input.registration === "ratified" && entity.registration !== "ratified")
      return yield* failure(
        "transition_invalid",
        "A ratified variant requires a ratified base entity.",
        input.baseEntityId,
      );
    const qualifierKeys = Object.keys(input.qualifiers);
    const qualifiers = productVariantAxes.flatMap((axis) => {
      const value = input.qualifiers[axis];
      return value === undefined ? [] : [[axis, value.trim()] as const];
    });
    const fields = Object.entries(input.delta);
    if (
      !nonBlank(input.id) ||
      !nonBlank(input.sourceClass) ||
      input.registration === "superseded" ||
      model.variants.some(({ id }) => id === input.id) ||
      qualifierKeys.some((key) => !productVariantAxes.includes(key as ProductVariantAxis)) ||
      qualifiers.length === 0 ||
      qualifiers.some(([, value]) => !nonBlank(value)) ||
      fields.length === 0 ||
      fields.some(
        ([field, value]) =>
          !nonBlank(field) ||
          value === undefined ||
          (typeof value === "number" && !Number.isFinite(value)),
      ) ||
      !Number.isSafeInteger(input.precedence) ||
      (input.validTo !== undefined &&
        (!validInstant(input.validTo) ||
          Date.parse(input.validTo) <= Date.parse(context.validFrom)))
    )
      return yield* failure("variant_conflict", "The product variant is invalid.", input.id);
    const revision = model.revision + 1;
    return yield* commit(
      model,
      context,
      {
        ...nextBase(model),
        variants: [
          ...model.variants,
          {
            ...input,
            workspaceId: model.workspaceId,
            qualifiers: Object.fromEntries(qualifiers),
            audience: [...new Set(input.audience)],
            validFrom: context.validFrom,
            createdRevision: revision,
          },
        ],
      },
      { type: "variant_added" },
    );
  });

export type ResolvedProductVariant = {
  readonly entityId: ProductEntityId;
  readonly qualifiers: Readonly<Partial<Record<ProductVariantAxis, string>>>;
  readonly appliedVariantIds: readonly string[];
  readonly appliedVariants: readonly {
    readonly id: string;
    readonly qualifiers: Readonly<Partial<Record<ProductVariantAxis, string>>>;
    readonly fields: readonly string[];
  }[];
  readonly delta: Readonly<Record<string, ProductVariantValue>>;
};

export const resolveProductVariant = (
  model: ProductModel,
  entityId: ProductEntityId,
  qualifiers: Readonly<Partial<Record<ProductVariantAxis, string>>>,
  validAt: string,
): Effect.Effect<ResolvedProductVariant, ProductModelError> =>
  Effect.gen(function* () {
    const entity = entityFor(model, entityId);
    if (entity === undefined)
      return yield* failure("entity_not_found", "Product entity was not found.", entityId);
    if (!activeEntity(entity))
      return yield* failure("entity_retired", "A retired entity has no current variant.", entityId);
    if (entity.registration !== "ratified")
      return yield* failure(
        "transition_invalid",
        "Variant resolution requires a ratified base entity.",
        entityId,
      );
    const qualifierKeys = Object.keys(qualifiers);
    const requested = Object.fromEntries(
      productVariantAxes.flatMap((axis) => {
        const value = qualifiers[axis];
        return value === undefined ? [] : [[axis, value.trim()]];
      }),
    ) as Readonly<Partial<Record<ProductVariantAxis, string>>>;
    if (
      !validInstant(validAt) ||
      qualifierKeys.some((key) => !productVariantAxes.includes(key as ProductVariantAxis)) ||
      Object.values(requested).some((value) => !nonBlank(value))
    )
      return yield* failure("invalid_input", "Variant resolution input is invalid.");
    const instant = Date.parse(validAt);
    const applicable = model.variants.filter(
      (variant) =>
        variant.baseEntityId === entityId &&
        variant.registration === "ratified" &&
        Date.parse(variant.validFrom) <= instant &&
        (variant.validTo === undefined || Date.parse(variant.validTo) > instant) &&
        Object.entries(variant.qualifiers).every(
          ([axis, value]) => requested[axis as ProductVariantAxis] === value,
        ),
    );
    const selected = new Map<string, ProductVariant>();
    const fields = [...new Set(applicable.flatMap((variant) => Object.keys(variant.delta)))].sort();
    for (const field of fields) {
      const candidates = applicable
        .filter((variant) => field in variant.delta)
        .sort(
          (left, right) =>
            Object.keys(right.qualifiers).length - Object.keys(left.qualifiers).length ||
            right.precedence - left.precedence ||
            left.id.localeCompare(right.id),
        );
      const winner = candidates[0];
      if (winner === undefined) continue;
      const specificity = Object.keys(winner.qualifiers).length;
      const ties = candidates.filter(
        (candidate) =>
          Object.keys(candidate.qualifiers).length === specificity &&
          candidate.precedence === winner.precedence,
      );
      if (ties.some((candidate) => candidate.delta[field] !== winner.delta[field]))
        return yield* failure(
          "variant_ambiguous",
          "Equally applicable variants disagree on an overridden field.",
          field,
        );
      selected.set(field, winner);
    }
    const applied = [...new Set(selected.values())].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    return {
      entityId,
      qualifiers: requested,
      appliedVariantIds: applied.map(({ id }) => id),
      appliedVariants: applied.map((variant) => ({
        id: variant.id,
        qualifiers: variant.qualifiers,
        fields: [...selected.entries()]
          .filter(([, selectedVariant]) => selectedVariant.id === variant.id)
          .map(([field]) => field),
      })),
      delta: Object.fromEntries(
        [...selected.entries()].map(([field, variant]) => [
          field,
          variant.delta[field] as ProductVariantValue,
        ]),
      ),
    };
  });

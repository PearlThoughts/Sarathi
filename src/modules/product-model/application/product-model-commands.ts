import { Effect } from "effect";
import type { RepositoryError, ValidationError } from "../../../domain/errors.ts";
import { stableSha256 } from "../../../domain/hash.ts";
import type { SensitivityTier } from "../../../domain/policy.ts";
import {
  mergeProductEntities as mergeIdentities,
  type SplitProductEntityInput,
  splitProductEntity as splitIdentity,
} from "../domain/product-identity-evolution.ts";
import {
  type AddProductRelationInput,
  type AddProductVariantInput,
  addProductRelation,
  addProductVariant,
  changeProductEntityLifecycle,
  changeProductEntityRegistration,
  changeProductVariantPrecedence,
  createProductModel,
  moveProductEntity,
  type ProductEntityId,
  type ProductModel,
  type ProductModelChangeContext,
  ProductModelError,
  promoteProductEntityAudience,
  type RegisterProductEntityInput,
  registerProductEntity,
  removeProductRelation,
  renameProductEntity,
  retireProductEntity,
} from "../domain/product-model.ts";
import type {
  ProductModelCommandAuthorizationDecision,
  ProductModelCommandAuthorizer,
  ProductModelCommandOperation,
} from "../ports/product-model-command-authorizer.ts";
import {
  type ProductCommandCommitResult,
  ProductCommandPersistenceError,
  type ProductModelCommandRepository,
} from "../ports/product-model-command-repository.ts";
import type { ProductModelRequestContext } from "../ports/product-model-query-authorizer.ts";

type ProposeEntityBody = {
  readonly type: "ProposeEntity";
  readonly targetId: ProductEntityId;
  readonly payload: Omit<RegisterProductEntityInput, "id" | "registration">;
};

export type ProductModelMutationBody =
  | ProposeEntityBody
  | { readonly type: "RatifyEntity"; readonly targetId: ProductEntityId }
  | { readonly type: "ContestEntity"; readonly targetId: ProductEntityId }
  | {
      readonly type: "RenameEntity";
      readonly targetId: ProductEntityId;
      readonly payload: { readonly canonicalName: string; readonly canonicalAliasId: string };
    }
  | {
      readonly type: "MoveEntity";
      readonly targetId: ProductEntityId;
      readonly payload: {
        readonly newParentId: ProductEntityId;
        readonly allowSkippedLevel?: boolean | undefined;
      };
    }
  | { readonly type: "AddRelation"; readonly payload: AddProductRelationInput }
  | { readonly type: "RemoveRelation"; readonly payload: { readonly relationId: string } }
  | {
      readonly type: "MergeEntities";
      readonly targetId: ProductEntityId;
      readonly payload: { readonly sourceIds: readonly ProductEntityId[] };
    }
  | { readonly type: "SplitEntity"; readonly payload: SplitProductEntityInput }
  | { readonly type: "CreateVariant"; readonly payload: AddProductVariantInput }
  | {
      readonly type: "ChangeVariantPrecedence";
      readonly payload: { readonly variantId: string; readonly precedence: number };
    }
  | { readonly type: "DeprecateEntity"; readonly targetId: ProductEntityId }
  | { readonly type: "RetireEntity"; readonly targetId: ProductEntityId }
  | { readonly type: "SupersedeEntity"; readonly targetId: ProductEntityId }
  | {
      readonly type: "PromoteAudience";
      readonly targetId: ProductEntityId;
      readonly payload: { readonly audience: readonly string[] };
    };

export type ProductModelCommandBody =
  | ProductModelMutationBody
  | {
      readonly type: "ResolveProposal";
      readonly payload: {
        readonly proposalId: string;
        readonly resolution: ProductModelMutationBody;
      };
    };

export type ProductModelCommand = ProductModelCommandBody & {
  readonly workspaceId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly justification: string;
  readonly validFrom: string;
  readonly previewToken?: string | undefined;
};

export type ProductCommandImpact = {
  readonly changedEntityIds: readonly ProductEntityId[];
  readonly hiddenEntityImpactCount: number;
  readonly changedCollections: Readonly<Record<string, number>>;
};

export type ProductChangePreview = {
  readonly status: "previewed";
  readonly workspaceId: string;
  readonly expectedRevision: number;
  readonly resultingRevision: number;
  readonly commandHash: string;
  readonly previewToken: string;
  readonly expiresAt: string;
  readonly policyVersion: string;
  readonly impact: ProductCommandImpact;
  readonly invariantResults: readonly [{ readonly status: "passed"; readonly name: string }];
};

export type ProductCommandResult = ProductCommandCommitResult & {
  readonly status: "committed";
  readonly projectionState: "pending";
};

export class ProductModelCommandAccessDenied extends Error {
  readonly _tag = "ProductModelCommandAccessDenied";
  constructor(
    message: string,
    readonly operation: ProductModelCommandOperation,
  ) {
    super(message);
    this.name = "ProductModelCommandAccessDenied";
  }
}

export class ProductModelCommandApprovalRequired extends Error {
  readonly _tag = "ProductModelCommandApprovalRequired";
  constructor() {
    super("The command has impacts outside the actor's authorized product scope.");
    this.name = "ProductModelCommandApprovalRequired";
  }
}

export class ProductModelCommandUnavailable extends Error {
  readonly _tag = "ProductModelCommandUnavailable";
  constructor() {
    super("The requested product-model workspace is not available.");
    this.name = "ProductModelCommandUnavailable";
  }
}

export type ProductModelCommandError =
  | ProductModelCommandAccessDenied
  | ProductModelCommandApprovalRequired
  | ProductModelCommandUnavailable
  | ProductCommandPersistenceError
  | ProductModelError
  | RepositoryError
  | ValidationError;

export type ProductPreviewTokenClaims = {
  readonly commandHash: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly policyVersion: string;
  readonly expectedRevision: number;
  readonly expiresAt: string;
};

export type ProductPreviewTokenCodec = {
  readonly issue: (claims: ProductPreviewTokenClaims) => string;
  readonly verify: (
    token: string,
    claims: Omit<ProductPreviewTokenClaims, "expiresAt"> & { readonly now: string },
  ) => boolean;
};

export type ProductModelCommandDependencies = {
  readonly now: () => string;
  readonly newId: () => string;
  readonly previewTtlMs?: number | undefined;
  readonly previewTokens: ProductPreviewTokenCodec;
};

export type ProductModelCommandService = {
  readonly preview: (
    context: ProductModelRequestContext,
    command: ProductModelCommand,
  ) => Effect.Effect<ProductChangePreview, ProductModelCommandError>;
  readonly execute: (
    context: ProductModelRequestContext,
    command: ProductModelCommand,
  ) => Effect.Effect<ProductCommandResult, ProductModelCommandError>;
};

const sensitivityRank: Readonly<Record<SensitivityTier, number>> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

export const productCommandHash = (command: ProductModelCommand): string =>
  stableSha256(
    canonical({
      ...command,
      idempotencyKey: undefined,
      previewToken: undefined,
    }),
  );

const mutationFor = (body: ProductModelCommandBody): ProductModelMutationBody =>
  body.type === "ResolveProposal" ? body.payload.resolution : body;

export const declaredProductCommandEntityIds = (
  command: ProductModelCommandBody,
): readonly ProductEntityId[] => {
  const body = mutationFor(command);
  switch (body.type) {
    case "ProposeEntity":
    case "RatifyEntity":
    case "ContestEntity":
    case "RenameEntity":
    case "DeprecateEntity":
    case "RetireEntity":
    case "SupersedeEntity":
    case "PromoteAudience":
      return [body.targetId];
    case "MoveEntity":
      return [body.targetId, body.payload.newParentId];
    case "MergeEntities":
      return [body.targetId, ...body.payload.sourceIds];
    case "SplitEntity":
      return [body.payload.sourceId, ...body.payload.targets.map(({ id }) => id)];
    case "AddRelation":
      return [body.payload.source, body.payload.target].flatMap((endpoint) =>
        endpoint.kind === "entity" ? [endpoint.entityId] : [],
      );
    case "CreateVariant":
      return [body.payload.baseEntityId];
    case "RemoveRelation":
    case "ChangeVariantPrecedence":
      return [];
  }
};

const applyMutation = (
  model: ProductModel,
  body: ProductModelMutationBody,
  context: ProductModelChangeContext,
) => {
  switch (body.type) {
    case "ProposeEntity":
      return registerProductEntity(
        model,
        { ...body.payload, id: body.targetId, registration: "candidate" },
        context,
      );
    case "RatifyEntity":
      return changeProductEntityRegistration(
        model,
        { entityId: body.targetId, registration: "ratified" },
        context,
      );
    case "ContestEntity":
      return changeProductEntityRegistration(
        model,
        { entityId: body.targetId, registration: "contested" },
        context,
      );
    case "RenameEntity":
      return renameProductEntity(model, { entityId: body.targetId, ...body.payload }, context);
    case "MoveEntity":
      return moveProductEntity(
        model,
        {
          entityId: body.targetId,
          newParentId: body.payload.newParentId,
          ...(body.payload.allowSkippedLevel === undefined
            ? {}
            : { allowSkippedLevel: body.payload.allowSkippedLevel }),
        },
        context,
      );
    case "AddRelation":
      return addProductRelation(model, body.payload, context);
    case "RemoveRelation":
      return removeProductRelation(model, body.payload.relationId, context);
    case "MergeEntities":
      return mergeIdentities(
        model,
        { sourceIds: body.payload.sourceIds, survivorId: body.targetId },
        context,
      );
    case "SplitEntity":
      return splitIdentity(model, body.payload, context);
    case "CreateVariant":
      return addProductVariant(model, body.payload, context);
    case "ChangeVariantPrecedence":
      return changeProductVariantPrecedence(model, body.payload, context);
    case "DeprecateEntity":
      return changeProductEntityLifecycle(
        model,
        { entityId: body.targetId, lifecycle: "deprecated" },
        context,
      );
    case "RetireEntity":
      return retireProductEntity(model, body.targetId, context);
    case "SupersedeEntity":
      return changeProductEntityRegistration(
        model,
        { entityId: body.targetId, registration: "superseded" },
        context,
      );
    case "PromoteAudience":
      return promoteProductEntityAudience(
        model,
        { entityId: body.targetId, audience: body.payload.audience },
        context,
      );
  }
};

const validateCommand = (context: ProductModelRequestContext, command: ProductModelCommand) => {
  if (command.workspaceId.trim() === "" || command.workspaceId !== context.workspaceId)
    return Effect.fail(new ProductModelError("invalid_input", "Command workspace is invalid."));
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0)
    return Effect.fail(
      new ProductModelError("invalid_input", "Expected revision must be a non-negative integer."),
    );
  if (command.idempotencyKey.trim().length < 8)
    return Effect.fail(
      new ProductModelError("invalid_input", "A non-trivial idempotency key is required."),
    );
  if (command.justification.trim().length < 8)
    return Effect.fail(
      new ProductModelError("invalid_input", "A meaningful command justification is required."),
    );
  if (!Number.isFinite(Date.parse(command.validFrom)))
    return Effect.fail(new ProductModelError("invalid_input", "Command valid time is invalid."));
  return Effect.void;
};

const authorize = (
  authorizer: ProductModelCommandAuthorizer,
  context: ProductModelRequestContext,
  command: ProductModelCommand,
  operation: ProductModelCommandOperation,
) =>
  authorizer
    .authorize(context, {
      operation,
      commandType: command.type,
      declaredEntityIds: declaredProductCommandEntityIds(command),
    })
    .pipe(
      Effect.flatMap((decision) =>
        decision.allowed
          ? Effect.succeed(decision)
          : Effect.fail(new ProductModelCommandAccessDenied(decision.reason, operation)),
      ),
    );

const currentModel = (
  repository: ProductModelCommandRepository,
  workspaceId: string,
  commandType: string,
) =>
  repository
    .current(workspaceId)
    .pipe(
      Effect.flatMap((model) =>
        model === undefined && commandType !== "ProposeEntity"
          ? Effect.fail(new ProductModelCommandUnavailable())
          : Effect.succeed(model ?? createProductModel(workspaceId)),
      ),
    );

const changedRecords = <Value>(
  before: readonly Value[],
  after: readonly Value[],
): readonly Value[] => {
  const beforeValues = new Set(before.map(canonical));
  const afterValues = new Set(after.map(canonical));
  return [
    ...before.filter((value) => !afterValues.has(canonical(value))),
    ...after.filter((value) => !beforeValues.has(canonical(value))),
  ];
};

const endpointEntityIds = (value: {
  readonly kind: string;
  readonly entityId?: ProductEntityId | undefined;
}) => (value.kind === "entity" && value.entityId !== undefined ? [value.entityId] : []);

const affectedProductEntityIds = (
  before: ProductModel,
  after: ProductModel,
): readonly ProductEntityId[] =>
  [
    ...changedRecords(before.entities, after.entities).map(({ id }) => id),
    ...changedRecords(before.aliases, after.aliases).map(({ entityId }) => entityId),
    ...changedRecords(before.hierarchy, after.hierarchy).flatMap(({ childId, parentId }) => [
      childId,
      parentId,
    ]),
    ...changedRecords(before.relations, after.relations).flatMap(({ source, target }) => [
      ...endpointEntityIds(source),
      ...endpointEntityIds(target),
    ]),
    ...changedRecords(before.variants, after.variants).map(({ baseEntityId }) => baseEntityId),
    ...changedRecords(before.attachments, after.attachments).map(({ entityId }) => entityId),
    ...changedRecords(before.redirects, after.redirects).flatMap(({ fromId, toId }) => [
      fromId,
      toId,
    ]),
    ...changedRecords(before.orphans, after.orphans).map(({ sourceEntityId }) => sourceEntityId),
  ]
    .filter((entityId, index, values) => values.indexOf(entityId) === index)
    .sort();

const visibleEntity = (
  model: ProductModel,
  context: ProductModelRequestContext,
  decision: ProductModelCommandAuthorizationDecision,
  entityId: ProductEntityId,
) => {
  const entity = model.entities.find(({ id }) => id === entityId);
  if (entity === undefined) return true;
  if (sensitivityRank[entity.sensitivity] > sensitivityRank[context.maximumSensitivity])
    return false;
  if (
    entity.audience.length > 0 &&
    !entity.audience.some((audience) => context.effectiveAudience.includes(audience))
  )
    return false;
  return decision.entityScope.kind === "all" || decision.entityScope.entityIds.includes(entityId);
};

const collectionChanges = (before: ProductModel, after: ProductModel) =>
  Object.fromEntries(
    (
      [
        "entities",
        "aliases",
        "hierarchy",
        "relations",
        "variants",
        "attachments",
        "redirects",
        "orphans",
      ] as const
    ).flatMap((key) => {
      const difference = changedRecords<unknown>(before[key], after[key]).length;
      return difference === 0 ? [] : [[key, difference]];
    }),
  );

const impactFor = (
  before: ProductModel,
  after: ProductModel,
  context: ProductModelRequestContext,
  decision: ProductModelCommandAuthorizationDecision,
): ProductCommandImpact => {
  const affected = affectedProductEntityIds(before, after);
  const visible = affected.filter((entityId) => visibleEntity(after, context, decision, entityId));
  return {
    changedEntityIds: visible,
    hiddenEntityImpactCount: affected.length - visible.length,
    changedCollections: collectionChanges(before, after),
  };
};

export const createProductModelCommandService = (
  authorizer: ProductModelCommandAuthorizer,
  repository: ProductModelCommandRepository,
  dependencies: ProductModelCommandDependencies,
): ProductModelCommandService => {
  const prepare = (
    context: ProductModelRequestContext,
    command: ProductModelCommand,
    operation: ProductModelCommandOperation,
    authorized?:
      | {
          readonly decision: ProductModelCommandAuthorizationDecision;
          readonly commandHash: string;
          readonly recordedAt: string;
        }
      | undefined,
  ) =>
    Effect.gen(function* () {
      yield* validateCommand(context, command);
      const decision =
        authorized?.decision ?? (yield* authorize(authorizer, context, command, operation));
      const before = yield* currentModel(repository, command.workspaceId, command.type);
      if (before.revision !== command.expectedRevision)
        return yield* Effect.fail(
          new ProductCommandPersistenceError(
            "stale_revision",
            `Expected product-model revision ${command.expectedRevision}; current revision is ${before.revision}.`,
          ),
        );
      const commandHash = authorized?.commandHash ?? productCommandHash(command);
      const recordedAt = authorized?.recordedAt ?? dependencies.now();
      const eventId = commandHash;
      const after = yield* applyMutation(before, mutationFor(command), {
        eventId,
        actorId: context.actorId,
        validFrom: command.validFrom,
        recordedAt,
      });
      const impact = impactFor(before, after, context, decision);
      return {
        before,
        after,
        commandHash,
        recordedAt,
        eventId,
        decision,
        impact,
        affectedEntityIds: affectedProductEntityIds(before, after),
      };
    });

  return {
    preview: (context, command) =>
      Effect.gen(function* () {
        const prepared = yield* prepare(context, command, "preview-change");
        const expiresAt = new Date(
          Date.parse(prepared.recordedAt) + (dependencies.previewTtlMs ?? 300_000),
        ).toISOString();
        const claims = {
          commandHash: prepared.commandHash,
          actorId: context.actorId,
          workspaceId: context.workspaceId,
          policyVersion: prepared.decision.policyVersion,
          expectedRevision: command.expectedRevision,
          expiresAt,
        };
        return {
          status: "previewed",
          workspaceId: context.workspaceId,
          expectedRevision: command.expectedRevision,
          resultingRevision: prepared.after.revision,
          commandHash: prepared.commandHash,
          previewToken: dependencies.previewTokens.issue(claims),
          expiresAt,
          policyVersion: prepared.decision.policyVersion,
          impact: prepared.impact,
          invariantResults: [{ status: "passed", name: "product-model-domain-invariants" }],
        };
      }),
    execute: (context, command) =>
      Effect.gen(function* () {
        yield* validateCommand(context, command);
        const decision = yield* authorize(authorizer, context, command, "execute-command");
        const commandHash = productCommandHash(command);
        const recordedAt = dependencies.now();
        if (
          command.previewToken !== undefined &&
          !dependencies.previewTokens.verify(command.previewToken, {
            commandHash,
            actorId: context.actorId,
            workspaceId: context.workspaceId,
            policyVersion: decision.policyVersion,
            expectedRevision: command.expectedRevision,
            now: recordedAt,
          })
        )
          return yield* Effect.fail(
            new ProductModelError("invalid_input", "The product change preview token is invalid."),
          );
        const replay = yield* repository.replay(
          command.workspaceId,
          command.idempotencyKey,
          commandHash,
        );
        if (replay !== undefined)
          return {
            status: "committed",
            ...replay,
            changedEntityIds:
              decision.entityScope.kind === "all"
                ? replay.changedEntityIds
                : replay.changedEntityIds.filter(
                    (entityId) =>
                      decision.entityScope.kind === "entities" &&
                      decision.entityScope.entityIds.includes(entityId),
                  ),
            projectionState: "pending",
          };
        const prepared = yield* prepare(context, command, "execute-command", {
          decision,
          commandHash,
          recordedAt,
        });
        if (prepared.impact.hiddenEntityImpactCount > 0 && !prepared.decision.allowHiddenImpacts)
          return yield* Effect.fail(new ProductModelCommandApprovalRequired());
        const audience = [...new Set(context.effectiveAudience)];
        const result = yield* repository.commit({
          expectedRevision: command.expectedRevision,
          commandHash: prepared.commandHash,
          idempotencyKey: command.idempotencyKey,
          model: prepared.after,
          audit: {
            id: dependencies.newId(),
            workspaceId: context.workspaceId,
            requestId: context.requestId,
            actorId: context.actorId,
            commandType: command.type,
            idempotencyKey: command.idempotencyKey,
            commandHash: prepared.commandHash,
            justification: command.justification.trim(),
            resultingRevision: prepared.after.revision,
            eventId: prepared.eventId,
            impactSummary: prepared.impact,
            sensitivity: context.maximumSensitivity,
            audience,
            recordedAt: prepared.recordedAt,
          },
          outbox: {
            id: dependencies.newId(),
            workspaceId: context.workspaceId,
            revision: prepared.after.revision,
            eventType: command.type,
            aggregateIds: prepared.affectedEntityIds,
            payload: {
              commandHash: prepared.commandHash,
              hiddenEntityImpactCount: prepared.impact.hiddenEntityImpactCount,
            },
            sensitivity: context.maximumSensitivity,
            audience,
            createdAt: prepared.recordedAt,
          },
          responseEntityIds: prepared.impact.changedEntityIds,
          ...(command.type === "ResolveProposal"
            ? { resolvedProposalId: command.payload.proposalId }
            : {}),
        });
        return {
          status: "committed",
          ...result,
          projectionState: "pending",
        };
      }),
  };
};

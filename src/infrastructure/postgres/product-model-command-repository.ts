import { and, eq, gt, isNull, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import { RepositoryError } from "../../domain/errors.ts";
import {
  type ProductCommandCommit,
  type ProductCommandCommitResult,
  ProductCommandPersistenceError,
  type ProductEntityId,
  type ProductModel,
  type ProductModelCommandRepository,
} from "../../modules/product-model/index.ts";
import type { KnowledgePostgresDatabase } from "./knowledge-migrations.ts";
import {
  productChangeProposalTable,
  productCommandAuditTable,
  productEntityAliasTable,
  productEntityAttachmentTable,
  productEntityStateTable,
  productEntityTable,
  productHierarchyEdgeTable,
  productIdentityEventTable,
  productOutboxEventTable,
  productRedirectTable,
  productReferenceOrphanTable,
  productRelationTable,
  productRevisionTable,
  productVariantTable,
} from "./product-model-schema.ts";

type ProductModelRow = { readonly model: ProductModel };
type ReplayRow = {
  readonly commandHash: string;
  readonly resultingRevision: number | null;
  readonly eventId: string | null;
  readonly impactSummary: { readonly changedEntityIds?: readonly string[] | undefined };
};
type RevisionRow = { readonly revision: number };

type ProductCommandDatabase = Pick<
  KnowledgePostgresDatabase,
  "execute" | "insert" | "select" | "update"
>;

const json = (value: unknown) => JSON.stringify(value);
const same = (left: unknown, right: unknown) => json(left) === json(right);

export const buildCurrentProductModelQuery = (workspaceId: string): SQL<ProductModelRow> =>
  sql<ProductModelRow>`
    select jsonb_build_object(
      'workspaceId', ${workspaceId},
      'revision', coalesce((select max(revision) from product_revision where workspace_id = ${workspaceId}), 0),
      'entities', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', entity.id,
          'workspaceId', entity.workspace_id,
          'kind', entity.kind,
          'canonicalName', state.canonical_name,
          'description', state.description,
          'registration', state.registration,
          'lifecycle', state.lifecycle,
          'sensitivity', state.sensitivity,
          'audience', state.audience,
          'createdRevision', entity.created_revision,
          'updatedRevision', state.revision
        )) order by entity.id)
        from product_entity entity
        inner join product_entity_state state
          on state.workspace_id = entity.workspace_id
         and state.entity_id = entity.id
         and state.superseded_at is null
        where entity.workspace_id = ${workspaceId}
      ), '[]'::jsonb),
      'aliases', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', id,
          'entityId', entity_id,
          'value', value,
          'normalizedValue', normalized_value,
          'kind', kind,
          'sourceClass', source_class,
          'createdRevision', created_revision
        )) order by id)
        from product_entity_alias
        where workspace_id = ${workspaceId} and superseded_at is null
      ), '[]'::jsonb),
      'hierarchy', coalesce((
        select jsonb_agg(jsonb_build_object(
          'childId', child_id,
          'parentId', parent_id,
          'createdRevision', created_revision
        ) order by child_id)
        from product_hierarchy_edge
        where workspace_id = ${workspaceId} and superseded_at is null
      ), '[]'::jsonb),
      'relations', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', id,
          'workspaceId', workspace_id,
          'type', relation_type,
          'source', case when source_kind = 'entity'
            then jsonb_build_object('kind', 'entity', 'entityId', source_entity_id)
            else jsonb_build_object('kind', 'external', 'referenceKind', source_reference_kind, 'referenceId', source_reference_id)
          end,
          'target', case when target_kind = 'entity'
            then jsonb_build_object('kind', 'entity', 'entityId', target_entity_id)
            else jsonb_build_object('kind', 'external', 'referenceKind', target_reference_kind, 'referenceId', target_reference_id)
          end,
          'registration', registration,
          'sourceClass', source_class,
          'sensitivity', sensitivity,
          'audience', audience,
          'validFrom', valid_from,
          'validTo', valid_to,
          'createdRevision', created_revision
        )) order by id)
        from product_relation
        where workspace_id = ${workspaceId} and superseded_at is null
      ), '[]'::jsonb),
      'variants', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', id,
          'workspaceId', workspace_id,
          'baseEntityId', base_entity_id,
          'qualifiers', qualifiers,
          'delta', delta,
          'precedence', precedence,
          'registration', registration,
          'sourceClass', source_class,
          'sensitivity', sensitivity,
          'audience', audience,
          'validFrom', valid_from,
          'validTo', valid_to,
          'createdRevision', created_revision
        )) order by id)
        from product_variant
        where workspace_id = ${workspaceId} and superseded_at is null
      ), '[]'::jsonb),
      'attachments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id,
          'workspaceId', workspace_id,
          'entityId', entity_id,
          'kind', attachment_kind,
          'referenceId', reference_id,
          'registration', registration,
          'sourceClass', source_class,
          'sensitivity', sensitivity,
          'audience', audience,
          'createdRevision', created_revision
        ) order by id)
        from product_entity_attachment
        where workspace_id = ${workspaceId} and superseded_at is null
      ), '[]'::jsonb),
      'redirects', coalesce((
        select jsonb_agg(jsonb_build_object(
          'workspaceId', workspace_id,
          'fromId', from_entity_id,
          'toId', to_entity_id,
          'createdRevision', created_revision
        ) order by from_entity_id)
        from product_redirect
        where workspace_id = ${workspaceId} and superseded_at is null
      ), '[]'::jsonb),
      'orphans', coalesce((
        select jsonb_agg(jsonb_build_object(
          'workspaceId', workspace_id,
          'sourceEntityId', source_entity_id,
          'kind', reference_kind,
          'referenceId', reference_id,
          'createdRevision', created_revision
        ) order by source_entity_id, reference_kind, reference_id)
        from product_reference_orphan
        where workspace_id = ${workspaceId} and resolved_revision is null
      ), '[]'::jsonb),
      'revisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'revision', revision,
          'eventId', event_id,
          'eventType', event_type,
          'actorId', actor_id,
          'validFrom', valid_from,
          'recordedAt', recorded_at
        ) order by revision)
        from product_revision
        where workspace_id = ${workspaceId}
      ), '[]'::jsonb),
      'identityEvents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id,
          'workspaceId', workspace_id,
          'revision', revision,
          'type', event_type,
          'entityIds', entity_ids,
          'details', details,
          'actorId', actor_id,
          'validFrom', valid_from,
          'recordedAt', recorded_at
        ) order by revision)
        from product_identity_event
        where workspace_id = ${workspaceId}
      ), '[]'::jsonb)
    ) as model
  `;

const loadCurrent = async (
  database: ProductCommandDatabase,
  workspaceId: string,
): Promise<ProductModel | undefined> => {
  const result = await database.execute(buildCurrentProductModelQuery(workspaceId));
  const model = (result.rows[0] as ProductModelRow | undefined)?.model;
  return model === undefined || model.revision === 0 ? undefined : model;
};

const readReplay = (
  database: ProductCommandDatabase,
  workspaceId: string,
  idempotencyKey: string,
) =>
  database
    .select({
      commandHash: productCommandAuditTable.commandHash,
      resultingRevision: productCommandAuditTable.resultingRevision,
      eventId: productCommandAuditTable.eventId,
      impactSummary: productCommandAuditTable.impactSummary,
    })
    .from(productCommandAuditTable)
    .where(
      and(
        eq(productCommandAuditTable.workspaceId, workspaceId),
        eq(productCommandAuditTable.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

const replayResult = (
  row: ReplayRow | undefined,
  commandHash: string,
): ProductCommandCommitResult | undefined => {
  if (row === undefined) return undefined;
  if (row.commandHash !== commandHash)
    throw new ProductCommandPersistenceError(
      "idempotency_conflict",
      "The idempotency key is already bound to a different product command.",
    );
  if (row.resultingRevision === null || row.eventId === null)
    throw new ProductCommandPersistenceError(
      "idempotency_conflict",
      "The idempotency key is bound to a non-committed product command.",
    );
  return {
    revision: row.resultingRevision,
    eventId: row.eventId,
    changedEntityIds: (row.impactSummary.changedEntityIds ?? []) as readonly ProductEntityId[],
    replayed: true,
  };
};

const requiredRevision = (change: ProductCommandCommit) => {
  const revision = change.model.revisions.at(-1);
  if (revision === undefined)
    throw new ProductCommandPersistenceError("transaction_failed", "Revision metadata is absent.");
  return revision;
};

const persistEntities = async (
  database: ProductCommandDatabase,
  before: ProductModel,
  change: ProductCommandCommit,
) => {
  const revision = requiredRevision(change);
  const previous = new Map(before.entities.map((entity) => [entity.id, entity]));
  for (const entity of change.model.entities) {
    const prior = previous.get(entity.id);
    if (prior === undefined)
      await database.insert(productEntityTable).values({
        workspaceId: change.model.workspaceId,
        id: entity.id,
        kind: entity.kind,
        createdRevision: entity.createdRevision,
        createdAt: revision.recordedAt,
      });
    if (prior !== undefined && same(prior, entity)) continue;
    if (prior !== undefined)
      await database
        .update(productEntityStateTable)
        .set({ supersededAt: revision.recordedAt })
        .where(
          and(
            eq(productEntityStateTable.workspaceId, change.model.workspaceId),
            eq(productEntityStateTable.entityId, entity.id),
            isNull(productEntityStateTable.supersededAt),
          ),
        );
    await database.insert(productEntityStateTable).values({
      workspaceId: change.model.workspaceId,
      entityId: entity.id,
      revision: change.model.revision,
      canonicalName: entity.canonicalName,
      description: entity.description ?? null,
      registration: entity.registration,
      lifecycle: entity.lifecycle,
      sensitivity: entity.sensitivity,
      audience: entity.audience,
      validFrom: revision.validFrom,
      recordedAt: revision.recordedAt,
    });
  }
};

const changedValues = <Value>(
  before: readonly Value[],
  after: readonly Value[],
  key: (value: Value) => string,
) => {
  const prior = new Map(before.map((value) => [key(value), value]));
  const next = new Map(after.map((value) => [key(value), value]));
  return {
    removed: before.filter((value) => !next.has(key(value))),
    written: after.filter((value) => {
      const existing = prior.get(key(value));
      return existing === undefined || !same(existing, value);
    }),
  };
};

const persistAliases = async (
  database: ProductCommandDatabase,
  before: ProductModel,
  change: ProductCommandCommit,
) => {
  const revision = requiredRevision(change);
  const entities = new Map(change.model.entities.map((entity) => [entity.id, entity]));
  const changes = changedValues(before.aliases, change.model.aliases, ({ id }) => id);
  for (const alias of [...changes.removed, ...changes.written])
    await database
      .update(productEntityAliasTable)
      .set({ validTo: revision.validFrom, supersededAt: revision.recordedAt })
      .where(
        and(
          eq(productEntityAliasTable.workspaceId, change.model.workspaceId),
          eq(productEntityAliasTable.id, alias.id),
          isNull(productEntityAliasTable.supersededAt),
        ),
      );
  for (const alias of changes.written) {
    const entity = entities.get(alias.entityId);
    if (entity === undefined)
      throw new ProductCommandPersistenceError("transaction_failed", "Alias entity is absent.");
    await database.insert(productEntityAliasTable).values({
      workspaceId: change.model.workspaceId,
      id: alias.id,
      entityId: alias.entityId,
      entityKind: entity.kind,
      value: alias.value,
      normalizedValue: alias.normalizedValue,
      kind: alias.kind,
      sourceClass: alias.sourceClass ?? null,
      sensitivity: entity.sensitivity,
      audience: entity.audience,
      createdRevision: change.model.revision,
      validFrom: revision.validFrom,
      recordedAt: revision.recordedAt,
    });
  }
};

const persistHierarchy = async (
  database: ProductCommandDatabase,
  before: ProductModel,
  change: ProductCommandCommit,
) => {
  const revision = requiredRevision(change);
  const changes = changedValues(before.hierarchy, change.model.hierarchy, ({ childId }) => childId);
  for (const edge of [...changes.removed, ...changes.written])
    await database
      .update(productHierarchyEdgeTable)
      .set({ validTo: revision.validFrom, supersededAt: revision.recordedAt })
      .where(
        and(
          eq(productHierarchyEdgeTable.workspaceId, change.model.workspaceId),
          eq(productHierarchyEdgeTable.childId, edge.childId),
          isNull(productHierarchyEdgeTable.supersededAt),
        ),
      );
  for (const edge of changes.written)
    await database.insert(productHierarchyEdgeTable).values({
      workspaceId: change.model.workspaceId,
      childId: edge.childId,
      parentId: edge.parentId,
      createdRevision: change.model.revision,
      validFrom: revision.validFrom,
      recordedAt: revision.recordedAt,
    });
};

const endpointColumns = (endpoint: ProductModel["relations"][number]["source"]) => ({
  entityId: endpoint.kind === "entity" ? endpoint.entityId : null,
  referenceKind: endpoint.kind === "external" ? endpoint.referenceKind : null,
  referenceId: endpoint.kind === "external" ? endpoint.referenceId : null,
});

const persistRelations = async (
  database: ProductCommandDatabase,
  before: ProductModel,
  change: ProductCommandCommit,
) => {
  const revision = requiredRevision(change);
  const prior = new Map(before.relations.map((relation) => [relation.id, relation]));
  const changes = changedValues(before.relations, change.model.relations, ({ id }) => id);
  for (const relation of [...changes.removed, ...changes.written])
    await database
      .update(productRelationTable)
      .set({ validTo: revision.validFrom, supersededAt: revision.recordedAt })
      .where(
        and(
          eq(productRelationTable.workspaceId, change.model.workspaceId),
          eq(productRelationTable.id, relation.id),
          isNull(productRelationTable.supersededAt),
        ),
      );
  for (const relation of changes.written) {
    if (
      relation.registration === "superseded" ||
      (relation.validTo !== undefined &&
        Date.parse(relation.validTo) <= Date.parse(revision.validFrom))
    )
      continue;
    const source = endpointColumns(relation.source);
    const target = endpointColumns(relation.target);
    const validFrom = prior.has(relation.id) ? revision.validFrom : relation.validFrom;
    await database.insert(productRelationTable).values({
      workspaceId: change.model.workspaceId,
      id: relation.id,
      relationType: relation.type,
      sourceKind: relation.source.kind,
      sourceEntityId: source.entityId,
      sourceReferenceKind: source.referenceKind,
      sourceReferenceId: source.referenceId,
      targetKind: relation.target.kind,
      targetEntityId: target.entityId,
      targetReferenceKind: target.referenceKind,
      targetReferenceId: target.referenceId,
      registration: relation.registration,
      sourceClass: relation.sourceClass,
      sensitivity: relation.sensitivity,
      audience: relation.audience,
      createdRevision: change.model.revision,
      validFrom,
      validTo: relation.validTo ?? null,
      recordedAt: revision.recordedAt,
    });
  }
};

const persistVariants = async (
  database: ProductCommandDatabase,
  before: ProductModel,
  change: ProductCommandCommit,
) => {
  const revision = requiredRevision(change);
  const prior = new Map(before.variants.map((variant) => [variant.id, variant]));
  const changes = changedValues(before.variants, change.model.variants, ({ id }) => id);
  for (const variant of [...changes.removed, ...changes.written])
    await database
      .update(productVariantTable)
      .set({ validTo: revision.validFrom, supersededAt: revision.recordedAt })
      .where(
        and(
          eq(productVariantTable.workspaceId, change.model.workspaceId),
          eq(productVariantTable.id, variant.id),
          isNull(productVariantTable.supersededAt),
        ),
      );
  for (const variant of changes.written)
    await database.insert(productVariantTable).values({
      workspaceId: change.model.workspaceId,
      id: variant.id,
      baseEntityId: variant.baseEntityId,
      qualifiers: variant.qualifiers,
      delta: variant.delta,
      precedence: variant.precedence,
      registration: variant.registration,
      sourceClass: variant.sourceClass,
      sensitivity: variant.sensitivity,
      audience: variant.audience,
      createdRevision: change.model.revision,
      validFrom: prior.has(variant.id) ? revision.validFrom : variant.validFrom,
      validTo: variant.validTo ?? null,
      recordedAt: revision.recordedAt,
    });
};

const persistAttachments = async (
  database: ProductCommandDatabase,
  before: ProductModel,
  change: ProductCommandCommit,
) => {
  const revision = requiredRevision(change);
  const changes = changedValues(before.attachments, change.model.attachments, ({ id }) => id);
  for (const attachment of [...changes.removed, ...changes.written])
    await database
      .update(productEntityAttachmentTable)
      .set({ supersededAt: revision.recordedAt })
      .where(
        and(
          eq(productEntityAttachmentTable.workspaceId, change.model.workspaceId),
          eq(productEntityAttachmentTable.id, attachment.id),
          isNull(productEntityAttachmentTable.supersededAt),
        ),
      );
  for (const attachment of changes.written)
    await database.insert(productEntityAttachmentTable).values({
      workspaceId: change.model.workspaceId,
      id: attachment.id,
      entityId: attachment.entityId,
      attachmentKind: attachment.kind,
      referenceId: attachment.referenceId,
      registration: attachment.registration,
      sourceClass: attachment.sourceClass,
      sensitivity: attachment.sensitivity,
      audience: attachment.audience,
      createdRevision: change.model.revision,
      recordedAt: revision.recordedAt,
    });
};

const persistRedirects = async (
  database: ProductCommandDatabase,
  before: ProductModel,
  change: ProductCommandCommit,
) => {
  const revision = requiredRevision(change);
  const changes = changedValues(before.redirects, change.model.redirects, ({ fromId }) => fromId);
  for (const redirect of [...changes.removed, ...changes.written])
    await database
      .update(productRedirectTable)
      .set({ supersededAt: revision.recordedAt })
      .where(
        and(
          eq(productRedirectTable.workspaceId, change.model.workspaceId),
          eq(productRedirectTable.fromEntityId, redirect.fromId),
          isNull(productRedirectTable.supersededAt),
        ),
      );
  for (const redirect of changes.written)
    await database.insert(productRedirectTable).values({
      workspaceId: change.model.workspaceId,
      fromEntityId: redirect.fromId,
      toEntityId: redirect.toId,
      createdRevision: change.model.revision,
      recordedAt: revision.recordedAt,
    });
};

const orphanKey = (orphan: ProductModel["orphans"][number]) =>
  `${orphan.sourceEntityId}\u0000${orphan.kind}\u0000${orphan.referenceId}`;

const persistOrphans = async (
  database: ProductCommandDatabase,
  before: ProductModel,
  change: ProductCommandCommit,
) => {
  const revision = requiredRevision(change);
  const changes = changedValues(before.orphans, change.model.orphans, orphanKey);
  for (const orphan of changes.removed)
    await database
      .update(productReferenceOrphanTable)
      .set({ resolvedRevision: change.model.revision, resolvedAt: revision.recordedAt })
      .where(
        and(
          eq(productReferenceOrphanTable.workspaceId, change.model.workspaceId),
          eq(productReferenceOrphanTable.sourceEntityId, orphan.sourceEntityId),
          eq(productReferenceOrphanTable.referenceKind, orphan.kind),
          eq(productReferenceOrphanTable.referenceId, orphan.referenceId),
          isNull(productReferenceOrphanTable.resolvedRevision),
        ),
      );
  for (const orphan of changes.written)
    await database.insert(productReferenceOrphanTable).values({
      workspaceId: change.model.workspaceId,
      sourceEntityId: orphan.sourceEntityId,
      referenceKind: orphan.kind,
      referenceId: orphan.referenceId,
      createdRevision: change.model.revision,
      recordedAt: revision.recordedAt,
    });
};

const persistCommit = async (
  database: ProductCommandDatabase,
  before: ProductModel,
  change: ProductCommandCommit,
) => {
  const revision = change.model.revisions.at(-1);
  if (revision === undefined || revision.revision !== change.model.revision)
    throw new ProductCommandPersistenceError(
      "transaction_failed",
      "Product revision metadata does not match the aggregate.",
    );
  await database.insert(productRevisionTable).values({
    workspaceId: change.model.workspaceId,
    revision: revision.revision,
    eventId: revision.eventId,
    eventType: revision.eventType,
    actorId: revision.actorId,
    validFrom: revision.validFrom,
    recordedAt: revision.recordedAt,
  });
  await persistEntities(database, before, change);
  await persistAliases(database, before, change);
  await persistHierarchy(database, before, change);
  await persistRelations(database, before, change);
  await persistVariants(database, before, change);
  await persistAttachments(database, before, change);
  await persistRedirects(database, before, change);
  await persistOrphans(database, before, change);
  const identityEvent = change.model.identityEvents.find(
    ({ revision: eventRevision }) => eventRevision === change.model.revision,
  );
  if (identityEvent !== undefined)
    await database.insert(productIdentityEventTable).values({
      workspaceId: change.model.workspaceId,
      id: identityEvent.id,
      revision: identityEvent.revision,
      eventType: identityEvent.type,
      entityIds: identityEvent.entityIds,
      details: identityEvent.details,
      actorId: identityEvent.actorId,
      validFrom: identityEvent.validFrom,
      recordedAt: identityEvent.recordedAt,
    });
  if (change.resolvedProposalId !== undefined) {
    const proposal = await database
      .update(productChangeProposalTable)
      .set({
        state: "approved",
        reviewedByActorId: change.audit.actorId,
        reviewedAt: change.audit.recordedAt,
      })
      .where(
        and(
          eq(productChangeProposalTable.workspaceId, change.model.workspaceId),
          eq(productChangeProposalTable.id, change.resolvedProposalId),
          eq(productChangeProposalTable.state, "pending"),
          gt(productChangeProposalTable.expiresAt, change.audit.recordedAt),
        ),
      )
      .returning({ id: productChangeProposalTable.id });
    if (proposal.length !== 1)
      throw new ProductCommandPersistenceError(
        "transaction_failed",
        "The product change proposal is unavailable for resolution.",
      );
  }
  await database.insert(productCommandAuditTable).values({
    workspaceId: change.audit.workspaceId,
    id: change.audit.id,
    requestId: change.audit.requestId,
    actorId: change.audit.actorId,
    commandType: change.audit.commandType,
    idempotencyKey: change.audit.idempotencyKey,
    commandHash: change.audit.commandHash,
    justification: change.audit.justification,
    outcome: "committed",
    resultingRevision: change.audit.resultingRevision,
    eventId: change.audit.eventId,
    impactSummary: change.audit.impactSummary,
    sensitivity: change.audit.sensitivity,
    audience: change.audit.audience,
    recordedAt: change.audit.recordedAt,
  });
  await database.insert(productOutboxEventTable).values({
    workspaceId: change.outbox.workspaceId,
    id: change.outbox.id,
    revision: change.outbox.revision,
    eventType: change.outbox.eventType,
    aggregateIds: change.outbox.aggregateIds,
    payload: change.outbox.payload,
    sensitivity: change.outbox.sensitivity,
    audience: change.outbox.audience,
    createdAt: change.outbox.createdAt,
    attemptCount: 0,
  });
};

const repositoryFailure = (error: unknown) =>
  error instanceof ProductCommandPersistenceError
    ? error
    : new RepositoryError({
        message: "Product command persistence failed.",
        operation: "product-model-command",
      });

const validateCommitBundle = (change: ProductCommandCommit) => {
  const revision = change.model.revisions.at(-1);
  if (
    change.model.workspaceId.trim() === "" ||
    change.model.revision !== change.expectedRevision + 1 ||
    revision?.revision !== change.model.revision ||
    revision.eventId !== change.audit.eventId ||
    change.audit.workspaceId !== change.model.workspaceId ||
    change.outbox.workspaceId !== change.model.workspaceId ||
    change.audit.commandHash !== change.commandHash ||
    change.audit.idempotencyKey !== change.idempotencyKey ||
    change.audit.resultingRevision !== change.model.revision ||
    change.outbox.revision !== change.model.revision
  )
    throw new ProductCommandPersistenceError(
      "transaction_failed",
      "The product command transaction bundle is inconsistent.",
    );
};

export const createPostgresProductModelCommandRepository = (
  database: KnowledgePostgresDatabase,
): ProductModelCommandRepository => ({
  replay: (workspaceId, idempotencyKey, commandHash) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await readReplay(database, workspaceId, idempotencyKey);
        return replayResult(rows[0] as ReplayRow | undefined, commandHash);
      },
      catch: repositoryFailure,
    }),
  current: (workspaceId) =>
    Effect.tryPromise({
      try: () => loadCurrent(database, workspaceId),
      catch: () =>
        new RepositoryError({
          message: "Product command aggregate read failed.",
          operation: "product-model-command-current",
        }),
    }),
  commit: (change) =>
    Effect.tryPromise({
      try: () =>
        database.transaction(async (transaction) => {
          validateCommitBundle(change);
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${change.model.workspaceId}, 0))`,
          );
          const replay = await readReplay(
            transaction,
            change.model.workspaceId,
            change.idempotencyKey,
          );
          const committed = replayResult(replay[0] as ReplayRow | undefined, change.commandHash);
          if (committed !== undefined) return committed;
          const revisionResult = await transaction.execute<RevisionRow>(sql`
            select coalesce(max(revision), 0)::integer as revision
            from product_revision
            where workspace_id = ${change.model.workspaceId}
          `);
          const currentRevision = revisionResult.rows[0]?.revision ?? 0;
          if (currentRevision !== change.expectedRevision)
            throw new ProductCommandPersistenceError(
              "stale_revision",
              `Expected product-model revision ${change.expectedRevision}; current revision is ${currentRevision}.`,
            );
          const before = (await loadCurrent(transaction, change.model.workspaceId)) ?? {
            workspaceId: change.model.workspaceId,
            revision: 0,
            entities: [],
            aliases: [],
            hierarchy: [],
            relations: [],
            variants: [],
            attachments: [],
            redirects: [],
            orphans: [],
            revisions: [],
            identityEvents: [],
          };
          await persistCommit(transaction, before, change);
          return {
            revision: change.model.revision,
            eventId: change.audit.eventId,
            changedEntityIds: change.responseEntityIds,
            replayed: false,
          };
        }),
      catch: repositoryFailure,
    }),
});

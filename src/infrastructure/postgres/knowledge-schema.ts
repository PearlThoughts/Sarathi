import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

const timestampColumn = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const knowledgeSourceTable = pgTable(
  "knowledge_source",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    authority: real("authority").notNull(),
    scopeHash: text("scope_hash").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestampColumn("created_at").notNull(),
    updatedAt: timestampColumn("updated_at").notNull(),
  },
  (table) => [uniqueIndex("knowledge_source_workspace_id").on(table.workspaceId, table.id)],
);

export const knowledgeItemTable = pgTable(
  "knowledge_item",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSourceTable.id),
    workspaceId: text("workspace_id").notNull(),
    externalId: text("external_id").notNull(),
    sourceType: text("source_type").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    sensitivity: text("sensitivity").notNull(),
    authority: real("authority").notNull(),
    sourceCreatedAt: timestampColumn("source_created_at"),
    sourceUpdatedAt: timestampColumn("source_updated_at").notNull(),
    observedAt: timestampColumn("observed_at").notNull(),
    deletedAt: timestampColumn("deleted_at"),
  },
  (table) => [
    uniqueIndex("knowledge_item_source_external").on(table.sourceId, table.externalId),
    index("knowledge_item_workspace_active").on(table.workspaceId, table.deletedAt),
  ],
);

export const knowledgeVersionTable = pgTable(
  "knowledge_version",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => knowledgeItemTable.id),
    workspaceId: text("workspace_id").notNull(),
    sourceVersion: text("source_version").notNull(),
    contentHash: text("content_hash").notNull(),
    sourceCreatedAt: timestampColumn("source_created_at"),
    sourceUpdatedAt: timestampColumn("source_updated_at").notNull(),
    observedAt: timestampColumn("observed_at").notNull(),
    active: boolean("active").notNull().default(true),
    tombstone: boolean("tombstone").notNull().default(false),
    provenance: jsonb("provenance").$type<Readonly<Record<string, string>>>().notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_version_item_source_version").on(table.itemId, table.sourceVersion),
    index("knowledge_version_workspace_active").on(
      table.workspaceId,
      table.active,
      table.tombstone,
    ),
  ],
);

export const knowledgePassageTable = pgTable(
  "knowledge_passage",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => knowledgeItemTable.id),
    versionId: text("version_id")
      .notNull()
      .references(() => knowledgeVersionTable.id),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    locator: text("locator").notNull(),
    ordinal: integer("ordinal").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    contentHash: text("content_hash").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    sensitivity: text("sensitivity").notNull(),
    sourceUpdatedAt: timestampColumn("source_updated_at").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    uniqueIndex("knowledge_passage_version_locator").on(table.versionId, table.locator),
    index("knowledge_passage_workspace_active").on(table.workspaceId, table.active),
    index("knowledge_passage_search").using(
      "gin",
      sql`to_tsvector('english', ${table.title} || ' ' || ${table.body})`,
    ),
  ],
);

export const knowledgeAclBindingTable = pgTable(
  "knowledge_acl_binding",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    passageId: text("passage_id")
      .notNull()
      .references(() => knowledgePassageTable.id),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    effect: text("effect").notNull(),
    createdAt: timestampColumn("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_acl_passage_subject").on(
      table.passageId,
      table.subjectType,
      table.subjectId,
      table.effect,
    ),
    index("knowledge_acl_workspace_subject").on(
      table.workspaceId,
      table.subjectType,
      table.subjectId,
    ),
  ],
);

export const knowledgeProjectionTable = pgTable(
  "knowledge_projection",
  {
    passageId: text("passage_id")
      .primaryKey()
      .references(() => knowledgePassageTable.id),
    workspaceId: text("workspace_id").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    embeddingDimensions: integer("embedding_dimensions").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestampColumn("created_at").notNull(),
  },
  (table) => [
    index("knowledge_projection_embedding_hnsw").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("knowledge_projection_workspace").on(table.workspaceId),
  ],
);

export const knowledgeSyncCheckpointTable = pgTable(
  "knowledge_sync_checkpoint",
  {
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSourceTable.id),
    workspaceId: text("workspace_id").notNull(),
    cursor: text("cursor").notNull(),
    scopeHash: text("scope_hash").notNull(),
    documentsObserved: integer("documents_observed").notNull(),
    versionsCreated: integer("versions_created").notNull(),
    passagesActive: integer("passages_active").notNull(),
    itemsDeleted: integer("items_deleted").notNull(),
    checksum: text("checksum").notNull(),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    indexedSourceRevision: text("indexed_source_revision"),
    lastEventAt: timestampColumn("last_event_at"),
    lastReconciledAt: timestampColumn("last_reconciled_at"),
    newestSourceUpdatedAt: timestampColumn("newest_source_updated_at"),
    lastSucceededAt: timestampColumn("last_succeeded_at"),
    lagSeconds: integer("lag_seconds"),
    retryCount: integer("retry_count").notNull().default(0),
    nextReconcileAt: timestampColumn("next_reconcile_at"),
    failureClass: text("failure_class"),
    syncedAt: timestampColumn("synced_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.workspaceId] }),
    index("knowledge_checkpoint_workspace").on(table.workspaceId, table.syncedAt),
    index("knowledge_checkpoint_next_reconcile").on(table.nextReconcileAt, table.status),
    check(
      "knowledge_checkpoint_nonnegative_operational_counts",
      sql`${table.retryCount} >= 0 and (${table.lagSeconds} is null or ${table.lagSeconds} >= 0)`,
    ),
  ],
);

export const knowledgeSyncEventDeliveryTable = pgTable(
  "knowledge_sync_event_delivery",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    sourceKind: text("source_kind").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    sourceVersion: text("source_version"),
    payloadHash: text("payload_hash").notNull(),
    sourceOccurredAt: timestampColumn("source_occurred_at"),
    receivedAt: timestampColumn("received_at").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestampColumn("next_attempt_at"),
    processedAt: timestampColumn("processed_at"),
    failureClass: text("failure_class"),
  },
  (table) => [
    uniqueIndex("knowledge_sync_event_source_provider_id").on(
      table.workspaceId,
      table.sourceId,
      table.providerEventId,
    ),
    index("knowledge_sync_event_retry").on(table.status, table.nextAttemptAt),
    index("knowledge_sync_event_source_received").on(
      table.workspaceId,
      table.sourceId,
      table.receivedAt,
    ),
    check("knowledge_sync_event_attempt_count", sql`${table.attemptCount} >= 0`),
  ],
);

export const knowledgeSyncSubscriptionTable = pgTable(
  "knowledge_sync_subscription",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    sourceKind: text("source_kind").notNull(),
    provider: text("provider").notNull(),
    resourceHash: text("resource_hash").notNull(),
    status: text("status").notNull(),
    expiresAt: timestampColumn("expires_at"),
    renewedAt: timestampColumn("renewed_at"),
    nextRenewalAt: timestampColumn("next_renewal_at"),
    retryCount: integer("retry_count").notNull().default(0),
    failureClass: text("failure_class"),
    updatedAt: timestampColumn("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_sync_subscription_source_provider_resource").on(
      table.workspaceId,
      table.sourceId,
      table.provider,
      table.resourceHash,
    ),
    index("knowledge_sync_subscription_renewal").on(table.status, table.nextRenewalAt),
    check("knowledge_sync_subscription_retry_count", sql`${table.retryCount} >= 0`),
  ],
);

export const knowledgeSyncLeaseTable = pgTable(
  "knowledge_sync_lease",
  {
    workspaceId: text("workspace_id").notNull(),
    sourceId: text("source_id").notNull(),
    operation: text("operation").notNull(),
    ownerId: text("owner_id").notNull(),
    acquiredAt: timestampColumn("acquired_at").notNull(),
    heartbeatAt: timestampColumn("heartbeat_at").notNull(),
    expiresAt: timestampColumn("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.sourceId, table.operation] }),
    index("knowledge_sync_lease_expiry").on(table.expiresAt),
    check("knowledge_sync_lease_time_order", sql`${table.expiresAt} > ${table.acquiredAt}`),
  ],
);

export const knowledgeSyncRunTable = pgTable(
  "knowledge_sync_run",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    cursorBefore: text("cursor_before"),
    cursorAfter: text("cursor_after"),
    scopeHash: text("scope_hash").notNull(),
    newestSourceUpdatedAt: timestampColumn("newest_source_updated_at"),
    lagSeconds: integer("lag_seconds"),
    attemptCount: integer("attempt_count").notNull().default(1),
    failureClass: text("failure_class"),
    startedAt: timestampColumn("started_at").notNull(),
    completedAt: timestampColumn("completed_at"),
  },
  (table) => [
    index("knowledge_sync_run_source_started").on(
      table.workspaceId,
      table.sourceId,
      table.startedAt,
    ),
    index("knowledge_sync_run_status").on(table.status, table.startedAt),
    check(
      "knowledge_sync_run_nonnegative_operational_counts",
      sql`${table.attemptCount} >= 1 and (${table.lagSeconds} is null or ${table.lagSeconds} >= 0)`,
    ),
  ],
);

export const deliveryObjectTable = pgTable(
  "delivery_object",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    objectKind: text("object_kind").notNull(),
    externalKey: text("external_key").notNull(),
    canonicalKey: text("canonical_key").notNull(),
    title: text("title").notNull(),
    lifecycleState: text("lifecycle_state"),
    attributes: jsonb("attributes").$type<Readonly<Record<string, unknown>>>().notNull(),
    sensitivity: text("sensitivity").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSourceTable.id),
    sourceItemId: text("source_item_id")
      .notNull()
      .references(() => knowledgeItemTable.id),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => knowledgeVersionTable.id),
    effectiveFrom: timestampColumn("effective_from"),
    effectiveTo: timestampColumn("effective_to"),
    sourceCreatedAt: timestampColumn("source_created_at"),
    sourceUpdatedAt: timestampColumn("source_updated_at").notNull(),
    observedAt: timestampColumn("observed_at").notNull(),
    indexedAt: timestampColumn("indexed_at").notNull(),
    active: boolean("active").notNull().default(true),
    deletedAt: timestampColumn("deleted_at"),
  },
  (table) => [
    uniqueIndex("delivery_object_workspace_source_kind_key").on(
      table.workspaceId,
      table.sourceId,
      table.objectKind,
      table.externalKey,
    ),
    index("delivery_object_workspace_kind_active").on(
      table.workspaceId,
      table.objectKind,
      table.active,
      table.deletedAt,
    ),
    index("delivery_object_workspace_canonical").on(
      table.workspaceId,
      table.objectKind,
      table.canonicalKey,
      table.active,
      table.deletedAt,
    ),
    index("delivery_object_source_version").on(table.sourceVersionId),
  ],
);

export const deliveryEntityAliasTable = pgTable(
  "delivery_entity_alias",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    objectKind: text("object_kind").notNull(),
    canonicalKey: text("canonical_key").notNull(),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    sourceObjectId: text("source_object_id")
      .notNull()
      .references(() => deliveryObjectTable.id),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSourceTable.id),
    sensitivity: text("sensitivity").notNull(),
    sourceUpdatedAt: timestampColumn("source_updated_at").notNull(),
    indexedAt: timestampColumn("indexed_at").notNull(),
    active: boolean("active").notNull().default(true),
    deletedAt: timestampColumn("deleted_at"),
  },
  (table) => [
    uniqueIndex("delivery_entity_alias_object_normalized").on(
      table.sourceObjectId,
      table.normalizedAlias,
    ),
    index("delivery_entity_alias_workspace_lookup").on(
      table.workspaceId,
      table.objectKind,
      table.normalizedAlias,
      table.active,
      table.deletedAt,
    ),
    index("delivery_entity_alias_workspace_canonical").on(
      table.workspaceId,
      table.objectKind,
      table.canonicalKey,
      table.active,
      table.deletedAt,
    ),
  ],
);

export const deliveryRelationTable = pgTable(
  "delivery_relation",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    relationKind: text("relation_kind").notNull(),
    fromObjectId: text("from_object_id")
      .notNull()
      .references(() => deliveryObjectTable.id),
    toObjectId: text("to_object_id")
      .notNull()
      .references(() => deliveryObjectTable.id),
    attributes: jsonb("attributes").$type<Readonly<Record<string, unknown>>>().notNull(),
    sensitivity: text("sensitivity").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSourceTable.id),
    sourceItemId: text("source_item_id")
      .notNull()
      .references(() => knowledgeItemTable.id),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => knowledgeVersionTable.id),
    effectiveFrom: timestampColumn("effective_from"),
    effectiveTo: timestampColumn("effective_to"),
    sourceCreatedAt: timestampColumn("source_created_at"),
    sourceUpdatedAt: timestampColumn("source_updated_at").notNull(),
    observedAt: timestampColumn("observed_at").notNull(),
    indexedAt: timestampColumn("indexed_at").notNull(),
    active: boolean("active").notNull().default(true),
    deletedAt: timestampColumn("deleted_at"),
  },
  (table) => [
    uniqueIndex("delivery_relation_workspace_edge").on(
      table.workspaceId,
      table.sourceId,
      table.relationKind,
      table.fromObjectId,
      table.toObjectId,
      table.sourceVersionId,
    ),
    index("delivery_relation_workspace_kind_active").on(
      table.workspaceId,
      table.relationKind,
      table.active,
      table.deletedAt,
    ),
    index("delivery_relation_from_object").on(table.fromObjectId),
    index("delivery_relation_to_object").on(table.toObjectId),
  ],
);

export const deliveryObservationTable = pgTable(
  "delivery_observation",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    observationKind: text("observation_kind").notNull(),
    externalId: text("external_id").notNull(),
    subjectObjectId: text("subject_object_id").references(() => deliveryObjectTable.id),
    actorExternalKey: text("actor_external_key"),
    summary: text("summary").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    occurredAt: timestampColumn("occurred_at").notNull(),
    sourceCreatedAt: timestampColumn("source_created_at"),
    sourceUpdatedAt: timestampColumn("source_updated_at").notNull(),
    observedAt: timestampColumn("observed_at").notNull(),
    indexedAt: timestampColumn("indexed_at").notNull(),
    sensitivity: text("sensitivity").notNull(),
    authority: real("authority").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSourceTable.id),
    sourceItemId: text("source_item_id")
      .notNull()
      .references(() => knowledgeItemTable.id),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => knowledgeVersionTable.id),
    citationUrl: text("citation_url").notNull(),
    active: boolean("active").notNull().default(true),
    deletedAt: timestampColumn("deleted_at"),
  },
  (table) => [
    uniqueIndex("delivery_observation_workspace_source_external").on(
      table.workspaceId,
      table.sourceId,
      table.externalId,
    ),
    index("delivery_observation_workspace_kind_active").on(
      table.workspaceId,
      table.observationKind,
      table.active,
      table.deletedAt,
    ),
    index("delivery_observation_workspace_dedupe").on(
      table.workspaceId,
      table.dedupeKey,
      table.active,
    ),
    index("delivery_observation_occurred").on(table.workspaceId, table.occurredAt),
  ],
);

export const deliveryMetricTable = pgTable(
  "delivery_metric",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    subjectObjectId: text("subject_object_id")
      .notNull()
      .references(() => deliveryObjectTable.id),
    metricCategory: text("metric_category").notNull(),
    metricKind: text("metric_kind").notNull(),
    value: decimal("value", { precision: 24, scale: 6 }).notNull(),
    unit: text("unit").notNull(),
    effectiveFrom: timestampColumn("effective_from"),
    effectiveTo: timestampColumn("effective_to"),
    sourceCreatedAt: timestampColumn("source_created_at"),
    sourceUpdatedAt: timestampColumn("source_updated_at").notNull(),
    sensitivity: text("sensitivity").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSourceTable.id),
    sourceItemId: text("source_item_id")
      .notNull()
      .references(() => knowledgeItemTable.id),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => knowledgeVersionTable.id),
    observedAt: timestampColumn("observed_at").notNull(),
    indexedAt: timestampColumn("indexed_at").notNull(),
    active: boolean("active").notNull().default(true),
    deletedAt: timestampColumn("deleted_at"),
  },
  (table) => [
    uniqueIndex("delivery_metric_workspace_subject_kind_effective").on(
      table.workspaceId,
      table.subjectObjectId,
      table.metricKind,
      table.effectiveFrom,
      table.sourceVersionId,
    ),
    index("delivery_metric_workspace_category_kind_active").on(
      table.workspaceId,
      table.metricCategory,
      table.metricKind,
      table.active,
      table.deletedAt,
    ),
    check("delivery_metric_excludes_finance", sql`${table.metricCategory} <> 'finance'`),
  ],
);

export const deliveryFinanceMetricTable = pgTable(
  "delivery_finance_metric",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    subjectObjectId: text("subject_object_id")
      .notNull()
      .references(() => deliveryObjectTable.id),
    metricKind: text("metric_kind").notNull(),
    value: decimal("value", { precision: 24, scale: 6 }).notNull(),
    unit: text("unit").notNull(),
    effectiveFrom: timestampColumn("effective_from"),
    effectiveTo: timestampColumn("effective_to"),
    sourceCreatedAt: timestampColumn("source_created_at"),
    sourceUpdatedAt: timestampColumn("source_updated_at").notNull(),
    sensitivity: text("sensitivity").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSourceTable.id),
    sourceItemId: text("source_item_id")
      .notNull()
      .references(() => knowledgeItemTable.id),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => knowledgeVersionTable.id),
    observedAt: timestampColumn("observed_at").notNull(),
    indexedAt: timestampColumn("indexed_at").notNull(),
    active: boolean("active").notNull().default(true),
    deletedAt: timestampColumn("deleted_at"),
  },
  (table) => [
    uniqueIndex("delivery_finance_metric_workspace_subject_kind_effective").on(
      table.workspaceId,
      table.subjectObjectId,
      table.metricKind,
      table.effectiveFrom,
      table.sourceVersionId,
    ),
    index("delivery_finance_metric_workspace_kind_active").on(
      table.workspaceId,
      table.metricKind,
      table.active,
      table.deletedAt,
    ),
    check(
      "delivery_finance_metric_confidential",
      sql`${table.sensitivity} in ('confidential', 'restricted')`,
    ),
  ],
);

export const deliveryClaimTable = pgTable(
  "delivery_claim",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    subjectObjectId: text("subject_object_id").references(() => deliveryObjectTable.id),
    subjectKey: text("subject_key").notNull(),
    predicate: text("predicate").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    valueHash: text("value_hash").notNull(),
    assertedBy: text("asserted_by"),
    externalAssertionId: text("external_assertion_id"),
    supersedesAssertionIds: jsonb("supersedes_assertion_ids")
      .$type<readonly string[]>()
      .notNull()
      .default([]),
    confidence: real("confidence"),
    assertionSchemaVersion: integer("assertion_schema_version"),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSourceTable.id),
    sourceItemId: text("source_item_id")
      .notNull()
      .references(() => knowledgeItemTable.id),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => knowledgeVersionTable.id),
    citationUrl: text("citation_url").notNull(),
    assertedAt: timestampColumn("asserted_at").notNull(),
    sourceCreatedAt: timestampColumn("source_created_at"),
    sourceUpdatedAt: timestampColumn("source_updated_at").notNull(),
    observedAt: timestampColumn("observed_at").notNull(),
    indexedAt: timestampColumn("indexed_at").notNull(),
    effectiveFrom: timestampColumn("effective_from"),
    effectiveTo: timestampColumn("effective_to"),
    sensitivity: text("sensitivity").notNull(),
    authority: real("authority").notNull(),
    active: boolean("active").notNull().default(true),
    deletedAt: timestampColumn("deleted_at"),
  },
  (table) => [
    uniqueIndex("delivery_claim_source_value").on(
      table.sourceVersionId,
      table.subjectKey,
      table.predicate,
      table.valueHash,
    ),
    index("delivery_claim_workspace_subject_predicate").on(
      table.workspaceId,
      table.subjectKey,
      table.predicate,
      table.active,
      table.deletedAt,
    ),
    index("delivery_claim_subject_object").on(table.subjectObjectId),
    index("delivery_claim_external_assertion").on(
      table.workspaceId,
      table.externalAssertionId,
      table.active,
      table.deletedAt,
    ),
    check(
      "delivery_claim_confidence_range",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
    ),
    check(
      "delivery_claim_schema_version_positive",
      sql`${table.assertionSchemaVersion} is null or ${table.assertionSchemaVersion} >= 1`,
    ),
  ],
);

export const deliveryAclBindingTable = pgTable(
  "delivery_acl_binding",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    effect: text("effect").notNull(),
    createdAt: timestampColumn("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("delivery_acl_target_subject").on(
      table.targetType,
      table.targetId,
      table.subjectType,
      table.subjectId,
      table.effect,
    ),
    index("delivery_acl_workspace_subject").on(
      table.workspaceId,
      table.subjectType,
      table.subjectId,
    ),
  ],
);

export const knowledgePostgresSchema = {
  knowledgeSourceTable,
  knowledgeItemTable,
  knowledgeVersionTable,
  knowledgePassageTable,
  knowledgeAclBindingTable,
  knowledgeProjectionTable,
  knowledgeSyncCheckpointTable,
  knowledgeSyncEventDeliveryTable,
  knowledgeSyncSubscriptionTable,
  knowledgeSyncLeaseTable,
  knowledgeSyncRunTable,
  deliveryObjectTable,
  deliveryEntityAliasTable,
  deliveryRelationTable,
  deliveryObservationTable,
  deliveryMetricTable,
  deliveryFinanceMetricTable,
  deliveryClaimTable,
  deliveryAclBindingTable,
};

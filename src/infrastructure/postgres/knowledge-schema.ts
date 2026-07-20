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
    syncedAt: timestampColumn("synced_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.workspaceId] }),
    index("knowledge_checkpoint_workspace").on(table.workspaceId, table.syncedAt),
  ],
);

export const deliveryObjectTable = pgTable(
  "delivery_object",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    objectKind: text("object_kind").notNull(),
    externalKey: text("external_key").notNull(),
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
    observedAt: timestampColumn("observed_at").notNull(),
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
    index("delivery_object_source_version").on(table.sourceVersionId),
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
    observedAt: timestampColumn("observed_at").notNull(),
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
    observedAt: timestampColumn("observed_at").notNull(),
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
    observedAt: timestampColumn("observed_at").notNull(),
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
  deliveryObjectTable,
  deliveryRelationTable,
  deliveryObservationTable,
  deliveryMetricTable,
  deliveryFinanceMetricTable,
  deliveryClaimTable,
  deliveryAclBindingTable,
};

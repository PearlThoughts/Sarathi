import { sql } from "drizzle-orm";
import {
  boolean,
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

export const knowledgePostgresSchema = {
  knowledgeSourceTable,
  knowledgeItemTable,
  knowledgeVersionTable,
  knowledgePassageTable,
  knowledgeAclBindingTable,
  knowledgeProjectionTable,
  knowledgeSyncCheckpointTable,
};

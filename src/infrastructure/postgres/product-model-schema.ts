import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestampColumn = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
const audienceColumn = () => jsonb("audience").$type<readonly string[]>().notNull();

export const productRevisionTable = pgTable(
  "product_revision",
  {
    workspaceId: text("workspace_id").notNull(),
    revision: integer("revision").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    actorId: text("actor_id").notNull(),
    validFrom: timestampColumn("valid_from").notNull(),
    recordedAt: timestampColumn("recorded_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.revision] }),
    uniqueIndex("product_revision_workspace_event").on(table.workspaceId, table.eventId),
    index("product_revision_workspace_valid_time").on(
      table.workspaceId,
      table.validFrom,
      table.revision,
    ),
    check("product_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const productEntityTable = pgTable(
  "product_entity",
  {
    workspaceId: text("workspace_id").notNull(),
    id: uuid("id").notNull(),
    kind: text("kind").notNull(),
    createdRevision: integer("created_revision").notNull(),
    createdAt: timestampColumn("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    uniqueIndex("product_entity_workspace_id_kind").on(table.workspaceId, table.id, table.kind),
    foreignKey({
      columns: [table.workspaceId, table.createdRevision],
      foreignColumns: [productRevisionTable.workspaceId, productRevisionTable.revision],
      name: "product_entity_created_revision_fk",
    }),
    index("product_entity_workspace_kind").on(table.workspaceId, table.kind, table.id),
    check(
      "product_entity_kind",
      sql`${table.kind} in ('product', 'area', 'capability', 'feature')`,
    ),
  ],
);

export const productEntityStateTable = pgTable(
  "product_entity_state",
  {
    workspaceId: text("workspace_id").notNull(),
    entityId: uuid("entity_id").notNull(),
    revision: integer("revision").notNull(),
    canonicalName: text("canonical_name").notNull(),
    description: text("description"),
    registration: text("registration").notNull(),
    lifecycle: text("lifecycle").notNull(),
    sensitivity: text("sensitivity").notNull(),
    audience: audienceColumn(),
    validFrom: timestampColumn("valid_from").notNull(),
    validTo: timestampColumn("valid_to"),
    recordedAt: timestampColumn("recorded_at").notNull(),
    supersededAt: timestampColumn("superseded_at"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.entityId, table.revision] }),
    foreignKey({
      columns: [table.workspaceId, table.entityId],
      foreignColumns: [productEntityTable.workspaceId, productEntityTable.id],
      name: "product_entity_state_entity_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.revision],
      foreignColumns: [productRevisionTable.workspaceId, productRevisionTable.revision],
      name: "product_entity_state_revision_fk",
    }),
    uniqueIndex("product_entity_state_current")
      .on(table.workspaceId, table.entityId)
      .where(sql`${table.supersededAt} is null`),
    index("product_entity_state_workspace_revision").on(table.workspaceId, table.revision),
    index("product_entity_state_workspace_valid_time").on(
      table.workspaceId,
      table.validFrom,
      table.validTo,
    ),
    check(
      "product_entity_state_registration",
      sql`${table.registration} in ('candidate', 'ratified', 'contested', 'superseded')`,
    ),
    check(
      "product_entity_state_lifecycle",
      sql`${table.lifecycle} in ('planned', 'available', 'deprecated', 'retired', 'unknown')`,
    ),
    check(
      "product_entity_state_validity",
      sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
    ),
    check(
      "product_entity_state_recording",
      sql`${table.supersededAt} is null or ${table.supersededAt} >= ${table.recordedAt}`,
    ),
  ],
);

export const productEntityAliasTable = pgTable(
  "product_entity_alias",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    entityId: uuid("entity_id").notNull(),
    entityKind: text("entity_kind").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    kind: text("kind").notNull(),
    sourceClass: text("source_class"),
    sensitivity: text("sensitivity").notNull(),
    audience: audienceColumn(),
    createdRevision: integer("created_revision").notNull(),
    validFrom: timestampColumn("valid_from").notNull(),
    validTo: timestampColumn("valid_to"),
    recordedAt: timestampColumn("recorded_at").notNull(),
    supersededAt: timestampColumn("superseded_at"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id, table.createdRevision] }),
    foreignKey({
      columns: [table.workspaceId, table.entityId, table.entityKind],
      foreignColumns: [
        productEntityTable.workspaceId,
        productEntityTable.id,
        productEntityTable.kind,
      ],
      name: "product_entity_alias_entity_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.createdRevision],
      foreignColumns: [productRevisionTable.workspaceId, productRevisionTable.revision],
      name: "product_entity_alias_revision_fk",
    }),
    uniqueIndex("product_entity_alias_current_lookup")
      .on(table.workspaceId, table.entityKind, table.normalizedValue)
      .where(sql`${table.supersededAt} is null and ${table.validTo} is null`),
    index("product_entity_alias_entity").on(table.workspaceId, table.entityId),
    check(
      "product_entity_alias_kind",
      sql`${table.kind} in ('canonical', 'former_name', 'alternate', 'abbreviation')`,
    ),
    check(
      "product_entity_alias_validity",
      sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

export const productHierarchyEdgeTable = pgTable(
  "product_hierarchy_edge",
  {
    workspaceId: text("workspace_id").notNull(),
    childId: uuid("child_id").notNull(),
    parentId: uuid("parent_id").notNull(),
    createdRevision: integer("created_revision").notNull(),
    validFrom: timestampColumn("valid_from").notNull(),
    validTo: timestampColumn("valid_to"),
    recordedAt: timestampColumn("recorded_at").notNull(),
    supersededAt: timestampColumn("superseded_at"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.childId, table.createdRevision] }),
    foreignKey({
      columns: [table.workspaceId, table.childId],
      foreignColumns: [productEntityTable.workspaceId, productEntityTable.id],
      name: "product_hierarchy_edge_child_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.parentId],
      foreignColumns: [productEntityTable.workspaceId, productEntityTable.id],
      name: "product_hierarchy_edge_parent_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.createdRevision],
      foreignColumns: [productRevisionTable.workspaceId, productRevisionTable.revision],
      name: "product_hierarchy_edge_revision_fk",
    }),
    uniqueIndex("product_hierarchy_edge_current_parent")
      .on(table.workspaceId, table.childId)
      .where(sql`${table.supersededAt} is null and ${table.validTo} is null`),
    index("product_hierarchy_edge_current_children").on(
      table.workspaceId,
      table.parentId,
      table.supersededAt,
      table.validTo,
    ),
    check("product_hierarchy_edge_not_self", sql`${table.childId} <> ${table.parentId}`),
    check(
      "product_hierarchy_edge_validity",
      sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

export const productRelationTable = pgTable(
  "product_relation",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    relationType: text("relation_type").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceEntityId: uuid("source_entity_id"),
    sourceReferenceKind: text("source_reference_kind"),
    sourceReferenceId: text("source_reference_id"),
    targetKind: text("target_kind").notNull(),
    targetEntityId: uuid("target_entity_id"),
    targetReferenceKind: text("target_reference_kind"),
    targetReferenceId: text("target_reference_id"),
    registration: text("registration").notNull(),
    sourceClass: text("source_class").notNull(),
    sensitivity: text("sensitivity").notNull(),
    audience: audienceColumn(),
    createdRevision: integer("created_revision").notNull(),
    validFrom: timestampColumn("valid_from").notNull(),
    validTo: timestampColumn("valid_to"),
    recordedAt: timestampColumn("recorded_at").notNull(),
    supersededAt: timestampColumn("superseded_at"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id, table.createdRevision] }),
    foreignKey({
      columns: [table.workspaceId, table.sourceEntityId],
      foreignColumns: [productEntityTable.workspaceId, productEntityTable.id],
      name: "product_relation_source_entity_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.targetEntityId],
      foreignColumns: [productEntityTable.workspaceId, productEntityTable.id],
      name: "product_relation_target_entity_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.createdRevision],
      foreignColumns: [productRevisionTable.workspaceId, productRevisionTable.revision],
      name: "product_relation_revision_fk",
    }),
    uniqueIndex("product_relation_current_id")
      .on(table.workspaceId, table.id)
      .where(sql`${table.supersededAt} is null`),
    index("product_relation_current_source").on(
      table.workspaceId,
      table.sourceEntityId,
      table.relationType,
      table.supersededAt,
    ),
    index("product_relation_current_target").on(
      table.workspaceId,
      table.targetEntityId,
      table.relationType,
      table.supersededAt,
    ),
    check("product_relation_source_kind", sql`${table.sourceKind} in ('entity', 'external')`),
    check("product_relation_target_kind", sql`${table.targetKind} in ('entity', 'external')`),
    check(
      "product_relation_source_shape",
      sql`(${table.sourceKind} = 'entity' and ${table.sourceEntityId} is not null and ${table.sourceReferenceKind} is null and ${table.sourceReferenceId} is null) or (${table.sourceKind} = 'external' and ${table.sourceEntityId} is null and ${table.sourceReferenceKind} is not null and ${table.sourceReferenceId} is not null)`,
    ),
    check(
      "product_relation_target_shape",
      sql`(${table.targetKind} = 'entity' and ${table.targetEntityId} is not null and ${table.targetReferenceKind} is null and ${table.targetReferenceId} is null) or (${table.targetKind} = 'external' and ${table.targetEntityId} is null and ${table.targetReferenceKind} is not null and ${table.targetReferenceId} is not null)`,
    ),
    check(
      "product_relation_validity",
      sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

export const productVariantTable = pgTable(
  "product_variant",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    baseEntityId: uuid("base_entity_id").notNull(),
    qualifiers: jsonb("qualifiers").$type<Readonly<Record<string, string>>>().notNull(),
    delta: jsonb("delta")
      .$type<Readonly<Record<string, string | number | boolean | null>>>()
      .notNull(),
    precedence: integer("precedence").notNull(),
    registration: text("registration").notNull(),
    sourceClass: text("source_class").notNull(),
    sensitivity: text("sensitivity").notNull(),
    audience: audienceColumn(),
    createdRevision: integer("created_revision").notNull(),
    validFrom: timestampColumn("valid_from").notNull(),
    validTo: timestampColumn("valid_to"),
    recordedAt: timestampColumn("recorded_at").notNull(),
    supersededAt: timestampColumn("superseded_at"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id, table.createdRevision] }),
    foreignKey({
      columns: [table.workspaceId, table.baseEntityId],
      foreignColumns: [productEntityTable.workspaceId, productEntityTable.id],
      name: "product_variant_base_entity_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.createdRevision],
      foreignColumns: [productRevisionTable.workspaceId, productRevisionTable.revision],
      name: "product_variant_revision_fk",
    }),
    uniqueIndex("product_variant_current_id")
      .on(table.workspaceId, table.id)
      .where(sql`${table.supersededAt} is null`),
    index("product_variant_current_base").on(
      table.workspaceId,
      table.baseEntityId,
      table.supersededAt,
      table.validFrom,
      table.validTo,
    ),
    check(
      "product_variant_validity",
      sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

export const productEntityAttachmentTable = pgTable(
  "product_entity_attachment",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    entityId: uuid("entity_id").notNull(),
    attachmentKind: text("attachment_kind").notNull(),
    referenceId: text("reference_id").notNull(),
    registration: text("registration").notNull(),
    sourceClass: text("source_class").notNull(),
    sensitivity: text("sensitivity").notNull(),
    audience: audienceColumn(),
    createdRevision: integer("created_revision").notNull(),
    recordedAt: timestampColumn("recorded_at").notNull(),
    supersededAt: timestampColumn("superseded_at"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id, table.createdRevision] }),
    foreignKey({
      columns: [table.workspaceId, table.entityId],
      foreignColumns: [productEntityTable.workspaceId, productEntityTable.id],
      name: "product_entity_attachment_entity_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.createdRevision],
      foreignColumns: [productRevisionTable.workspaceId, productRevisionTable.revision],
      name: "product_entity_attachment_revision_fk",
    }),
    uniqueIndex("product_entity_attachment_current_id")
      .on(table.workspaceId, table.id)
      .where(sql`${table.supersededAt} is null`),
    index("product_entity_attachment_current_entity").on(
      table.workspaceId,
      table.entityId,
      table.supersededAt,
    ),
    check(
      "product_entity_attachment_kind",
      sql`${table.attachmentKind} in ('claim', 'delivery_reference', 'external_reference')`,
    ),
  ],
);

export const productRedirectTable = pgTable(
  "product_redirect",
  {
    workspaceId: text("workspace_id").notNull(),
    fromEntityId: uuid("from_entity_id").notNull(),
    toEntityId: uuid("to_entity_id").notNull(),
    createdRevision: integer("created_revision").notNull(),
    recordedAt: timestampColumn("recorded_at").notNull(),
    supersededAt: timestampColumn("superseded_at"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.fromEntityId, table.createdRevision] }),
    foreignKey({
      columns: [table.workspaceId, table.fromEntityId],
      foreignColumns: [productEntityTable.workspaceId, productEntityTable.id],
      name: "product_redirect_from_entity_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.toEntityId],
      foreignColumns: [productEntityTable.workspaceId, productEntityTable.id],
      name: "product_redirect_to_entity_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.createdRevision],
      foreignColumns: [productRevisionTable.workspaceId, productRevisionTable.revision],
      name: "product_redirect_revision_fk",
    }),
    uniqueIndex("product_redirect_current_source")
      .on(table.workspaceId, table.fromEntityId)
      .where(sql`${table.supersededAt} is null`),
    index("product_redirect_current_target").on(
      table.workspaceId,
      table.toEntityId,
      table.supersededAt,
    ),
    check("product_redirect_not_self", sql`${table.fromEntityId} <> ${table.toEntityId}`),
  ],
);

export const productReferenceOrphanTable = pgTable(
  "product_reference_orphan",
  {
    workspaceId: text("workspace_id").notNull(),
    sourceEntityId: uuid("source_entity_id").notNull(),
    referenceKind: text("reference_kind").notNull(),
    referenceId: text("reference_id").notNull(),
    createdRevision: integer("created_revision").notNull(),
    recordedAt: timestampColumn("recorded_at").notNull(),
    resolvedRevision: integer("resolved_revision"),
    resolvedAt: timestampColumn("resolved_at"),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.sourceEntityId,
        table.referenceKind,
        table.referenceId,
        table.createdRevision,
      ],
    }),
    foreignKey({
      columns: [table.workspaceId, table.sourceEntityId],
      foreignColumns: [productEntityTable.workspaceId, productEntityTable.id],
      name: "product_reference_orphan_source_entity_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.createdRevision],
      foreignColumns: [productRevisionTable.workspaceId, productRevisionTable.revision],
      name: "product_reference_orphan_created_revision_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.resolvedRevision],
      foreignColumns: [productRevisionTable.workspaceId, productRevisionTable.revision],
      name: "product_reference_orphan_resolved_revision_fk",
    }),
    index("product_reference_orphan_unresolved").on(
      table.workspaceId,
      table.sourceEntityId,
      table.resolvedRevision,
    ),
    check(
      "product_reference_orphan_kind",
      sql`${table.referenceKind} in ('alias', 'variant', 'relation_source', 'relation_target', 'attachment', 'child')`,
    ),
    check(
      "product_reference_orphan_resolution",
      sql`(${table.resolvedRevision} is null and ${table.resolvedAt} is null) or (${table.resolvedRevision} is not null and ${table.resolvedAt} is not null)`,
    ),
  ],
);

export const productIdentityEventTable = pgTable(
  "product_identity_event",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    revision: integer("revision").notNull(),
    eventType: text("event_type").notNull(),
    entityIds: jsonb("entity_ids").$type<readonly string[]>().notNull(),
    details: jsonb("details")
      .$type<Readonly<Record<string, string | readonly string[]>>>()
      .notNull(),
    actorId: text("actor_id").notNull(),
    validFrom: timestampColumn("valid_from").notNull(),
    recordedAt: timestampColumn("recorded_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.revision],
      foreignColumns: [productRevisionTable.workspaceId, productRevisionTable.revision],
      name: "product_identity_event_revision_fk",
    }),
    uniqueIndex("product_identity_event_workspace_revision").on(table.workspaceId, table.revision),
    index("product_identity_event_workspace_valid_time").on(
      table.workspaceId,
      table.validFrom,
      table.revision,
    ),
  ],
);

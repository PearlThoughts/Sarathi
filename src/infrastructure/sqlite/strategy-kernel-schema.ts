import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const schemaMigrationTable = sqliteTable("schema_migration", {
  id: text("id").primaryKey(),
  description: text("description").notNull(),
  appliedAt: text("applied_at").notNull(),
});

export const organizationTable = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceTable = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    defaultSensitivity: text("default_sensitivity").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("workspace_organization_key").on(table.organizationId, table.key)],
);

export const workspaceRelationTable = sqliteTable("workspace_relation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  fromWorkspaceId: text("from_workspace_id").notNull(),
  toWorkspaceId: text("to_workspace_id").notNull(),
  relationType: text("relation_type").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
});

export const workspacePackPolicyTable = sqliteTable(
  "workspace_pack_policy",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    policyKey: text("policy_key").notNull(),
    payloadJson: text("payload_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("workspace_pack_policy_unique").on(table.workspaceId, table.policyKey)],
);

export const workspacePackTemplateTable = sqliteTable(
  "workspace_pack_template",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    path: text("path").notNull(),
    sensitivity: text("sensitivity").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("workspace_pack_template_unique").on(table.workspaceId, table.path)],
);

export const actorTable = sqliteTable("actor", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  kind: text("kind").notNull(),
  displayName: text("display_name").notNull(),
  externalPrincipalId: text("external_principal_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceActorRoleTable = sqliteTable(
  "workspace_actor_role",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    actorId: text("actor_id").notNull(),
    role: text("role").notNull(),
    canRatifyIntent: integer("can_ratify_intent").notNull(),
    canApproveSensitivityDowngrade: integer("can_approve_sensitivity_downgrade").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_actor_role_unique").on(table.workspaceId, table.actorId, table.role),
  ],
);

export const externalSystemTable = sqliteTable("external_system", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  createdAt: text("created_at").notNull(),
});

export const externalResourceMappingTable = sqliteTable("external_resource_mapping", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  externalSystemId: text("external_system_id").notNull(),
  resourceType: text("resource_type").notNull(),
  externalId: text("external_id").notNull(),
  externalUrl: text("external_url"),
  purpose: text("purpose").notNull(),
  sensitivity: text("sensitivity").notNull(),
  createdAt: text("created_at").notNull(),
});

export const intentNodeTable = sqliteTable("intent_node", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  ownerActorId: text("owner_actor_id"),
  state: text("state").notNull(),
  horizonStart: text("horizon_start"),
  horizonEnd: text("horizon_end"),
  dueAt: text("due_at"),
  successSignal: text("success_signal"),
  sensitivity: text("sensitivity").notNull(),
  originEvidenceId: text("origin_evidence_id"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const intentEdgeTable = sqliteTable("intent_edge", {
  id: text("id").primaryKey(),
  fromNodeId: text("from_node_id").notNull(),
  toNodeId: text("to_node_id").notNull(),
  type: text("type").notNull(),
  confidence: real("confidence").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
});

export const evidenceItemTable = sqliteTable(
  "evidence_item",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceType: text("source_type").notNull(),
    externalId: text("external_id").notNull(),
    externalUrl: text("external_url"),
    actorId: text("actor_id"),
    occurredAt: text("occurred_at").notNull(),
    title: text("title").notNull(),
    bodyExcerpt: text("body_excerpt").notNull(),
    contentHash: text("content_hash").notNull(),
    sensitivity: text("sensitivity").notNull(),
    consentStatus: text("consent_status"),
    consentScope: text("consent_scope"),
    consentRecordedAt: text("consent_recorded_at"),
    consentRecordedBy: text("consent_recorded_by"),
    ingestedAt: text("ingested_at").notNull(),
  },
  (table) => [
    uniqueIndex("evidence_workspace_source_external").on(
      table.workspaceId,
      table.sourceSystem,
      table.externalId,
    ),
  ],
);

export const evidenceImportWatermarkTable = sqliteTable("evidence_import_watermark", {
  workspaceId: text("workspace_id").notNull(),
  sourceKey: text("source_key").notNull(),
  lastCursor: text("last_cursor").notNull(),
  recordCount: integer("record_count").notNull(),
  contentHash: text("content_hash").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const extractedClaimTable = sqliteTable("extracted_claim", {
  id: text("id").primaryKey(),
  evidenceItemId: text("evidence_item_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  claimType: text("claim_type").notNull(),
  text: text("text").notNull(),
  suggestedOwnerId: text("suggested_owner_id"),
  suggestedDueAt: text("suggested_due_at"),
  confidence: real("confidence").notNull(),
  state: text("state").notNull(),
  sensitivity: text("sensitivity").notNull(),
  ratifiedNodeId: text("ratified_node_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const projectionTable = sqliteTable("projection", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  intentNodeId: text("intent_node_id").notNull(),
  targetSystem: text("target_system").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  targetUrl: text("target_url"),
  lastPublishedHash: text("last_published_hash"),
  lastVerifiedAt: text("last_verified_at"),
  driftStatus: text("drift_status").notNull(),
  sensitivity: text("sensitivity").notNull(),
});

export const accountabilityActionTable = sqliteTable("accountability_action", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  intentNodeId: text("intent_node_id").notNull(),
  actorId: text("actor_id").notNull(),
  channel: text("channel").notNull(),
  state: text("state").notNull(),
  dueAt: text("due_at"),
  lastNudgedAt: text("last_nudged_at"),
  escalationLevel: integer("escalation_level").notNull(),
  evidenceRequired: integer("evidence_required").notNull(),
  completionEvidenceId: text("completion_evidence_id"),
  sensitivity: text("sensitivity").notNull(),
});

export const kernelEventTable = sqliteTable("kernel_event", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  actorId: text("actor_id"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  payloadJson: text("payload_json").notNull(),
  occurredAt: text("occurred_at").notNull(),
  sensitivity: text("sensitivity").notNull(),
});

export const driftFindingTable = sqliteTable("drift_finding", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  findingType: text("finding_type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  state: text("state").notNull(),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: text("related_entity_id"),
  sensitivity: text("sensitivity").notNull(),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export const strategyKernelSqliteSchema = {
  schemaMigrationTable,
  organizationTable,
  workspaceTable,
  workspaceRelationTable,
  workspacePackPolicyTable,
  workspacePackTemplateTable,
  actorTable,
  workspaceActorRoleTable,
  externalSystemTable,
  externalResourceMappingTable,
  intentNodeTable,
  intentEdgeTable,
  evidenceItemTable,
  evidenceImportWatermarkTable,
  extractedClaimTable,
  projectionTable,
  accountabilityActionTable,
  kernelEventTable,
  driftFindingTable,
};

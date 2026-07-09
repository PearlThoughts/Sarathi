import { Database } from "bun:sqlite";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  type StrategyKernelRepository,
  strategyKernelMigrations,
} from "../../modules/strategy-kernel/index.ts";
import {
  accountabilityActionTable,
  actorTable,
  driftFindingTable,
  evidenceItemTable,
  externalResourceMappingTable,
  externalSystemTable,
  extractedClaimTable,
  intentEdgeTable,
  intentNodeTable,
  kernelEventTable,
  organizationTable,
  projectionTable,
  schemaMigrationTable,
  strategyKernelSqliteSchema,
  workspaceActorRoleTable,
  workspaceRelationTable,
  workspaceTable,
} from "./strategy-kernel-schema.ts";

type WorkspaceActorRoleRecord = Parameters<StrategyKernelRepository["saveWorkspaceActorRole"]>[0];
type AccountabilityActionRecord = Awaited<
  ReturnType<StrategyKernelRepository["listWorkspaceAccountabilityActions"]>
>[number];
type DriftFindingRecord = Awaited<
  ReturnType<StrategyKernelRepository["listWorkspaceDriftFindings"]>
>[number];
type EvidenceItemRecord = Awaited<
  ReturnType<StrategyKernelRepository["listWorkspaceEvidence"]>
>[number];
type ExtractedClaimRecord = Awaited<
  ReturnType<StrategyKernelRepository["listPendingClaims"]>
>[number];
type IntentNodeRecord = Awaited<
  ReturnType<StrategyKernelRepository["listWorkspaceIntent"]>
>[number];
type KernelEventRecord = Awaited<
  ReturnType<StrategyKernelRepository["listWorkspaceKernelEvents"]>
>[number];
type ProjectionRecord = Awaited<
  ReturnType<StrategyKernelRepository["listWorkspaceProjections"]>
>[number];

type StrategyKernelDrizzleDatabase = ReturnType<typeof createStrategyKernelDrizzleDatabase>;

const optional = (value: string | undefined): string | null => value ?? null;
const maybe = <K extends string>(key: K, value: string | null): Partial<Record<K, string>> =>
  value === null ? {} : ({ [key]: value } as Record<K, string>);
const booleanToInteger = (value: boolean): 0 | 1 => (value ? 1 : 0);
const integerToBoolean = (value: number): boolean => value === 1;

export type StrategyKernelSqliteDatabase = Database;

export const openStrategyKernelSqliteDatabase = (
  filename = ":memory:",
): StrategyKernelSqliteDatabase => {
  const database = new Database(filename);
  database.exec("pragma foreign_keys = on");
  return database;
};

export const createStrategyKernelDrizzleDatabase = (database: StrategyKernelSqliteDatabase) =>
  drizzle(database, { schema: strategyKernelSqliteSchema });

export const applyStrategyKernelSqliteMigrations = (
  database: StrategyKernelSqliteDatabase,
): readonly string[] => {
  database.exec(
    `create table if not exists schema_migration (
      id text primary key,
      description text not null,
      applied_at text not null
    )`,
  );

  const drizzleDatabase = createStrategyKernelDrizzleDatabase(database);
  const applied: string[] = [];

  for (const migration of strategyKernelMigrations) {
    const existing = drizzleDatabase
      .select({ id: schemaMigrationTable.id })
      .from(schemaMigrationTable)
      .where(eq(schemaMigrationTable.id, migration.id))
      .get();

    if (existing !== undefined) {
      continue;
    }

    database.transaction(() => {
      for (const statement of migration.sql) {
        drizzleDatabase.run(sql.raw(statement));
      }
      drizzleDatabase
        .insert(schemaMigrationTable)
        .values({
          id: migration.id,
          description: migration.description,
          appliedAt: new Date().toISOString(),
        })
        .run();
    })();
    applied.push(migration.id);
  }

  return applied;
};

export const createSqliteStrategyKernelRepository = (
  database: StrategyKernelSqliteDatabase,
): StrategyKernelRepository => {
  const drizzleDatabase = createStrategyKernelDrizzleDatabase(database);

  return {
    saveOrganization: async (organization) => {
      drizzleDatabase
        .insert(organizationTable)
        .values(organization)
        .onConflictDoUpdate({
          target: organizationTable.id,
          set: {
            name: organization.name,
            updatedAt: organization.updatedAt,
          },
        })
        .run();
    },
    saveWorkspace: async (workspace) => {
      drizzleDatabase
        .insert(workspaceTable)
        .values(workspace)
        .onConflictDoUpdate({
          target: [workspaceTable.organizationId, workspaceTable.key],
          set: {
            name: workspace.name,
            kind: workspace.kind,
            defaultSensitivity: workspace.defaultSensitivity,
            updatedAt: workspace.updatedAt,
          },
        })
        .run();
    },
    saveWorkspaceRelation: async (relation) => {
      drizzleDatabase
        .insert(workspaceRelationTable)
        .values({
          ...relation,
          description: optional(relation.description),
        })
        .onConflictDoUpdate({
          target: workspaceRelationTable.id,
          set: {
            relationType: relation.relationType,
            description: optional(relation.description),
          },
        })
        .run();
    },
    saveActor: async (actor) => {
      drizzleDatabase
        .insert(actorTable)
        .values({
          ...actor,
          externalPrincipalId: optional(actor.externalPrincipalId),
        })
        .onConflictDoUpdate({
          target: actorTable.id,
          set: {
            displayName: actor.displayName,
            externalPrincipalId: optional(actor.externalPrincipalId),
            updatedAt: actor.updatedAt,
          },
        })
        .run();
    },
    saveWorkspaceActorRole: async (role) => {
      drizzleDatabase
        .insert(workspaceActorRoleTable)
        .values({
          ...role,
          canRatifyIntent: booleanToInteger(role.canRatifyIntent),
          canApproveSensitivityDowngrade: booleanToInteger(role.canApproveSensitivityDowngrade),
        })
        .onConflictDoUpdate({
          target: [
            workspaceActorRoleTable.workspaceId,
            workspaceActorRoleTable.actorId,
            workspaceActorRoleTable.role,
          ],
          set: {
            role: role.role,
            canRatifyIntent: booleanToInteger(role.canRatifyIntent),
            canApproveSensitivityDowngrade: booleanToInteger(role.canApproveSensitivityDowngrade),
          },
        })
        .run();
    },
    saveExternalSystem: async (system) => {
      drizzleDatabase
        .insert(externalSystemTable)
        .values({
          ...system,
          baseUrl: optional(system.baseUrl),
        })
        .onConflictDoUpdate({
          target: externalSystemTable.id,
          set: {
            name: system.name,
            baseUrl: optional(system.baseUrl),
          },
        })
        .run();
    },
    saveExternalResourceMapping: async (mapping) => {
      drizzleDatabase
        .insert(externalResourceMappingTable)
        .values({
          ...mapping,
          externalUrl: optional(mapping.externalUrl),
        })
        .onConflictDoUpdate({
          target: externalResourceMappingTable.id,
          set: {
            externalId: mapping.externalId,
            externalUrl: optional(mapping.externalUrl),
            purpose: mapping.purpose,
            sensitivity: mapping.sensitivity,
          },
        })
        .run();
    },
    saveEvidenceItem: async (item) => {
      drizzleDatabase
        .insert(evidenceItemTable)
        .values({
          ...item,
          externalUrl: optional(item.externalUrl),
          actorId: optional(item.actorId),
        })
        .onConflictDoUpdate({
          target: [
            evidenceItemTable.workspaceId,
            evidenceItemTable.sourceSystem,
            evidenceItemTable.externalId,
          ],
          set: {
            title: item.title,
            bodyExcerpt: item.bodyExcerpt,
            contentHash: item.contentHash,
            sensitivity: item.sensitivity,
            ingestedAt: item.ingestedAt,
          },
        })
        .run();
    },
    saveExtractedClaim: async (claim) => {
      drizzleDatabase
        .insert(extractedClaimTable)
        .values({
          ...claim,
          suggestedOwnerId: optional(claim.suggestedOwnerId),
          suggestedDueAt: optional(claim.suggestedDueAt),
          ratifiedNodeId: optional(claim.ratifiedNodeId),
        })
        .onConflictDoUpdate({
          target: extractedClaimTable.id,
          set: {
            text: claim.text,
            suggestedOwnerId: optional(claim.suggestedOwnerId),
            suggestedDueAt: optional(claim.suggestedDueAt),
            confidence: claim.confidence,
            state: claim.state,
            sensitivity: claim.sensitivity,
            ratifiedNodeId: optional(claim.ratifiedNodeId),
            updatedAt: claim.updatedAt,
          },
        })
        .run();
    },
    saveIntentNode: async (node) => {
      drizzleDatabase
        .insert(intentNodeTable)
        .values({
          ...node,
          ownerActorId: optional(node.ownerActorId),
          horizonStart: optional(node.horizonStart),
          horizonEnd: optional(node.horizonEnd),
          dueAt: optional(node.dueAt),
          successSignal: optional(node.successSignal),
          originEvidenceId: optional(node.originEvidenceId),
        })
        .onConflictDoUpdate({
          target: intentNodeTable.id,
          set: {
            title: node.title,
            body: node.body,
            ownerActorId: optional(node.ownerActorId),
            state: node.state,
            dueAt: optional(node.dueAt),
            successSignal: optional(node.successSignal),
            sensitivity: node.sensitivity,
            updatedAt: node.updatedAt,
          },
        })
        .run();
    },
    saveIntentEdge: async (edge) => {
      drizzleDatabase
        .insert(intentEdgeTable)
        .values(edge)
        .onConflictDoUpdate({
          target: intentEdgeTable.id,
          set: {
            confidence: edge.confidence,
          },
        })
        .run();
    },
    saveProjection: async (projection) => {
      drizzleDatabase
        .insert(projectionTable)
        .values({
          ...projection,
          targetId: optional(projection.targetId),
          targetUrl: optional(projection.targetUrl),
          lastPublishedHash: optional(projection.lastPublishedHash),
          lastVerifiedAt: optional(projection.lastVerifiedAt),
        })
        .onConflictDoUpdate({
          target: projectionTable.id,
          set: {
            targetId: optional(projection.targetId),
            targetUrl: optional(projection.targetUrl),
            lastPublishedHash: optional(projection.lastPublishedHash),
            lastVerifiedAt: optional(projection.lastVerifiedAt),
            driftStatus: projection.driftStatus,
            sensitivity: projection.sensitivity,
          },
        })
        .run();
    },
    saveAccountabilityAction: async (action) => {
      drizzleDatabase
        .insert(accountabilityActionTable)
        .values({
          ...action,
          dueAt: optional(action.dueAt),
          lastNudgedAt: optional(action.lastNudgedAt),
          evidenceRequired: booleanToInteger(action.evidenceRequired),
          completionEvidenceId: optional(action.completionEvidenceId),
        })
        .onConflictDoUpdate({
          target: accountabilityActionTable.id,
          set: {
            state: action.state,
            dueAt: optional(action.dueAt),
            lastNudgedAt: optional(action.lastNudgedAt),
            escalationLevel: action.escalationLevel,
            evidenceRequired: booleanToInteger(action.evidenceRequired),
            completionEvidenceId: optional(action.completionEvidenceId),
            sensitivity: action.sensitivity,
          },
        })
        .run();
    },
    saveKernelEvent: async (event) => {
      drizzleDatabase
        .insert(kernelEventTable)
        .values({
          ...event,
          actorId: optional(event.actorId),
        })
        .onConflictDoUpdate({
          target: kernelEventTable.id,
          set: {
            payloadJson: event.payloadJson,
          },
        })
        .run();
    },
    saveDriftFinding: async (finding) => {
      drizzleDatabase
        .insert(driftFindingTable)
        .values({
          ...finding,
          relatedEntityType: optional(finding.relatedEntityType),
          relatedEntityId: optional(finding.relatedEntityId),
          resolvedAt: optional(finding.resolvedAt),
        })
        .onConflictDoUpdate({
          target: driftFindingTable.id,
          set: {
            title: finding.title,
            body: finding.body,
            state: finding.state,
            resolvedAt: optional(finding.resolvedAt),
          },
        })
        .run();
    },
    listWorkspaceEvidence: async (workspaceId) =>
      drizzleDatabase
        .select()
        .from(evidenceItemTable)
        .where(eq(evidenceItemTable.workspaceId, workspaceId))
        .orderBy(evidenceItemTable.occurredAt, evidenceItemTable.id)
        .all()
        .map(rowToEvidenceItem),
    listWorkspaceIntent: async (workspaceId) =>
      drizzleDatabase
        .select()
        .from(intentNodeTable)
        .where(eq(intentNodeTable.workspaceId, workspaceId))
        .orderBy(intentNodeTable.createdAt, intentNodeTable.id)
        .all()
        .map(rowToIntentNode),
    listPendingClaims: async (workspaceId) =>
      drizzleDatabase
        .select()
        .from(extractedClaimTable)
        .where(
          and(
            eq(extractedClaimTable.workspaceId, workspaceId),
            eq(extractedClaimTable.state, "pending"),
          ),
        )
        .orderBy(extractedClaimTable.createdAt, extractedClaimTable.id)
        .all()
        .map(rowToExtractedClaim),
    listWorkspaceProjections: async (workspaceId) =>
      drizzleDatabase
        .select()
        .from(projectionTable)
        .where(eq(projectionTable.workspaceId, workspaceId))
        .orderBy(projectionTable.targetSystem, projectionTable.targetType, projectionTable.id)
        .all()
        .map(rowToProjection),
    listWorkspaceAccountabilityActions: async (workspaceId) =>
      drizzleDatabase
        .select()
        .from(accountabilityActionTable)
        .where(eq(accountabilityActionTable.workspaceId, workspaceId))
        .orderBy(accountabilityActionTable.dueAt, accountabilityActionTable.id)
        .all()
        .map(rowToAccountabilityAction),
    listWorkspaceDriftFindings: async (workspaceId) =>
      drizzleDatabase
        .select()
        .from(driftFindingTable)
        .where(eq(driftFindingTable.workspaceId, workspaceId))
        .orderBy(driftFindingTable.createdAt, driftFindingTable.id)
        .all()
        .map(rowToDriftFinding),
    listWorkspaceKernelEvents: async (workspaceId) =>
      drizzleDatabase
        .select()
        .from(kernelEventTable)
        .where(eq(kernelEventTable.workspaceId, workspaceId))
        .orderBy(kernelEventTable.occurredAt, kernelEventTable.id)
        .all()
        .map(rowToKernelEvent),
  };
};

type EvidenceItemRow = typeof evidenceItemTable.$inferSelect;

const rowToEvidenceItem = (row: EvidenceItemRow): EvidenceItemRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  sourceSystem: row.sourceSystem as EvidenceItemRecord["sourceSystem"],
  sourceType: row.sourceType as EvidenceItemRecord["sourceType"],
  externalId: row.externalId,
  ...maybe("externalUrl", row.externalUrl),
  ...maybe("actorId", row.actorId),
  occurredAt: row.occurredAt,
  title: row.title,
  bodyExcerpt: row.bodyExcerpt,
  contentHash: row.contentHash,
  sensitivity: row.sensitivity as EvidenceItemRecord["sensitivity"],
  ingestedAt: row.ingestedAt,
});

type IntentNodeRow = typeof intentNodeTable.$inferSelect;

const rowToIntentNode = (row: IntentNodeRow): IntentNodeRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  kind: row.kind as IntentNodeRecord["kind"],
  title: row.title,
  body: row.body,
  ...maybe("ownerActorId", row.ownerActorId),
  state: row.state as IntentNodeRecord["state"],
  ...maybe("horizonStart", row.horizonStart),
  ...maybe("horizonEnd", row.horizonEnd),
  ...maybe("dueAt", row.dueAt),
  ...maybe("successSignal", row.successSignal),
  sensitivity: row.sensitivity as IntentNodeRecord["sensitivity"],
  ...maybe("originEvidenceId", row.originEvidenceId),
  createdBy: row.createdBy as IntentNodeRecord["createdBy"],
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

type ExtractedClaimRow = typeof extractedClaimTable.$inferSelect;

const rowToExtractedClaim = (row: ExtractedClaimRow): ExtractedClaimRecord => ({
  id: row.id,
  evidenceItemId: row.evidenceItemId,
  workspaceId: row.workspaceId,
  claimType: row.claimType as ExtractedClaimRecord["claimType"],
  text: row.text,
  ...maybe("suggestedOwnerId", row.suggestedOwnerId),
  ...maybe("suggestedDueAt", row.suggestedDueAt),
  confidence: row.confidence,
  state: row.state as ExtractedClaimRecord["state"],
  sensitivity: row.sensitivity as ExtractedClaimRecord["sensitivity"],
  ...maybe("ratifiedNodeId", row.ratifiedNodeId),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

type ProjectionRow = typeof projectionTable.$inferSelect;

const rowToProjection = (row: ProjectionRow): ProjectionRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  intentNodeId: row.intentNodeId,
  targetSystem: row.targetSystem as ProjectionRecord["targetSystem"],
  targetType: row.targetType as ProjectionRecord["targetType"],
  ...maybe("targetId", row.targetId),
  ...maybe("targetUrl", row.targetUrl),
  ...maybe("lastPublishedHash", row.lastPublishedHash),
  ...maybe("lastVerifiedAt", row.lastVerifiedAt),
  driftStatus: row.driftStatus as ProjectionRecord["driftStatus"],
  sensitivity: row.sensitivity as ProjectionRecord["sensitivity"],
});

type AccountabilityActionRow = typeof accountabilityActionTable.$inferSelect;

const rowToAccountabilityAction = (row: AccountabilityActionRow): AccountabilityActionRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  intentNodeId: row.intentNodeId,
  actorId: row.actorId,
  channel: row.channel as AccountabilityActionRecord["channel"],
  state: row.state as AccountabilityActionRecord["state"],
  ...maybe("dueAt", row.dueAt),
  ...maybe("lastNudgedAt", row.lastNudgedAt),
  escalationLevel: row.escalationLevel,
  evidenceRequired: integerToBoolean(row.evidenceRequired),
  ...maybe("completionEvidenceId", row.completionEvidenceId),
  sensitivity: row.sensitivity as AccountabilityActionRecord["sensitivity"],
});

type DriftFindingRow = typeof driftFindingTable.$inferSelect;

const rowToDriftFinding = (row: DriftFindingRow): DriftFindingRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  findingType: row.findingType as DriftFindingRecord["findingType"],
  title: row.title,
  body: row.body,
  state: row.state as DriftFindingRecord["state"],
  ...(row.relatedEntityType === null
    ? {}
    : {
        relatedEntityType: row.relatedEntityType as DriftFindingRecord["relatedEntityType"],
      }),
  ...maybe("relatedEntityId", row.relatedEntityId),
  sensitivity: row.sensitivity as DriftFindingRecord["sensitivity"],
  createdAt: row.createdAt,
  ...maybe("resolvedAt", row.resolvedAt),
});

type KernelEventRow = typeof kernelEventTable.$inferSelect;

const rowToKernelEvent = (row: KernelEventRow): KernelEventRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  ...maybe("actorId", row.actorId),
  entityType: row.entityType as KernelEventRecord["entityType"],
  entityId: row.entityId,
  action: row.action as KernelEventRecord["action"],
  payloadJson: row.payloadJson,
  occurredAt: row.occurredAt,
  sensitivity: row.sensitivity as KernelEventRecord["sensitivity"],
});

export const readWorkspaceActorRoleRows = (
  database: StrategyKernelSqliteDatabase,
  workspaceId: string,
): readonly WorkspaceActorRoleRecord[] => {
  const drizzleDatabase: StrategyKernelDrizzleDatabase =
    createStrategyKernelDrizzleDatabase(database);

  return drizzleDatabase
    .select()
    .from(workspaceActorRoleTable)
    .where(eq(workspaceActorRoleTable.workspaceId, workspaceId))
    .orderBy(workspaceActorRoleTable.createdAt, workspaceActorRoleTable.id)
    .all()
    .map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      actorId: row.actorId,
      role: row.role as WorkspaceActorRoleRecord["role"],
      canRatifyIntent: integerToBoolean(row.canRatifyIntent),
      canApproveSensitivityDowngrade: integerToBoolean(row.canApproveSensitivityDowngrade),
      createdAt: row.createdAt,
    }));
};

import { describe, expect, it } from "bun:test";
import {
  applyStrategyKernelSqliteMigrations,
  createSqliteStrategyKernelRepository,
  createStrategyKernelDrizzleDatabase,
  openStrategyKernelSqliteDatabase,
  readWorkspaceActorRoleRows,
  type StrategyKernelSqliteDatabase,
} from "../src/infrastructure/sqlite/index.ts";
import {
  type AccountabilityAction,
  type Actor,
  type DriftFinding,
  type EvidenceItem,
  type ExternalResourceMapping,
  type ExternalSystem,
  type ExtractedClaim,
  type IntentEdge,
  type IntentNode,
  type KernelEvent,
  type Organization,
  type Projection,
  strategyKernelTableNames,
  type Workspace,
  type WorkspaceActorRole,
  type WorkspaceRelation,
} from "../src/modules/strategy-kernel/index.ts";

const now = "2026-07-09T12:00:00.000Z";

const organization: Organization = {
  id: "org-acme",
  name: "Acme",
  createdAt: now,
  updatedAt: now,
};

const workspace: Workspace = {
  id: "workspace-launchpad",
  organizationId: organization.id,
  key: "launchpad",
  name: "Launchpad",
  kind: "project",
  defaultSensitivity: "internal",
  createdAt: now,
  updatedAt: now,
};

const secondWorkspace: Workspace = {
  ...workspace,
  id: "workspace-portfolio",
  key: "portfolio",
  name: "Portfolio Review",
};

const relation: WorkspaceRelation = {
  id: "relation-rollup",
  organizationId: organization.id,
  fromWorkspaceId: workspace.id,
  toWorkspaceId: secondWorkspace.id,
  relationType: "synthesizes_into",
  description: "Approved summaries roll up.",
  createdAt: now,
};

const actor: Actor = {
  id: "actor-lead",
  organizationId: organization.id,
  kind: "person",
  displayName: "Delivery Lead",
  createdAt: now,
  updatedAt: now,
};

const role: WorkspaceActorRole = {
  id: "role-lead",
  workspaceId: workspace.id,
  actorId: actor.id,
  role: "delivery_manager",
  canRatifyIntent: true,
  canApproveSensitivityDowngrade: false,
  createdAt: now,
};

const externalSystem: ExternalSystem = {
  id: "system-jira",
  organizationId: organization.id,
  kind: "jira",
  name: "Synthetic Jira",
  createdAt: now,
};

const mapping: ExternalResourceMapping = {
  id: "mapping-jira",
  workspaceId: workspace.id,
  externalSystemId: externalSystem.id,
  resourceType: "project",
  externalId: "LPAD",
  purpose: "execution",
  sensitivity: "internal",
  createdAt: now,
};

const evidence: EvidenceItem = {
  id: "evidence-message",
  workspaceId: workspace.id,
  sourceSystem: "teams",
  sourceType: "message",
  externalId: "synthetic-message-1",
  actorId: actor.id,
  occurredAt: now,
  title: "QA commitment",
  bodyExcerpt: "I will attach QA evidence before marking done.",
  contentHash: "sha256-synthetic",
  sensitivity: "confidential",
  ingestedAt: now,
};

const claim: ExtractedClaim = {
  id: "claim-qa",
  evidenceItemId: evidence.id,
  workspaceId: workspace.id,
  claimType: "possible_commitment",
  text: "Delivery lead committed to QA evidence.",
  suggestedOwnerId: actor.id,
  confidence: 0.94,
  state: "pending",
  sensitivity: evidence.sensitivity,
  createdAt: now,
  updatedAt: now,
};

const intent: IntentNode = {
  id: "intent-qa",
  workspaceId: workspace.id,
  kind: "commitment",
  title: "Attach QA evidence",
  body: "Done requires QA evidence.",
  ownerActorId: actor.id,
  state: "active",
  dueAt: "2026-07-10T12:00:00.000Z",
  sensitivity: "confidential",
  originEvidenceId: evidence.id,
  createdBy: "human",
  createdAt: now,
  updatedAt: now,
};

const parentIntent: IntentNode = {
  ...intent,
  id: "intent-goal",
  kind: "goal",
  title: "Launch safely",
  body: "Launch with enough delivery evidence.",
};

const edge: IntentEdge = {
  id: "edge-supports",
  fromNodeId: intent.id,
  toNodeId: parentIntent.id,
  type: "supports",
  confidence: 1,
  createdAt: now,
  createdBy: "human",
};

const projection: Projection = {
  id: "projection-jira",
  workspaceId: workspace.id,
  intentNodeId: intent.id,
  targetSystem: "jira",
  targetType: "issue",
  targetId: "LPAD-1",
  lastPublishedHash: "hash-1",
  driftStatus: "in_sync",
  sensitivity: "confidential",
};

const action: AccountabilityAction = {
  id: "action-qa",
  workspaceId: workspace.id,
  intentNodeId: intent.id,
  actorId: actor.id,
  channel: "teams_channel",
  state: "sent",
  dueAt: "2026-07-10T12:00:00.000Z",
  escalationLevel: 0,
  evidenceRequired: true,
  sensitivity: "confidential",
};

const event: KernelEvent = {
  id: "event-card-sent",
  workspaceId: workspace.id,
  actorId: actor.id,
  entityType: "accountability_action",
  entityId: action.id,
  action: "nudged",
  payloadJson: JSON.stringify({ channel: action.channel }),
  occurredAt: now,
  sensitivity: "confidential",
};

const drift: DriftFinding = {
  id: "drift-missing-evidence",
  workspaceId: workspace.id,
  findingType: "stale_commitment",
  title: "QA evidence is pending",
  body: "Commitment is not complete until evidence is attached.",
  state: "open",
  relatedEntityType: "accountability_action",
  relatedEntityId: action.id,
  sensitivity: "confidential",
  createdAt: now,
};

describe("sqlite strategy kernel repository", () => {
  it("applies migrations idempotently", async () => {
    const database = openStrategyKernelSqliteDatabase();
    const typedDatabase: StrategyKernelSqliteDatabase = database;
    const drizzleDatabase = createStrategyKernelDrizzleDatabase(typedDatabase);

    expect(applyStrategyKernelSqliteMigrations(database)).toEqual(["001_strategy_kernel"]);
    expect(applyStrategyKernelSqliteMigrations(database)).toEqual([]);
    expect(drizzleDatabase).toBeDefined();

    const tableNames = database
      .query("select name from sqlite_master where type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    for (const tableName of strategyKernelTableNames) {
      expect(tableNames).toContain(tableName);
    }
  });

  it("persists and lists workspace-scoped evidence, intent, roles, and claims", async () => {
    const database = openStrategyKernelSqliteDatabase();
    applyStrategyKernelSqliteMigrations(database);
    const repository = createSqliteStrategyKernelRepository(database);

    await repository.saveOrganization(organization);
    await repository.saveWorkspace(workspace);
    await repository.saveWorkspace(secondWorkspace);
    await repository.saveWorkspaceRelation(relation);
    await repository.saveActor(actor);
    await repository.saveWorkspaceActorRole(role);
    await repository.saveExternalSystem(externalSystem);
    await repository.saveExternalResourceMapping(mapping);
    await repository.saveEvidenceItem(evidence);
    await repository.saveExtractedClaim(claim);
    await repository.saveIntentNode(parentIntent);
    await repository.saveIntentNode(intent);
    await repository.saveIntentEdge(edge);
    await repository.saveProjection(projection);
    await repository.saveAccountabilityAction(action);
    await repository.saveKernelEvent(event);
    await repository.saveDriftFinding(drift);

    await repository.saveEvidenceItem({
      ...evidence,
      id: "evidence-other",
      workspaceId: secondWorkspace.id,
      externalId: "other-message",
      title: "Other workspace evidence",
    });

    expect(await repository.listWorkspaceEvidence(workspace.id)).toEqual([evidence]);
    expect(await repository.listWorkspaceIntent(workspace.id)).toEqual([parentIntent, intent]);
    expect(await repository.listPendingClaims(workspace.id)).toEqual([claim]);
    expect(await repository.listWorkspaceProjections(workspace.id)).toEqual([projection]);
    expect(await repository.listWorkspaceAccountabilityActions(workspace.id)).toEqual([action]);
    expect(await repository.listWorkspaceDriftFindings(workspace.id)).toEqual([drift]);
    expect(await repository.listWorkspaceKernelEvents(workspace.id)).toEqual([event]);
    expect(readWorkspaceActorRoleRows(database, workspace.id)).toEqual([role]);
  });

  it("upserts records using natural unique keys when callers regenerate ids", async () => {
    const database = openStrategyKernelSqliteDatabase();
    applyStrategyKernelSqliteMigrations(database);
    const repository = createSqliteStrategyKernelRepository(database);

    await repository.saveOrganization(organization);
    await repository.saveWorkspace(workspace);
    await repository.saveActor(actor);
    await repository.saveWorkspaceActorRole(role);
    await repository.saveEvidenceItem(evidence);

    await repository.saveWorkspace({
      ...workspace,
      id: "regenerated-workspace-id",
      name: "Launchpad Renamed",
      updatedAt: "2026-07-09T13:00:00.000Z",
    });
    await repository.saveWorkspaceActorRole({
      ...role,
      id: "regenerated-role-id",
      canApproveSensitivityDowngrade: true,
    });
    await repository.saveEvidenceItem({
      ...evidence,
      id: "regenerated-evidence-id",
      title: "QA commitment updated",
      bodyExcerpt: "Updated synthetic evidence excerpt.",
      contentHash: "sha256-updated",
    });

    const workspaceRows = database
      .query("select id, name from workspace where organization_id = ? and key = ?")
      .all(organization.id, workspace.key);
    const roleRows = readWorkspaceActorRoleRows(database, workspace.id);
    const evidenceRows = await repository.listWorkspaceEvidence(workspace.id);

    expect(workspaceRows).toEqual([{ id: workspace.id, name: "Launchpad Renamed" }]);
    expect(roleRows).toEqual([
      {
        ...role,
        canApproveSensitivityDowngrade: true,
      },
    ]);
    expect(evidenceRows).toEqual([
      {
        ...evidence,
        title: "QA commitment updated",
        bodyExcerpt: "Updated synthetic evidence excerpt.",
        contentHash: "sha256-updated",
      },
    ]);
  });
});

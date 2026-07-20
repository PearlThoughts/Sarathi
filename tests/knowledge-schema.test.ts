import { getTableName, getTableUniqueName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deliveryAclBindingTable,
  deliveryClaimTable,
  deliveryFinanceMetricTable,
  deliveryMetricTable,
  deliveryObjectTable,
  deliveryObservationTable,
  deliveryRelationTable,
  knowledgeAclBindingTable,
  knowledgeItemTable,
  knowledgePassageTable,
  knowledgeProjectionTable,
  knowledgeSourceTable,
  knowledgeSyncCheckpointTable,
  knowledgeVersionTable,
} from "../src/infrastructure/postgres/knowledge-schema.ts";

describe("knowledge PostgreSQL schema", () => {
  it("defines the additive canonical evidence tables without claiming existing audit tables", () => {
    const names = [
      knowledgeSourceTable,
      knowledgeItemTable,
      knowledgeVersionTable,
      knowledgePassageTable,
      knowledgeAclBindingTable,
      knowledgeProjectionTable,
      knowledgeSyncCheckpointTable,
    ].map(getTableName);

    expect(names).toEqual([
      "knowledge_source",
      "knowledge_item",
      "knowledge_version",
      "knowledge_passage",
      "knowledge_acl_binding",
      "knowledge_projection",
      "knowledge_sync_checkpoint",
    ]);
    expect(names).not.toContain("teams_mention_audit");
    expect(names).not.toContain("compliance_reminder_audit");
  });

  it("keeps globally unique Drizzle table identities", () => {
    expect(getTableUniqueName(knowledgeProjectionTable)).toBe("public.knowledge_projection");
  });

  it("defines delivery objects, relations, observations, claims, metrics, finance, and ACLs separately", () => {
    expect(
      [
        deliveryObjectTable,
        deliveryRelationTable,
        deliveryObservationTable,
        deliveryMetricTable,
        deliveryFinanceMetricTable,
        deliveryClaimTable,
        deliveryAclBindingTable,
      ].map(getTableName),
    ).toEqual([
      "delivery_object",
      "delivery_relation",
      "delivery_observation",
      "delivery_metric",
      "delivery_finance_metric",
      "delivery_claim",
      "delivery_acl_binding",
    ]);
  });
});

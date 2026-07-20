import { getTableName, getTableUniqueName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
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
});

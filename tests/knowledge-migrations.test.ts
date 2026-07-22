import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { knowledgePostgresPoolConfiguration } from "../src/infrastructure/postgres/knowledge-migrations.ts";

const migration = (name: string): Promise<string> =>
  readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");

describe("knowledge Drizzle migrations", () => {
  it("bounds query connections and PostgreSQL work to the delivery source budget", () => {
    expect(knowledgePostgresPoolConfiguration("postgresql://database", 3_000)).toEqual({
      connectionString: "postgresql://database",
      connectionTimeoutMillis: 3_000,
      query_timeout: 3_000,
      statement_timeout: 3_000,
    });
    expect(knowledgePostgresPoolConfiguration("postgresql://database")).toEqual({
      connectionString: "postgresql://database",
    });
  });

  it("enables pgvector before generated schema DDL", async () => {
    const extension = await migration("0000_enable-pgvector.sql");
    const journal = JSON.parse(await migration("meta/_journal.json")) as {
      readonly entries: readonly { readonly idx: number; readonly tag: string }[];
    };

    expect(extension.trim()).toBe("CREATE EXTENSION IF NOT EXISTS vector;");
    expect(journal.entries.map(({ idx, tag }) => ({ idx, tag }))).toEqual([
      { idx: 0, tag: "0000_enable-pgvector" },
      { idx: 1, tag: "0001_knowledge-layer" },
      { idx: 2, tag: "0002_delivery-intelligence-core" },
      { idx: 3, tag: "0003_continuous-sync-control-plane" },
    ]);
  });

  it("adds only the seven knowledge tables and contains no destructive statements", async () => {
    const schema = await migration("0001_knowledge-layer.sql");
    const createdTables = [...schema.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);

    expect(createdTables).toEqual([
      "knowledge_acl_binding",
      "knowledge_item",
      "knowledge_passage",
      "knowledge_projection",
      "knowledge_source",
      "knowledge_sync_checkpoint",
      "knowledge_version",
    ]);
    expect(schema).toContain('"embedding" vector(1536) NOT NULL');
    expect(schema).toContain("USING hnsw");
    expect(schema).toContain("to_tsvector('english'");
    expect(schema).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(schema).not.toContain("teams_mention_audit");
    expect(schema).not.toContain("compliance_reminder_audit");
  });

  it("adds the reusable delivery model without altering knowledge or audit tables", async () => {
    const schema = await migration("0002_delivery-intelligence-core.sql");
    const createdTables = [...schema.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);

    expect(createdTables).toEqual([
      "delivery_acl_binding",
      "delivery_claim",
      "delivery_finance_metric",
      "delivery_metric",
      "delivery_object",
      "delivery_observation",
      "delivery_relation",
    ]);
    expect(schema).toContain('"source_version_id" text NOT NULL');
    expect(schema).toContain('"sensitivity" text NOT NULL');
    expect(schema).toContain('CONSTRAINT "delivery_metric_excludes_finance"');
    expect(schema).toContain('CONSTRAINT "delivery_finance_metric_confidential"');
    expect(schema).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(schema).not.toContain("teams_mention_audit");
    expect(schema).not.toContain("compliance_reminder_audit");
  });

  it("adds attributed claims and observations in the same coherent migration", async () => {
    const schema = await migration("0002_delivery-intelligence-core.sql");
    expect(schema).toContain('"predicate" text NOT NULL');
    expect(schema).toContain('"value_hash" text NOT NULL');
    expect(schema).toContain('"asserted_by" text');
    expect(schema).toContain('"observation_kind" text NOT NULL');
    expect(schema).toContain('"dedupe_key" text NOT NULL');
    expect(schema).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
  });

  it("adds an additive privacy-safe continuous synchronization control plane", async () => {
    const schema = await migration("0003_continuous-sync-control-plane.sql");
    const createdTables = [...schema.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);

    expect(createdTables).toEqual([
      "knowledge_sync_event_delivery",
      "knowledge_sync_lease",
      "knowledge_sync_run",
      "knowledge_sync_subscription",
    ]);
    expect(schema).toContain('ALTER TABLE "knowledge_sync_checkpoint" ADD COLUMN "last_event_at"');
    expect(schema).toContain(
      'ALTER TABLE "knowledge_sync_checkpoint" ADD COLUMN "last_reconciled_at"',
    );
    expect(schema).toContain(
      'ALTER TABLE "knowledge_sync_checkpoint" ADD COLUMN "next_reconcile_at"',
    );
    expect(schema).toContain('"provider_event_id" text NOT NULL');
    expect(schema).toContain('"resource_hash" text NOT NULL');
    expect(schema).not.toContain("payload_body");
    expect(schema).not.toContain("resource_url");
    expect(schema).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(schema).not.toContain("teams_mention_audit");
    expect(schema).not.toContain("compliance_reminder_audit");
  });
});

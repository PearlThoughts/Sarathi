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
      { idx: 4, tag: "0004_attributed-delivery-assertions" },
      { idx: 5, tag: "0005_canonical-entity-time" },
      { idx: 6, tag: "0006_independent-sync-control" },
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

  it("adds versioned attributed-assertion metadata without storing a second claim body", async () => {
    const schema = await migration("0004_attributed-delivery-assertions.sql");

    expect(schema).toContain('ADD COLUMN "external_assertion_id" text');
    expect(schema).toContain('ADD COLUMN "supersedes_assertion_ids" jsonb');
    expect(schema).toContain('ADD COLUMN "confidence" real');
    expect(schema).toContain('ADD COLUMN "assertion_schema_version" integer');
    expect(schema).toContain('CONSTRAINT "delivery_claim_confidence_range"');
    expect(schema).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(schema).not.toContain("assertion_body");
  });

  it("adds canonical aliases and explicit source/index timestamps with safe backfill", async () => {
    const schema = await migration("0005_canonical-entity-time.sql");

    expect(schema).toContain('CREATE TABLE "delivery_entity_alias"');
    expect(schema).toContain('ADD COLUMN "canonical_key" text;');
    expect(schema).toContain('UPDATE "delivery_object" SET');
    expect(schema.indexOf('UPDATE "delivery_object" SET')).toBeLessThan(
      schema.indexOf('ALTER COLUMN "canonical_key" SET NOT NULL'),
    );
    expect(schema).toContain('ADD COLUMN "source_created_at" timestamp with time zone');
    expect(schema).toContain('ADD COLUMN "source_updated_at" timestamp with time zone');
    expect(schema).toContain('ADD COLUMN "indexed_at" timestamp with time zone');
    expect(schema).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(schema).not.toContain("teams_mention_audit");
    expect(schema).not.toContain("compliance_reminder_audit");
  });

  it("allows control metadata to precede first source content", async () => {
    const schema = await migration("0006_independent-sync-control.sql");

    expect(schema.match(/DROP CONSTRAINT IF EXISTS/g)).toHaveLength(4);
    expect(schema).toContain('"knowledge_sync_lease_source_id_knowledge_source_id_fk"');
    expect(schema).toContain('"knowledge_sync_event_delivery_source_id_knowledge_source_id_fk"');
    expect(schema).not.toMatch(/\b(?:DROP TABLE|TRUNCATE|DELETE)\b/i);
  });
});

CREATE TABLE "delivery_entity_alias" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"object_kind" text NOT NULL,
	"canonical_key" text NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"source_object_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"sensitivity" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "delivery_claim" ADD COLUMN "source_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_claim" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_claim" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_finance_metric" ADD COLUMN "source_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_finance_metric" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_finance_metric" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_metric" ADD COLUMN "source_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_metric" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_metric" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_object" ADD COLUMN "canonical_key" text;--> statement-breakpoint
ALTER TABLE "delivery_object" ADD COLUMN "source_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_object" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_object" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_observation" ADD COLUMN "source_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_observation" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_observation" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_relation" ADD COLUMN "source_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_relation" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_relation" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD COLUMN "source_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_version" ADD COLUMN "source_created_at" timestamp with time zone;--> statement-breakpoint
UPDATE "delivery_object" SET
  "canonical_key" = "object_kind" || ':' || coalesce(
    nullif(trim(both '-' from regexp_replace(lower("external_key"), '[^a-z0-9]+', '-', 'g')), ''),
    md5("external_key")
  ),
  "source_updated_at" = "observed_at",
  "indexed_at" = "observed_at";--> statement-breakpoint
UPDATE "delivery_relation" SET "source_updated_at" = "observed_at", "indexed_at" = "observed_at";--> statement-breakpoint
UPDATE "delivery_observation" SET "source_updated_at" = "occurred_at", "indexed_at" = "observed_at";--> statement-breakpoint
UPDATE "delivery_metric" SET "source_updated_at" = coalesce("effective_from", "observed_at"), "indexed_at" = "observed_at";--> statement-breakpoint
UPDATE "delivery_finance_metric" SET "source_updated_at" = coalesce("effective_from", "observed_at"), "indexed_at" = "observed_at";--> statement-breakpoint
UPDATE "delivery_claim" SET "source_updated_at" = "asserted_at", "indexed_at" = "observed_at";--> statement-breakpoint
ALTER TABLE "delivery_object" ALTER COLUMN "canonical_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_object" ALTER COLUMN "source_updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_object" ALTER COLUMN "indexed_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_relation" ALTER COLUMN "source_updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_relation" ALTER COLUMN "indexed_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_observation" ALTER COLUMN "source_updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_observation" ALTER COLUMN "indexed_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_metric" ALTER COLUMN "source_updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_metric" ALTER COLUMN "indexed_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_finance_metric" ALTER COLUMN "source_updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_finance_metric" ALTER COLUMN "indexed_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_claim" ALTER COLUMN "source_updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_claim" ALTER COLUMN "indexed_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_entity_alias" ADD CONSTRAINT "delivery_entity_alias_source_object_id_delivery_object_id_fk" FOREIGN KEY ("source_object_id") REFERENCES "public"."delivery_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_entity_alias" ADD CONSTRAINT "delivery_entity_alias_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_entity_alias_object_normalized" ON "delivery_entity_alias" USING btree ("source_object_id","normalized_alias");--> statement-breakpoint
CREATE INDEX "delivery_entity_alias_workspace_lookup" ON "delivery_entity_alias" USING btree ("workspace_id","object_kind","normalized_alias","active","deleted_at");--> statement-breakpoint
CREATE INDEX "delivery_entity_alias_workspace_canonical" ON "delivery_entity_alias" USING btree ("workspace_id","object_kind","canonical_key","active","deleted_at");--> statement-breakpoint
CREATE INDEX "delivery_object_workspace_canonical" ON "delivery_object" USING btree ("workspace_id","object_kind","canonical_key","active","deleted_at");

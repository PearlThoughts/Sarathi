CREATE TABLE "knowledge_sync_event_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"source_version" text,
	"payload_hash" text NOT NULL,
	"source_occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"failure_class" text,
	CONSTRAINT "knowledge_sync_event_attempt_count" CHECK ("knowledge_sync_event_delivery"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_sync_lease" (
	"workspace_id" text NOT NULL,
	"source_id" text NOT NULL,
	"operation" text NOT NULL,
	"owner_id" text NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "knowledge_sync_lease_workspace_id_source_id_operation_pk" PRIMARY KEY("workspace_id","source_id","operation"),
	CONSTRAINT "knowledge_sync_lease_time_order" CHECK ("knowledge_sync_lease"."expires_at" > "knowledge_sync_lease"."acquired_at")
);
--> statement-breakpoint
CREATE TABLE "knowledge_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"cursor_before" text,
	"cursor_after" text,
	"scope_hash" text NOT NULL,
	"newest_source_updated_at" timestamp with time zone,
	"lag_seconds" integer,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"failure_class" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "knowledge_sync_run_nonnegative_operational_counts" CHECK ("knowledge_sync_run"."attempt_count" >= 1 and ("knowledge_sync_run"."lag_seconds" is null or "knowledge_sync_run"."lag_seconds" >= 0))
);
--> statement-breakpoint
CREATE TABLE "knowledge_sync_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"provider" text NOT NULL,
	"resource_hash" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone,
	"renewed_at" timestamp with time zone,
	"next_renewal_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"failure_class" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "knowledge_sync_subscription_retry_count" CHECK ("knowledge_sync_subscription"."retry_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "knowledge_sync_checkpoint" ADD COLUMN "indexed_source_revision" text;--> statement-breakpoint
ALTER TABLE "knowledge_sync_checkpoint" ADD COLUMN "last_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_sync_checkpoint" ADD COLUMN "last_reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_sync_checkpoint" ADD COLUMN "newest_source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_sync_checkpoint" ADD COLUMN "last_succeeded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_sync_checkpoint" ADD COLUMN "lag_seconds" integer;--> statement-breakpoint
ALTER TABLE "knowledge_sync_checkpoint" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sync_checkpoint" ADD COLUMN "next_reconcile_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_sync_checkpoint" ADD COLUMN "failure_class" text;--> statement-breakpoint
ALTER TABLE "knowledge_sync_event_delivery" ADD CONSTRAINT "knowledge_sync_event_delivery_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sync_lease" ADD CONSTRAINT "knowledge_sync_lease_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sync_run" ADD CONSTRAINT "knowledge_sync_run_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sync_subscription" ADD CONSTRAINT "knowledge_sync_subscription_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sync_event_source_provider_id" ON "knowledge_sync_event_delivery" USING btree ("workspace_id","source_id","provider_event_id");--> statement-breakpoint
CREATE INDEX "knowledge_sync_event_retry" ON "knowledge_sync_event_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "knowledge_sync_event_source_received" ON "knowledge_sync_event_delivery" USING btree ("workspace_id","source_id","received_at");--> statement-breakpoint
CREATE INDEX "knowledge_sync_lease_expiry" ON "knowledge_sync_lease" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "knowledge_sync_run_source_started" ON "knowledge_sync_run" USING btree ("workspace_id","source_id","started_at");--> statement-breakpoint
CREATE INDEX "knowledge_sync_run_status" ON "knowledge_sync_run" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sync_subscription_source_provider_resource" ON "knowledge_sync_subscription" USING btree ("workspace_id","source_id","provider","resource_hash");--> statement-breakpoint
CREATE INDEX "knowledge_sync_subscription_renewal" ON "knowledge_sync_subscription" USING btree ("status","next_renewal_at");--> statement-breakpoint
CREATE INDEX "knowledge_checkpoint_next_reconcile" ON "knowledge_sync_checkpoint" USING btree ("next_reconcile_at","status");--> statement-breakpoint
ALTER TABLE "knowledge_sync_checkpoint" ADD CONSTRAINT "knowledge_checkpoint_nonnegative_operational_counts" CHECK ("knowledge_sync_checkpoint"."retry_count" >= 0 and ("knowledge_sync_checkpoint"."lag_seconds" is null or "knowledge_sync_checkpoint"."lag_seconds" >= 0));
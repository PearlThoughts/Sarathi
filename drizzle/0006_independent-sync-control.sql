ALTER TABLE "knowledge_sync_event_delivery" DROP CONSTRAINT IF EXISTS "knowledge_sync_event_delivery_source_id_knowledge_source_id_fk";--> statement-breakpoint
ALTER TABLE "knowledge_sync_lease" DROP CONSTRAINT IF EXISTS "knowledge_sync_lease_source_id_knowledge_source_id_fk";--> statement-breakpoint
ALTER TABLE "knowledge_sync_run" DROP CONSTRAINT IF EXISTS "knowledge_sync_run_source_id_knowledge_source_id_fk";--> statement-breakpoint
ALTER TABLE "knowledge_sync_subscription" DROP CONSTRAINT IF EXISTS "knowledge_sync_subscription_source_id_knowledge_source_id_fk";

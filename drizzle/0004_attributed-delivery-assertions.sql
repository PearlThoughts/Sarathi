ALTER TABLE "delivery_claim" ADD COLUMN "external_assertion_id" text;--> statement-breakpoint
ALTER TABLE "delivery_claim" ADD COLUMN "supersedes_assertion_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_claim" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "delivery_claim" ADD COLUMN "assertion_schema_version" integer;--> statement-breakpoint
CREATE INDEX "delivery_claim_external_assertion" ON "delivery_claim" USING btree ("workspace_id","external_assertion_id","active","deleted_at");--> statement-breakpoint
ALTER TABLE "delivery_claim" ADD CONSTRAINT "delivery_claim_confidence_range" CHECK ("delivery_claim"."confidence" is null or ("delivery_claim"."confidence" >= 0 and "delivery_claim"."confidence" <= 1));--> statement-breakpoint
ALTER TABLE "delivery_claim" ADD CONSTRAINT "delivery_claim_schema_version_positive" CHECK ("delivery_claim"."assertion_schema_version" is null or "delivery_claim"."assertion_schema_version" >= 1);
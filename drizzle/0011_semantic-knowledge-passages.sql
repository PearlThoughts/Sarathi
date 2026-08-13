ALTER TABLE "knowledge_passage" ADD COLUMN "parent_locator" text;
--> statement-breakpoint
ALTER TABLE "knowledge_passage" ADD COLUMN "hierarchy" jsonb;
--> statement-breakpoint
ALTER TABLE "knowledge_passage" ADD COLUMN "line_start" integer;
--> statement-breakpoint
ALTER TABLE "knowledge_passage" ADD COLUMN "line_end" integer;
--> statement-breakpoint
ALTER TABLE "knowledge_passage" ADD COLUMN "attributes" jsonb;
--> statement-breakpoint
CREATE INDEX "knowledge_passage_parent" ON "knowledge_passage" USING btree ("version_id","parent_locator");

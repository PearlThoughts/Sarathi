CREATE TABLE "knowledge_acl_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"passage_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"effect" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_item" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"external_id" text NOT NULL,
	"source_type" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text NOT NULL,
	"sensitivity" text NOT NULL,
	"authority" real NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "knowledge_passage" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"version_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"locator" text NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"canonical_url" text NOT NULL,
	"sensitivity" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_projection" (
	"passage_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_dimensions" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_source" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"authority" real NOT NULL,
	"scope_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sync_checkpoint" (
	"source_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"cursor" text NOT NULL,
	"scope_hash" text NOT NULL,
	"documents_observed" integer NOT NULL,
	"versions_created" integer NOT NULL,
	"passages_active" integer NOT NULL,
	"items_deleted" integer NOT NULL,
	"checksum" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "knowledge_sync_checkpoint_source_id_workspace_id_pk" PRIMARY KEY("source_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_version" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"source_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"tombstone" boolean DEFAULT false NOT NULL,
	"provenance" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_acl_binding" ADD CONSTRAINT "knowledge_acl_binding_passage_id_knowledge_passage_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."knowledge_passage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD CONSTRAINT "knowledge_item_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_passage" ADD CONSTRAINT "knowledge_passage_item_id_knowledge_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_passage" ADD CONSTRAINT "knowledge_passage_version_id_knowledge_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."knowledge_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_projection" ADD CONSTRAINT "knowledge_projection_passage_id_knowledge_passage_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."knowledge_passage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sync_checkpoint" ADD CONSTRAINT "knowledge_sync_checkpoint_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_version" ADD CONSTRAINT "knowledge_version_item_id_knowledge_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_acl_passage_subject" ON "knowledge_acl_binding" USING btree ("passage_id","subject_type","subject_id","effect");--> statement-breakpoint
CREATE INDEX "knowledge_acl_workspace_subject" ON "knowledge_acl_binding" USING btree ("workspace_id","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_item_source_external" ON "knowledge_item" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "knowledge_item_workspace_active" ON "knowledge_item" USING btree ("workspace_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_passage_version_locator" ON "knowledge_passage" USING btree ("version_id","locator");--> statement-breakpoint
CREATE INDEX "knowledge_passage_workspace_active" ON "knowledge_passage" USING btree ("workspace_id","active");--> statement-breakpoint
CREATE INDEX "knowledge_passage_search" ON "knowledge_passage" USING gin (to_tsvector('english', "title" || ' ' || "body"));--> statement-breakpoint
CREATE INDEX "knowledge_projection_embedding_hnsw" ON "knowledge_projection" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "knowledge_projection_workspace" ON "knowledge_projection" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_source_workspace_id" ON "knowledge_source" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "knowledge_checkpoint_workspace" ON "knowledge_sync_checkpoint" USING btree ("workspace_id","synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_version_item_source_version" ON "knowledge_version" USING btree ("item_id","source_version");--> statement-breakpoint
CREATE INDEX "knowledge_version_workspace_active" ON "knowledge_version" USING btree ("workspace_id","active","tombstone");
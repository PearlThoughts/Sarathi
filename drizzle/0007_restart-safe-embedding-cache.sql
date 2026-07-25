CREATE TABLE "knowledge_embedding_cache" (
	"workspace_id" text NOT NULL,
	"source_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_dimensions" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "knowledge_embedding_cache_workspace_id_source_id_content_hash_embedding_model_embedding_dimensions_pk" PRIMARY KEY("workspace_id","source_id","content_hash","embedding_model","embedding_dimensions")
);
--> statement-breakpoint
CREATE INDEX "knowledge_embedding_cache_created" ON "knowledge_embedding_cache" USING btree ("created_at");

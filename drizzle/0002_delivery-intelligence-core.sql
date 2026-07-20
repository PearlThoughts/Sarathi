CREATE TABLE "delivery_acl_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"effect" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"subject_object_id" text,
	"subject_key" text NOT NULL,
	"predicate" text NOT NULL,
	"value" jsonb NOT NULL,
	"value_hash" text NOT NULL,
	"asserted_by" text,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"source_item_id" text NOT NULL,
	"source_version_id" text NOT NULL,
	"citation_url" text NOT NULL,
	"asserted_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"sensitivity" text NOT NULL,
	"authority" real NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "delivery_finance_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"subject_object_id" text NOT NULL,
	"metric_kind" text NOT NULL,
	"value" numeric(24, 6) NOT NULL,
	"unit" text NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"sensitivity" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"source_item_id" text NOT NULL,
	"source_version_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "delivery_finance_metric_confidential" CHECK ("delivery_finance_metric"."sensitivity" in ('confidential', 'restricted'))
);
--> statement-breakpoint
CREATE TABLE "delivery_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"subject_object_id" text NOT NULL,
	"metric_category" text NOT NULL,
	"metric_kind" text NOT NULL,
	"value" numeric(24, 6) NOT NULL,
	"unit" text NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"sensitivity" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"source_item_id" text NOT NULL,
	"source_version_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "delivery_metric_excludes_finance" CHECK ("delivery_metric"."metric_category" <> 'finance')
);
--> statement-breakpoint
CREATE TABLE "delivery_object" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"object_kind" text NOT NULL,
	"external_key" text NOT NULL,
	"title" text NOT NULL,
	"lifecycle_state" text,
	"attributes" jsonb NOT NULL,
	"sensitivity" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"source_item_id" text NOT NULL,
	"source_version_id" text NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "delivery_observation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"observation_kind" text NOT NULL,
	"external_id" text NOT NULL,
	"subject_object_id" text,
	"actor_external_key" text,
	"summary" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"sensitivity" text NOT NULL,
	"authority" real NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"source_item_id" text NOT NULL,
	"source_version_id" text NOT NULL,
	"citation_url" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "delivery_relation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"relation_kind" text NOT NULL,
	"from_object_id" text NOT NULL,
	"to_object_id" text NOT NULL,
	"attributes" jsonb NOT NULL,
	"sensitivity" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"source_item_id" text NOT NULL,
	"source_version_id" text NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "delivery_claim" ADD CONSTRAINT "delivery_claim_subject_object_id_delivery_object_id_fk" FOREIGN KEY ("subject_object_id") REFERENCES "public"."delivery_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_claim" ADD CONSTRAINT "delivery_claim_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_claim" ADD CONSTRAINT "delivery_claim_source_item_id_knowledge_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_claim" ADD CONSTRAINT "delivery_claim_source_version_id_knowledge_version_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."knowledge_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_finance_metric" ADD CONSTRAINT "delivery_finance_metric_subject_object_id_delivery_object_id_fk" FOREIGN KEY ("subject_object_id") REFERENCES "public"."delivery_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_finance_metric" ADD CONSTRAINT "delivery_finance_metric_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_finance_metric" ADD CONSTRAINT "delivery_finance_metric_source_item_id_knowledge_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_finance_metric" ADD CONSTRAINT "delivery_finance_metric_source_version_id_knowledge_version_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."knowledge_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_metric" ADD CONSTRAINT "delivery_metric_subject_object_id_delivery_object_id_fk" FOREIGN KEY ("subject_object_id") REFERENCES "public"."delivery_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_metric" ADD CONSTRAINT "delivery_metric_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_metric" ADD CONSTRAINT "delivery_metric_source_item_id_knowledge_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_metric" ADD CONSTRAINT "delivery_metric_source_version_id_knowledge_version_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."knowledge_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_object" ADD CONSTRAINT "delivery_object_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_object" ADD CONSTRAINT "delivery_object_source_item_id_knowledge_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_object" ADD CONSTRAINT "delivery_object_source_version_id_knowledge_version_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."knowledge_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_observation" ADD CONSTRAINT "delivery_observation_subject_object_id_delivery_object_id_fk" FOREIGN KEY ("subject_object_id") REFERENCES "public"."delivery_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_observation" ADD CONSTRAINT "delivery_observation_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_observation" ADD CONSTRAINT "delivery_observation_source_item_id_knowledge_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_observation" ADD CONSTRAINT "delivery_observation_source_version_id_knowledge_version_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."knowledge_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_relation" ADD CONSTRAINT "delivery_relation_from_object_id_delivery_object_id_fk" FOREIGN KEY ("from_object_id") REFERENCES "public"."delivery_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_relation" ADD CONSTRAINT "delivery_relation_to_object_id_delivery_object_id_fk" FOREIGN KEY ("to_object_id") REFERENCES "public"."delivery_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_relation" ADD CONSTRAINT "delivery_relation_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_relation" ADD CONSTRAINT "delivery_relation_source_item_id_knowledge_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_relation" ADD CONSTRAINT "delivery_relation_source_version_id_knowledge_version_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."knowledge_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_acl_target_subject" ON "delivery_acl_binding" USING btree ("target_type","target_id","subject_type","subject_id","effect");--> statement-breakpoint
CREATE INDEX "delivery_acl_workspace_subject" ON "delivery_acl_binding" USING btree ("workspace_id","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_claim_source_value" ON "delivery_claim" USING btree ("source_version_id","subject_key","predicate","value_hash");--> statement-breakpoint
CREATE INDEX "delivery_claim_workspace_subject_predicate" ON "delivery_claim" USING btree ("workspace_id","subject_key","predicate","active","deleted_at");--> statement-breakpoint
CREATE INDEX "delivery_claim_subject_object" ON "delivery_claim" USING btree ("subject_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_finance_metric_workspace_subject_kind_effective" ON "delivery_finance_metric" USING btree ("workspace_id","subject_object_id","metric_kind","effective_from","source_version_id");--> statement-breakpoint
CREATE INDEX "delivery_finance_metric_workspace_kind_active" ON "delivery_finance_metric" USING btree ("workspace_id","metric_kind","active","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_metric_workspace_subject_kind_effective" ON "delivery_metric" USING btree ("workspace_id","subject_object_id","metric_kind","effective_from","source_version_id");--> statement-breakpoint
CREATE INDEX "delivery_metric_workspace_category_kind_active" ON "delivery_metric" USING btree ("workspace_id","metric_category","metric_kind","active","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_object_workspace_source_kind_key" ON "delivery_object" USING btree ("workspace_id","source_id","object_kind","external_key");--> statement-breakpoint
CREATE INDEX "delivery_object_workspace_kind_active" ON "delivery_object" USING btree ("workspace_id","object_kind","active","deleted_at");--> statement-breakpoint
CREATE INDEX "delivery_object_source_version" ON "delivery_object" USING btree ("source_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_observation_workspace_source_external" ON "delivery_observation" USING btree ("workspace_id","source_id","external_id");--> statement-breakpoint
CREATE INDEX "delivery_observation_workspace_kind_active" ON "delivery_observation" USING btree ("workspace_id","observation_kind","active","deleted_at");--> statement-breakpoint
CREATE INDEX "delivery_observation_workspace_dedupe" ON "delivery_observation" USING btree ("workspace_id","dedupe_key","active");--> statement-breakpoint
CREATE INDEX "delivery_observation_occurred" ON "delivery_observation" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_relation_workspace_edge" ON "delivery_relation" USING btree ("workspace_id","source_id","relation_kind","from_object_id","to_object_id","source_version_id");--> statement-breakpoint
CREATE INDEX "delivery_relation_workspace_kind_active" ON "delivery_relation" USING btree ("workspace_id","relation_kind","active","deleted_at");--> statement-breakpoint
CREATE INDEX "delivery_relation_from_object" ON "delivery_relation" USING btree ("from_object_id");--> statement-breakpoint
CREATE INDEX "delivery_relation_to_object" ON "delivery_relation" USING btree ("to_object_id");
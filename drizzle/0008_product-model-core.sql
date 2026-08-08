CREATE TABLE "product_entity_alias" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_kind" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"kind" text NOT NULL,
	"source_class" text,
	"sensitivity" text NOT NULL,
	"audience" jsonb NOT NULL,
	"created_revision" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "product_entity_alias_workspace_id_id_created_revision_pk" PRIMARY KEY("workspace_id","id","created_revision"),
	CONSTRAINT "product_entity_alias_kind" CHECK ("product_entity_alias"."kind" in ('canonical', 'former_name', 'alternate', 'abbreviation')),
	CONSTRAINT "product_entity_alias_validity" CHECK ("product_entity_alias"."valid_to" is null or "product_entity_alias"."valid_to" > "product_entity_alias"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "product_entity_attachment" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"attachment_kind" text NOT NULL,
	"reference_id" text NOT NULL,
	"registration" text NOT NULL,
	"source_class" text NOT NULL,
	"sensitivity" text NOT NULL,
	"audience" jsonb NOT NULL,
	"created_revision" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "product_entity_attachment_workspace_id_id_created_revision_pk" PRIMARY KEY("workspace_id","id","created_revision"),
	CONSTRAINT "product_entity_attachment_kind" CHECK ("product_entity_attachment"."attachment_kind" in ('claim', 'delivery_reference', 'external_reference'))
);
--> statement-breakpoint
CREATE TABLE "product_entity_state" (
	"workspace_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"canonical_name" text NOT NULL,
	"description" text,
	"registration" text NOT NULL,
	"lifecycle" text NOT NULL,
	"sensitivity" text NOT NULL,
	"audience" jsonb NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "product_entity_state_workspace_id_entity_id_revision_pk" PRIMARY KEY("workspace_id","entity_id","revision"),
	CONSTRAINT "product_entity_state_registration" CHECK ("product_entity_state"."registration" in ('candidate', 'ratified', 'contested', 'superseded')),
	CONSTRAINT "product_entity_state_lifecycle" CHECK ("product_entity_state"."lifecycle" in ('planned', 'available', 'deprecated', 'retired', 'unknown')),
	CONSTRAINT "product_entity_state_validity" CHECK ("product_entity_state"."valid_to" is null or "product_entity_state"."valid_to" > "product_entity_state"."valid_from"),
	CONSTRAINT "product_entity_state_recording" CHECK ("product_entity_state"."superseded_at" is null or "product_entity_state"."superseded_at" >= "product_entity_state"."recorded_at")
);
--> statement-breakpoint
CREATE TABLE "product_entity" (
	"workspace_id" text NOT NULL,
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_entity_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "product_entity_kind" CHECK ("product_entity"."kind" in ('product', 'area', 'capability', 'feature'))
);
--> statement-breakpoint
CREATE TABLE "product_hierarchy_edge" (
	"workspace_id" text NOT NULL,
	"child_id" uuid NOT NULL,
	"parent_id" uuid NOT NULL,
	"created_revision" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "product_hierarchy_edge_workspace_id_child_id_created_revision_pk" PRIMARY KEY("workspace_id","child_id","created_revision"),
	CONSTRAINT "product_hierarchy_edge_not_self" CHECK ("product_hierarchy_edge"."child_id" <> "product_hierarchy_edge"."parent_id"),
	CONSTRAINT "product_hierarchy_edge_validity" CHECK ("product_hierarchy_edge"."valid_to" is null or "product_hierarchy_edge"."valid_to" > "product_hierarchy_edge"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "product_identity_event" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"revision" integer NOT NULL,
	"event_type" text NOT NULL,
	"entity_ids" jsonb NOT NULL,
	"details" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_identity_event_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "product_redirect" (
	"workspace_id" text NOT NULL,
	"from_entity_id" uuid NOT NULL,
	"to_entity_id" uuid NOT NULL,
	"created_revision" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "product_redirect_workspace_id_from_entity_id_created_revision_pk" PRIMARY KEY("workspace_id","from_entity_id","created_revision"),
	CONSTRAINT "product_redirect_not_self" CHECK ("product_redirect"."from_entity_id" <> "product_redirect"."to_entity_id")
);
--> statement-breakpoint
CREATE TABLE "product_reference_orphan" (
	"workspace_id" text NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"reference_kind" text NOT NULL,
	"reference_id" text NOT NULL,
	"created_revision" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"resolved_revision" integer,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "product_reference_orphan_workspace_id_source_entity_id_reference_kind_reference_id_created_revision_pk" PRIMARY KEY("workspace_id","source_entity_id","reference_kind","reference_id","created_revision"),
	CONSTRAINT "product_reference_orphan_kind" CHECK ("product_reference_orphan"."reference_kind" in ('alias', 'variant', 'relation_source', 'relation_target', 'attachment', 'child')),
	CONSTRAINT "product_reference_orphan_resolution" CHECK (("product_reference_orphan"."resolved_revision" is null and "product_reference_orphan"."resolved_at" is null) or ("product_reference_orphan"."resolved_revision" is not null and "product_reference_orphan"."resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "product_relation" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"relation_type" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_entity_id" uuid,
	"source_reference_kind" text,
	"source_reference_id" text,
	"target_kind" text NOT NULL,
	"target_entity_id" uuid,
	"target_reference_kind" text,
	"target_reference_id" text,
	"registration" text NOT NULL,
	"source_class" text NOT NULL,
	"sensitivity" text NOT NULL,
	"audience" jsonb NOT NULL,
	"created_revision" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "product_relation_workspace_id_id_created_revision_pk" PRIMARY KEY("workspace_id","id","created_revision"),
	CONSTRAINT "product_relation_source_kind" CHECK ("product_relation"."source_kind" in ('entity', 'external')),
	CONSTRAINT "product_relation_target_kind" CHECK ("product_relation"."target_kind" in ('entity', 'external')),
	CONSTRAINT "product_relation_source_shape" CHECK (("product_relation"."source_kind" = 'entity' and "product_relation"."source_entity_id" is not null and "product_relation"."source_reference_kind" is null and "product_relation"."source_reference_id" is null) or ("product_relation"."source_kind" = 'external' and "product_relation"."source_entity_id" is null and "product_relation"."source_reference_kind" is not null and "product_relation"."source_reference_id" is not null)),
	CONSTRAINT "product_relation_target_shape" CHECK (("product_relation"."target_kind" = 'entity' and "product_relation"."target_entity_id" is not null and "product_relation"."target_reference_kind" is null and "product_relation"."target_reference_id" is null) or ("product_relation"."target_kind" = 'external' and "product_relation"."target_entity_id" is null and "product_relation"."target_reference_kind" is not null and "product_relation"."target_reference_id" is not null)),
	CONSTRAINT "product_relation_validity" CHECK ("product_relation"."valid_to" is null or "product_relation"."valid_to" > "product_relation"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "product_revision" (
	"workspace_id" text NOT NULL,
	"revision" integer NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_revision_workspace_id_revision_pk" PRIMARY KEY("workspace_id","revision"),
	CONSTRAINT "product_revision_positive" CHECK ("product_revision"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "product_variant" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"base_entity_id" uuid NOT NULL,
	"qualifiers" jsonb NOT NULL,
	"delta" jsonb NOT NULL,
	"precedence" integer NOT NULL,
	"registration" text NOT NULL,
	"source_class" text NOT NULL,
	"sensitivity" text NOT NULL,
	"audience" jsonb NOT NULL,
	"created_revision" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "product_variant_workspace_id_id_created_revision_pk" PRIMARY KEY("workspace_id","id","created_revision"),
	CONSTRAINT "product_variant_validity" CHECK ("product_variant"."valid_to" is null or "product_variant"."valid_to" > "product_variant"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "product_entity_alias" ADD CONSTRAINT "product_entity_alias_entity_fk" FOREIGN KEY ("workspace_id","entity_id","entity_kind") REFERENCES "public"."product_entity"("workspace_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_entity_alias" ADD CONSTRAINT "product_entity_alias_revision_fk" FOREIGN KEY ("workspace_id","created_revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_entity_attachment" ADD CONSTRAINT "product_entity_attachment_entity_fk" FOREIGN KEY ("workspace_id","entity_id") REFERENCES "public"."product_entity"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_entity_attachment" ADD CONSTRAINT "product_entity_attachment_revision_fk" FOREIGN KEY ("workspace_id","created_revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_entity_state" ADD CONSTRAINT "product_entity_state_entity_fk" FOREIGN KEY ("workspace_id","entity_id") REFERENCES "public"."product_entity"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_entity_state" ADD CONSTRAINT "product_entity_state_revision_fk" FOREIGN KEY ("workspace_id","revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_entity" ADD CONSTRAINT "product_entity_created_revision_fk" FOREIGN KEY ("workspace_id","created_revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_hierarchy_edge" ADD CONSTRAINT "product_hierarchy_edge_child_fk" FOREIGN KEY ("workspace_id","child_id") REFERENCES "public"."product_entity"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_hierarchy_edge" ADD CONSTRAINT "product_hierarchy_edge_parent_fk" FOREIGN KEY ("workspace_id","parent_id") REFERENCES "public"."product_entity"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_hierarchy_edge" ADD CONSTRAINT "product_hierarchy_edge_revision_fk" FOREIGN KEY ("workspace_id","created_revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_identity_event" ADD CONSTRAINT "product_identity_event_revision_fk" FOREIGN KEY ("workspace_id","revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_redirect" ADD CONSTRAINT "product_redirect_from_entity_fk" FOREIGN KEY ("workspace_id","from_entity_id") REFERENCES "public"."product_entity"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_redirect" ADD CONSTRAINT "product_redirect_to_entity_fk" FOREIGN KEY ("workspace_id","to_entity_id") REFERENCES "public"."product_entity"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_redirect" ADD CONSTRAINT "product_redirect_revision_fk" FOREIGN KEY ("workspace_id","created_revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reference_orphan" ADD CONSTRAINT "product_reference_orphan_source_entity_fk" FOREIGN KEY ("workspace_id","source_entity_id") REFERENCES "public"."product_entity"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reference_orphan" ADD CONSTRAINT "product_reference_orphan_created_revision_fk" FOREIGN KEY ("workspace_id","created_revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reference_orphan" ADD CONSTRAINT "product_reference_orphan_resolved_revision_fk" FOREIGN KEY ("workspace_id","resolved_revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relation" ADD CONSTRAINT "product_relation_source_entity_fk" FOREIGN KEY ("workspace_id","source_entity_id") REFERENCES "public"."product_entity"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relation" ADD CONSTRAINT "product_relation_target_entity_fk" FOREIGN KEY ("workspace_id","target_entity_id") REFERENCES "public"."product_entity"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relation" ADD CONSTRAINT "product_relation_revision_fk" FOREIGN KEY ("workspace_id","created_revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_base_entity_fk" FOREIGN KEY ("workspace_id","base_entity_id") REFERENCES "public"."product_entity"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_revision_fk" FOREIGN KEY ("workspace_id","created_revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_entity_alias_current_lookup" ON "product_entity_alias" USING btree ("workspace_id","entity_kind","normalized_value") WHERE "product_entity_alias"."superseded_at" is null and "product_entity_alias"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "product_entity_alias_entity" ON "product_entity_alias" USING btree ("workspace_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_entity_attachment_current_id" ON "product_entity_attachment" USING btree ("workspace_id","id") WHERE "product_entity_attachment"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "product_entity_attachment_current_entity" ON "product_entity_attachment" USING btree ("workspace_id","entity_id","superseded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_entity_state_current" ON "product_entity_state" USING btree ("workspace_id","entity_id") WHERE "product_entity_state"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "product_entity_state_workspace_revision" ON "product_entity_state" USING btree ("workspace_id","revision");--> statement-breakpoint
CREATE INDEX "product_entity_state_workspace_valid_time" ON "product_entity_state" USING btree ("workspace_id","valid_from","valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX "product_entity_workspace_id_kind" ON "product_entity" USING btree ("workspace_id","id","kind");--> statement-breakpoint
CREATE INDEX "product_entity_workspace_kind" ON "product_entity" USING btree ("workspace_id","kind","id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_hierarchy_edge_current_parent" ON "product_hierarchy_edge" USING btree ("workspace_id","child_id") WHERE "product_hierarchy_edge"."superseded_at" is null and "product_hierarchy_edge"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "product_hierarchy_edge_current_children" ON "product_hierarchy_edge" USING btree ("workspace_id","parent_id","superseded_at","valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX "product_identity_event_workspace_revision" ON "product_identity_event" USING btree ("workspace_id","revision");--> statement-breakpoint
CREATE INDEX "product_identity_event_workspace_valid_time" ON "product_identity_event" USING btree ("workspace_id","valid_from","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "product_redirect_current_source" ON "product_redirect" USING btree ("workspace_id","from_entity_id") WHERE "product_redirect"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "product_redirect_current_target" ON "product_redirect" USING btree ("workspace_id","to_entity_id","superseded_at");--> statement-breakpoint
CREATE INDEX "product_reference_orphan_unresolved" ON "product_reference_orphan" USING btree ("workspace_id","source_entity_id","resolved_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "product_relation_current_id" ON "product_relation" USING btree ("workspace_id","id") WHERE "product_relation"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "product_relation_current_source" ON "product_relation" USING btree ("workspace_id","source_entity_id","relation_type","superseded_at");--> statement-breakpoint
CREATE INDEX "product_relation_current_target" ON "product_relation" USING btree ("workspace_id","target_entity_id","relation_type","superseded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_revision_workspace_event" ON "product_revision" USING btree ("workspace_id","event_id");--> statement-breakpoint
CREATE INDEX "product_revision_workspace_valid_time" ON "product_revision" USING btree ("workspace_id","valid_from","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_current_id" ON "product_variant" USING btree ("workspace_id","id") WHERE "product_variant"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "product_variant_current_base" ON "product_variant" USING btree ("workspace_id","base_entity_id","superseded_at","valid_from","valid_to");
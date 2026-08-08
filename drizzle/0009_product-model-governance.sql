CREATE TABLE "product_change_proposal" (
	"workspace_id" text NOT NULL,
	"id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"target_entity_ids" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"evidence_reference_ids" jsonb NOT NULL,
	"expected_revision" integer NOT NULL,
	"justification" text NOT NULL,
	"state" text NOT NULL,
	"source_class" text NOT NULL,
	"proposed_by_actor_id" text NOT NULL,
	"sensitivity" text NOT NULL,
	"audience" jsonb NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reviewed_by_actor_id" text,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "product_change_proposal_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "product_change_proposal_revision" CHECK ("product_change_proposal"."expected_revision" >= 0),
	CONSTRAINT "product_change_proposal_state" CHECK ("product_change_proposal"."state" in ('pending', 'approved', 'rejected', 'expired', 'withdrawn')),
	CONSTRAINT "product_change_proposal_expiry" CHECK ("product_change_proposal"."expires_at" > "product_change_proposal"."proposed_at"),
	CONSTRAINT "product_change_proposal_review" CHECK (("product_change_proposal"."state" in ('pending', 'expired', 'withdrawn') and "product_change_proposal"."reviewed_by_actor_id" is null and "product_change_proposal"."reviewed_at" is null) or ("product_change_proposal"."state" in ('approved', 'rejected') and "product_change_proposal"."reviewed_by_actor_id" is not null and "product_change_proposal"."reviewed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "product_claim" (
	"workspace_id" text NOT NULL,
	"id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"claim_type" text NOT NULL,
	"predicate" text NOT NULL,
	"value" jsonb NOT NULL,
	"evidence_reference_ids" jsonb NOT NULL,
	"registration" text NOT NULL,
	"source_class" text NOT NULL,
	"sensitivity" text NOT NULL,
	"audience" jsonb NOT NULL,
	"created_revision" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "product_claim_workspace_id_id_created_revision_pk" PRIMARY KEY("workspace_id","id","created_revision"),
	CONSTRAINT "product_claim_type" CHECK ("product_claim"."claim_type" in ('definition', 'invariant', 'exclusion', 'availability', 'behavior')),
	CONSTRAINT "product_claim_registration" CHECK ("product_claim"."registration" in ('candidate', 'ratified', 'contested', 'superseded')),
	CONSTRAINT "product_claim_validity" CHECK ("product_claim"."valid_to" is null or "product_claim"."valid_to" > "product_claim"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "product_command_audit" (
	"workspace_id" text NOT NULL,
	"id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"command_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"command_hash" text NOT NULL,
	"justification" text NOT NULL,
	"outcome" text NOT NULL,
	"resulting_revision" integer,
	"event_id" text,
	"impact_summary" jsonb NOT NULL,
	"sensitivity" text NOT NULL,
	"audience" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_command_audit_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "product_command_audit_outcome" CHECK ("product_command_audit"."outcome" in ('committed', 'rejected', 'failed')),
	CONSTRAINT "product_command_audit_result" CHECK (("product_command_audit"."outcome" = 'committed' and "product_command_audit"."resulting_revision" is not null and "product_command_audit"."event_id" is not null) or ("product_command_audit"."outcome" <> 'committed' and "product_command_audit"."resulting_revision" is null and "product_command_audit"."event_id" is null))
);
--> statement-breakpoint
CREATE TABLE "product_external_reference" (
	"workspace_id" text NOT NULL,
	"id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"reference_kind" text NOT NULL,
	"source_class" text NOT NULL,
	"external_id" text NOT NULL,
	"canonical_url" text,
	"sensitivity" text NOT NULL,
	"audience" jsonb NOT NULL,
	"model_egress" text NOT NULL,
	"created_revision" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "product_external_reference_workspace_id_id_created_revision_pk" PRIMARY KEY("workspace_id","id","created_revision"),
	CONSTRAINT "product_external_reference_kind" CHECK ("product_external_reference"."reference_kind" in ('delivery', 'intent', 'technical', 'runtime', 'evidence', 'policy', 'availability')),
	CONSTRAINT "product_external_reference_model_egress" CHECK ("product_external_reference"."model_egress" in ('allow', 'redact', 'block', 'approval-required')),
	CONSTRAINT "product_external_reference_validity" CHECK ("product_external_reference"."valid_to" is null or "product_external_reference"."valid_to" > "product_external_reference"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "product_outbox_event" (
	"workspace_id" text NOT NULL,
	"id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_ids" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"sensitivity" text NOT NULL,
	"audience" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_outbox_event_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "product_outbox_event_attempts" CHECK ("product_outbox_event"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_claim" ADD CONSTRAINT "product_claim_entity_fk" FOREIGN KEY ("workspace_id","entity_id") REFERENCES "public"."product_entity"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_claim" ADD CONSTRAINT "product_claim_revision_fk" FOREIGN KEY ("workspace_id","created_revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_command_audit" ADD CONSTRAINT "product_command_audit_revision_fk" FOREIGN KEY ("workspace_id","resulting_revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_external_reference" ADD CONSTRAINT "product_external_reference_entity_fk" FOREIGN KEY ("workspace_id","entity_id") REFERENCES "public"."product_entity"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_external_reference" ADD CONSTRAINT "product_external_reference_revision_fk" FOREIGN KEY ("workspace_id","created_revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_outbox_event" ADD CONSTRAINT "product_outbox_event_revision_fk" FOREIGN KEY ("workspace_id","revision") REFERENCES "public"."product_revision"("workspace_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_change_proposal_review_queue" ON "product_change_proposal" USING btree ("workspace_id","state","expires_at","proposed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_claim_current_id" ON "product_claim" USING btree ("workspace_id","id") WHERE "product_claim"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "product_claim_current_entity" ON "product_claim" USING btree ("workspace_id","entity_id","claim_type","registration","superseded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_command_audit_idempotency" ON "product_command_audit" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "product_command_audit_request" ON "product_command_audit" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE INDEX "product_command_audit_revision" ON "product_command_audit" USING btree ("workspace_id","resulting_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "product_external_reference_current_source" ON "product_external_reference" USING btree ("workspace_id","source_class","reference_kind","external_id") WHERE "product_external_reference"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "product_external_reference_current_entity" ON "product_external_reference" USING btree ("workspace_id","entity_id","reference_kind","superseded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_outbox_event_revision_type" ON "product_outbox_event" USING btree ("workspace_id","revision","event_type");--> statement-breakpoint
CREATE INDEX "product_outbox_event_unpublished" ON "product_outbox_event" USING btree ("workspace_id","published_at","created_at");
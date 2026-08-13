CREATE TABLE "answer_feedback_answer" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"recipient_actor_id" text NOT NULL,
	"conversation_boundary_hash" text NOT NULL,
	"source_activity_hash" text NOT NULL,
	"answer_fingerprint" text NOT NULL,
	"query_fingerprint" text NOT NULL,
	"answer_text" text NOT NULL,
	"question_text" text NOT NULL,
	"model_name" text NOT NULL,
	"reasoning_configuration" text NOT NULL,
	"application_revision" text NOT NULL,
	"prompt_configuration_revision" text,
	"product_registry_revision" text,
	"retrieval_fingerprint" text,
	"response_product" text NOT NULL,
	"query_family" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	CONSTRAINT "answer_feedback_answer_state" CHECK ("answer_feedback_answer"."state" in ('prepared', 'delivered', 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE "answer_feedback_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"answer_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"revision" integer NOT NULL,
	"rating" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"correction" text,
	"idempotency_key_hash" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"review_disposition" text DEFAULT 'unreviewed' NOT NULL,
	"reviewed_by_actor_id" text,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "answer_feedback_revision_number" CHECK ("answer_feedback_revision"."revision" > 0),
	CONSTRAINT "answer_feedback_revision_rating" CHECK ("answer_feedback_revision"."rating" in ('useful_as_is', 'partly_useful', 'not_useful')),
	CONSTRAINT "answer_feedback_revision_disposition" CHECK ("answer_feedback_revision"."review_disposition" in ('unreviewed', 'accepted_for_evaluation', 'accepted_for_training', 'rejected')),
	CONSTRAINT "answer_feedback_revision_correction_length" CHECK ("answer_feedback_revision"."correction" is null or char_length("answer_feedback_revision"."correction") <= 2000),
	CONSTRAINT "answer_feedback_revision_review" CHECK (("answer_feedback_revision"."review_disposition" = 'unreviewed' and "answer_feedback_revision"."reviewed_by_actor_id" is null and "answer_feedback_revision"."reviewed_at" is null) or ("answer_feedback_revision"."review_disposition" <> 'unreviewed' and "answer_feedback_revision"."reviewed_by_actor_id" is not null and "answer_feedback_revision"."reviewed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "answer_feedback_current" (
	"answer_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "answer_feedback_current_answer_id_actor_id_pk" PRIMARY KEY("answer_id","actor_id")
);
--> statement-breakpoint
ALTER TABLE "answer_feedback_revision" ADD CONSTRAINT "answer_feedback_revision_answer_id_answer_feedback_answer_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answer_feedback_answer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_feedback_revision_identity" ON "answer_feedback_revision" USING btree ("answer_id","actor_id","id");--> statement-breakpoint
ALTER TABLE "answer_feedback_current" ADD CONSTRAINT "answer_feedback_current_revision_fk" FOREIGN KEY ("answer_id","actor_id","revision_id") REFERENCES "public"."answer_feedback_revision"("answer_id","actor_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_feedback_answer_source_activity" ON "answer_feedback_answer" USING btree ("workspace_id","source_activity_hash");--> statement-breakpoint
CREATE INDEX "answer_feedback_answer_fingerprint" ON "answer_feedback_answer" USING btree ("workspace_id","answer_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_feedback_revision_sequence" ON "answer_feedback_revision" USING btree ("answer_id","actor_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_feedback_revision_idempotency" ON "answer_feedback_revision" USING btree ("answer_id","actor_id","idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "answer_feedback_revision_workspace_review" ON "answer_feedback_revision" USING btree ("workspace_id","review_disposition","submitted_at");

import { MigrateUpArgs, MigrateDownArgs, sql } from "@payloadcms/db-postgres";

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE SCHEMA IF NOT EXISTS "product_studio";

   CREATE TABLE "product_studio"."studio_users_sessions" (
     "_order" integer NOT NULL,
     "_parent_id" uuid NOT NULL,
     "id" varchar PRIMARY KEY NOT NULL,
     "created_at" timestamp(3) with time zone,
     "expires_at" timestamp(3) with time zone NOT NULL
  );

  CREATE TABLE "product_studio"."studio_users" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
     "display_name" varchar NOT NULL,
     "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
     "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
     "email" varchar NOT NULL,
     "reset_password_token" varchar,
     "reset_password_expiration" timestamp(3) with time zone,
     "salt" varchar,
     "hash" varchar,
     "login_attempts" numeric DEFAULT 0,
     "lock_until" timestamp(3) with time zone
  );

  CREATE TABLE "product_studio"."payload_kv" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
     "key" varchar NOT NULL,
     "data" jsonb NOT NULL
  );

  CREATE TABLE "product_studio"."payload_locked_documents" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
     "global_slug" varchar,
     "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
     "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "product_studio"."payload_locked_documents_rels" (
     "id" serial PRIMARY KEY NOT NULL,
     "order" integer,
     "parent_id" uuid NOT NULL,
     "path" varchar NOT NULL,
     "studio_users_id" uuid
  );

  CREATE TABLE "product_studio"."payload_preferences" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
     "key" varchar,
     "value" jsonb,
     "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
     "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "product_studio"."payload_preferences_rels" (
     "id" serial PRIMARY KEY NOT NULL,
     "order" integer,
     "parent_id" uuid NOT NULL,
     "path" varchar NOT NULL,
     "studio_users_id" uuid
  );

  CREATE TABLE "product_studio"."payload_migrations" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
     "name" varchar,
     "batch" numeric,
     "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
     "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "product_studio"."studio_users_sessions" ADD CONSTRAINT "studio_users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "product_studio"."studio_users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "product_studio"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "product_studio"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "product_studio"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_studio_users_fk" FOREIGN KEY ("studio_users_id") REFERENCES "product_studio"."studio_users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "product_studio"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "product_studio"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "product_studio"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_studio_users_fk" FOREIGN KEY ("studio_users_id") REFERENCES "product_studio"."studio_users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "studio_users_sessions_order_idx" ON "product_studio"."studio_users_sessions" USING btree ("_order");
  CREATE INDEX "studio_users_sessions_parent_id_idx" ON "product_studio"."studio_users_sessions" USING btree ("_parent_id");
  CREATE INDEX "studio_users_updated_at_idx" ON "product_studio"."studio_users" USING btree ("updated_at");
  CREATE INDEX "studio_users_created_at_idx" ON "product_studio"."studio_users" USING btree ("created_at");
  CREATE UNIQUE INDEX "studio_users_email_idx" ON "product_studio"."studio_users" USING btree ("email");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "product_studio"."payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "product_studio"."payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "product_studio"."payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "product_studio"."payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "product_studio"."payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "product_studio"."payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "product_studio"."payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_studio_users_id_idx" ON "product_studio"."payload_locked_documents_rels" USING btree ("studio_users_id");
  CREATE INDEX "payload_preferences_key_idx" ON "product_studio"."payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "product_studio"."payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "product_studio"."payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "product_studio"."payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "product_studio"."payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "product_studio"."payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_studio_users_id_idx" ON "product_studio"."payload_preferences_rels" USING btree ("studio_users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "product_studio"."payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "product_studio"."payload_migrations" USING btree ("created_at");`);
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "product_studio"."studio_users_sessions" CASCADE;
  DROP TABLE "product_studio"."studio_users" CASCADE;
  DROP TABLE "product_studio"."payload_kv" CASCADE;
  DROP TABLE "product_studio"."payload_locked_documents" CASCADE;
  DROP TABLE "product_studio"."payload_locked_documents_rels" CASCADE;
  DROP TABLE "product_studio"."payload_preferences" CASCADE;
  DROP TABLE "product_studio"."payload_preferences_rels" CASCADE;
  DROP TABLE "product_studio"."payload_migrations" CASCADE;`);
}

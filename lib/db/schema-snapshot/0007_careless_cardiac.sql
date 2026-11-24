CREATE TABLE "mena_product_change_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"suggestion_id" text NOT NULL,
	"diff" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_product_change_proposals_status_check" CHECK ("mena_product_change_proposals"."status" IN ('proposed', 'accepted', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "mena_product_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"field" text NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	"source_type" text NOT NULL,
	"source_id" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_product_changes_source_type_check" CHECK ("mena_product_changes"."source_type" IN ('manual', 'extraction', 'order', 'publication'))
);
--> statement-breakpoint
CREATE TABLE "mena_product_extraction_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"job_id" text,
	"suggestion_id" text,
	"event" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mena_product_match_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"suggestion_id" text NOT NULL,
	"product_id" text NOT NULL,
	"strategy" text NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mena_webhook_idempotency" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_key" text NOT NULL,
	"workspace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" DROP CONSTRAINT "mena_product_extraction_status_check";--> statement-breakpoint
DROP INDEX "mena_product_extraction_source_workspace_message_key";--> statement-breakpoint
ALTER TABLE "mena_whatsapp_messages" ADD COLUMN "from_me" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_sources" ADD COLUMN "item_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "previous_suggestion_id" text;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "sender_role" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "match_strategy" text;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "matched_product_id" text;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "match_score" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "extraction_input_hash" text;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "ruleset_version" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "model_version" text;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "override_reason" text;--> statement-breakpoint
ALTER TABLE "mena_products" ADD COLUMN "normalized_name" text;--> statement-breakpoint
ALTER TABLE "mena_products" ADD COLUMN "source_trust" text DEFAULT 'merchant' NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_products" ADD COLUMN "last_extraction_suggestion_id" text;--> statement-breakpoint
ALTER TABLE "mena_products" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "mena_products" ADD COLUMN "updated_reason" text;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_product_extraction_jobs" ADD COLUMN "ruleset_version" text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_product_extraction_jobs" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_product_extraction_jobs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_product_extraction_jobs" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_product_extraction_jobs" ADD COLUMN "dead_letter_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mena_product_change_proposals" ADD CONSTRAINT "mena_product_change_proposals_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_change_proposals" ADD CONSTRAINT "mena_product_change_proposals_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."mena_products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_changes" ADD CONSTRAINT "mena_product_changes_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_changes" ADD CONSTRAINT "mena_product_changes_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."mena_products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_events" ADD CONSTRAINT "mena_product_extraction_events_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_match_candidates" ADD CONSTRAINT "mena_product_match_candidates_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_match_candidates" ADD CONSTRAINT "mena_product_match_candidates_suggestion_fk" FOREIGN KEY ("workspace_id","suggestion_id") REFERENCES "public"."mena_product_extraction_suggestions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_webhook_idempotency" ADD CONSTRAINT "mena_webhook_idempotency_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_change_proposals_workspace_id_key" ON "mena_product_change_proposals" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_change_proposals_suggestion_idx" ON "mena_product_change_proposals" USING btree ("workspace_id","suggestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_changes_workspace_id_key" ON "mena_product_changes" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "mena_product_changes_product_created_idx" ON "mena_product_changes" USING btree ("workspace_id","product_id","created_at");--> statement-breakpoint
CREATE INDEX "mena_product_extraction_events_workspace_created_idx" ON "mena_product_extraction_events" USING btree ("workspace_id","event","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_match_candidates_workspace_id_key" ON "mena_product_match_candidates" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "mena_product_match_candidates_suggestion_idx" ON "mena_product_match_candidates" USING btree ("workspace_id","suggestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_webhook_idempotency_provider_event_key" ON "mena_webhook_idempotency" USING btree ("provider","event_key");--> statement-breakpoint
CREATE INDEX "mena_webhook_idempotency_created_idx" ON "mena_webhook_idempotency" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_extraction_version_key" ON "mena_product_extraction_suggestions" USING btree ("workspace_id","previous_suggestion_id","version");--> statement-breakpoint
CREATE INDEX "mena_products_workspace_normalized_name_idx" ON "mena_products" USING btree ("workspace_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_product_extraction_job_dedupe_key" ON "mena_whatsapp_product_extraction_jobs" USING btree ("workspace_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_extraction_source_workspace_message_key" ON "mena_product_extraction_sources" USING btree ("workspace_id","message_id","suggestion_id","item_index");--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD CONSTRAINT "mena_product_extraction_sender_role_check" CHECK ("mena_product_extraction_suggestions"."sender_role" IN ('merchant', 'customer', 'unknown'));--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD CONSTRAINT "mena_product_extraction_status_check" CHECK ("mena_product_extraction_suggestions"."status" IN ('review', 'draft_created', 'possible_duplicate', 'dismissed', 'superseded', 'update_proposed', 'accepted_update', 'rejected_update'));--> statement-breakpoint
ALTER TABLE "mena_products" ADD CONSTRAINT "mena_products_source_trust_check" CHECK ("mena_products"."source_trust" IN ('merchant', 'customer', 'unknown'));
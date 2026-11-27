DROP INDEX "mena_product_extraction_workspace_source_key";--> statement-breakpoint
DROP INDEX "mena_product_extraction_version_key";--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "group_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "item_index" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD COLUMN "media_state" text DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_products" ADD COLUMN "raw_price_text" text;--> statement-breakpoint
ALTER TABLE "mena_products" ADD COLUMN "price_status" text;--> statement-breakpoint
ALTER TABLE "mena_products" ADD COLUMN "features" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_products" ADD COLUMN "specifications" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_products" ADD COLUMN "accessories" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_product_extraction_jobs" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_product_extraction_jobs" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_product_extraction_jobs" ADD COLUMN "raw_extraction_response" jsonb;--> statement-breakpoint
CREATE INDEX "mena_product_extraction_workspace_source_key_idx" ON "mena_product_extraction_suggestions" USING btree ("workspace_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_extraction_group_version_key" ON "mena_product_extraction_suggestions" USING btree ("workspace_id","group_key","version","item_index");--> statement-breakpoint
CREATE INDEX "mena_product_extraction_group_idx" ON "mena_product_extraction_suggestions" USING btree ("workspace_id","group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_extraction_version_key" ON "mena_product_extraction_suggestions" USING btree ("workspace_id","previous_suggestion_id","version","item_index");--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD CONSTRAINT "mena_product_extraction_suggestion_media_state_check" CHECK ("mena_product_extraction_suggestions"."media_state" IN ('not_applicable', 'included', 'partial', 'pending', 'lost'));--> statement-breakpoint
ALTER TABLE "mena_products" ADD CONSTRAINT "mena_products_price_status_check" CHECK ("mena_products"."price_status" IS NULL OR "mena_products"."price_status" IN ('confirmed', 'unquoted', 'ambiguous', 'missing'));--> statement-breakpoint
ALTER TABLE "mena_whatsapp_product_extraction_jobs" ADD CONSTRAINT "mena_whatsapp_product_extraction_job_reason_check" CHECK ("mena_whatsapp_product_extraction_jobs"."reason_code" IS NULL OR "mena_whatsapp_product_extraction_jobs"."reason_code" IN ('RECORDED', 'SKIPPED_MESSAGE_UNRECEIVABLE', 'SKIPPED_ALREADY_COVERED', 'FAILED_ASSOCIATED_MESSAGE_UNAVAILABLE', 'WAITING_MEDIA', 'FAILED_MEDIA_UNRECOVERABLE', 'RECORDED_MEDIA_PARTIAL', 'WAITING_ASSOCIATION', 'REEXTRACTED_GROUP_GROWN', 'NEEDS_TEXT', 'FAILED_MODEL_RESPONSE', 'PAUSED_AI_QUOTA', 'FAILED_PERSISTENCE'));
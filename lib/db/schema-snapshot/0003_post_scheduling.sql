ALTER TABLE "mena_posts" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mena_workspaces" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
CREATE INDEX "mena_posts_status_scheduled_at_idx" ON "mena_posts" USING btree ("status","scheduled_at");
ALTER TABLE "mena_workspace_deletion_requests" DROP CONSTRAINT "mena_workspace_deletion_requests_status_check";--> statement-breakpoint
ALTER TABLE "mena_workspace_deletion_requests" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mena_workspace_deletion_requests" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "mena_workspace_deletion_requests" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "mena_workspace_deletion_requests_due_idx" ON "mena_workspace_deletion_requests" USING btree ("status","requested_at");--> statement-breakpoint
ALTER TABLE "mena_workspace_deletion_requests" ADD CONSTRAINT "mena_workspace_deletion_requests_status_check" CHECK ("mena_workspace_deletion_requests"."status" IN ('pending', 'completed', 'failed'));
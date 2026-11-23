CREATE TABLE "mena_push_notification_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"event_type" text NOT NULL,
	"recipient_user_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_push_notification_outbox_event_type_check" CHECK ("mena_push_notification_outbox"."event_type" IN ('customer_message', 'publish_failure', 'new_order', 'quota_exhausted')),
	CONSTRAINT "mena_push_notification_outbox_status_check" CHECK ("mena_push_notification_outbox"."status" IN ('queued', 'processing', 'sending', 'sent', 'failed', 'unknown')),
	CONSTRAINT "mena_push_notification_outbox_attempts_check" CHECK ("mena_push_notification_outbox"."attempts" >= 0),
	CONSTRAINT "mena_push_notification_outbox_recipient_count_check" CHECK ("mena_push_notification_outbox"."recipient_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mena_push_notification_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"device_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_push_notification_tokens_platform_check" CHECK ("mena_push_notification_tokens"."platform" IN ('ios', 'android', 'web'))
);
--> statement-breakpoint
ALTER TABLE "mena_push_notification_outbox" ADD CONSTRAINT "mena_push_notification_outbox_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mena_push_notification_outbox_dedupe_key" ON "mena_push_notification_outbox" USING btree ("workspace_id","event_type","dedupe_key");--> statement-breakpoint
CREATE INDEX "mena_push_notification_outbox_queue_idx" ON "mena_push_notification_outbox" USING btree ("status","next_run_at") WHERE "mena_push_notification_outbox"."status" IN ('queued', 'processing', 'sending');--> statement-breakpoint
CREATE INDEX "mena_push_notification_outbox_workspace_time_idx" ON "mena_push_notification_outbox" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_push_notification_tokens_user_token_key" ON "mena_push_notification_tokens" USING btree ("user_id","token");--> statement-breakpoint
CREATE INDEX "mena_push_notification_tokens_enabled_idx" ON "mena_push_notification_tokens" USING btree ("user_id") WHERE "mena_push_notification_tokens"."enabled";
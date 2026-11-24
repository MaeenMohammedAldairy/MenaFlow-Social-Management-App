CREATE TABLE "mena_inbound_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"platform" text,
	"event" text NOT NULL,
	"delivery_confirmed" boolean DEFAULT true NOT NULL,
	"instance_name" text,
	"account_id" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_inbound_webhook_event_platform_check" CHECK ("mena_inbound_webhook_events"."platform" IN ('whatsapp', 'facebook', 'instagram'))
);
--> statement-breakpoint
ALTER TABLE "mena_inbound_webhook_events" ADD CONSTRAINT "mena_inbound_webhook_events_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mena_inbound_webhook_event_workspace_idx" ON "mena_inbound_webhook_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "mena_inbound_webhook_event_instance_idx" ON "mena_inbound_webhook_events" USING btree ("platform","instance_name","created_at");--> statement-breakpoint
CREATE INDEX "mena_inbound_webhook_event_account_idx" ON "mena_inbound_webhook_events" USING btree ("platform","account_id","created_at");--> statement-breakpoint
CREATE INDEX "mena_inbound_webhook_event_created_idx" ON "mena_inbound_webhook_events" USING btree ("created_at");
CREATE TABLE "mena_whatsapp_direct_message_media" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"direct_message_id" text NOT NULL,
	"provider_message_id" text,
	"remote_jid_hash" text NOT NULL,
	"media_index" integer DEFAULT 0 NOT NULL,
	"media_type" text NOT NULL,
	"mime_type" text,
	"file_name" text,
	"size_bytes" integer,
	"source_url" text,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sha256" text,
	"storage_key" text,
	"storage_path" text,
	"storage_provider" text DEFAULT 'local' NOT NULL,
	"thumbnail_path" text,
	"download_status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"download_attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_whatsapp_direct_media_index_check" CHECK ("mena_whatsapp_direct_message_media"."media_index" >= 0),
	CONSTRAINT "mena_whatsapp_direct_media_status_check" CHECK ("mena_whatsapp_direct_message_media"."download_status" IN ('pending', 'stored', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "mena_whatsapp_direct_message_media" ADD CONSTRAINT "mena_whatsapp_direct_message_media_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_direct_message_media" ADD CONSTRAINT "mena_whatsapp_direct_message_media_direct_message_id_mena_whatsapp_direct_messages_id_fk" FOREIGN KEY ("direct_message_id") REFERENCES "public"."mena_whatsapp_direct_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_direct_message_media" ADD CONSTRAINT "mena_whatsapp_direct_media_connection_fk" FOREIGN KEY ("workspace_id","instance_name") REFERENCES "public"."mena_whatsapp_connections"("workspace_id","instance_name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_direct_media_provider_key" ON "mena_whatsapp_direct_message_media" USING btree ("workspace_id","instance_name","remote_jid_hash","provider_message_id","media_index","media_type") WHERE "mena_whatsapp_direct_message_media"."provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_direct_media_message_key" ON "mena_whatsapp_direct_message_media" USING btree ("direct_message_id","media_index","media_type");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_direct_media_conversation_idx" ON "mena_whatsapp_direct_message_media" USING btree ("workspace_id","instance_name","remote_jid_hash","created_at");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_direct_media_retry_idx" ON "mena_whatsapp_direct_message_media" USING btree ("workspace_id","download_status","next_attempt_at");
CREATE TABLE "mena_meta_connections" (
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"page_id" text NOT NULL,
	"page_name" text NOT NULL,
	"encrypted_page_access_token" text NOT NULL,
	"instagram_user_id" text,
	"instagram_username" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_meta_connections_owner_id_unique" UNIQUE("owner_id")
);

CREATE TABLE "mena_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);

CREATE TABLE "mena_whatsapp_connections" (
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"phone_number" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"auto_sync_enabled" boolean DEFAULT true NOT NULL,
	"config_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_whatsapp_connections_owner_id_unique" UNIQUE("owner_id")
);

CREATE TABLE "mena_whatsapp_group_selections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"group_jid" text NOT NULL,
	"group_name" text NOT NULL,
	"selected" boolean DEFAULT true NOT NULL,
	"can_publish" boolean NOT NULL,
	"participant_role" text NOT NULL,
	"announcement_only" boolean NOT NULL,
	"participant_count" integer,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mena_whatsapp_message_media" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"group_jid" text NOT NULL,
	"message_id" text NOT NULL,
	"media_index" integer DEFAULT 0 NOT NULL,
	"media_type" text NOT NULL,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"storage_key" text NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" text,
	"download_status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mena_whatsapp_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"group_jid" text NOT NULL,
	"remote_message_id" text NOT NULL,
	"sender_id" text,
	"sender_name" text,
	"message_type" text NOT NULL,
	"text_body" text,
	"caption" text,
	"media_available" boolean DEFAULT false NOT NULL,
	"media_group_id" text,
	"media_group_is_album" boolean DEFAULT false NOT NULL,
	"media_group_expected_count" integer,
	"media_group_index" integer,
	"media_download_status" text DEFAULT 'not_required' NOT NULL,
	"media_download_error" text,
	"source_media_payload" jsonb,
	"message_status" text DEFAULT 'received' NOT NULL,
	"source" text DEFAULT 'import' NOT NULL,
	"message_timestamp" timestamp with time zone,
	"reply_to_remote_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mena_whatsapp_sync_states" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"group_jid" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_cursor" text,
	"last_message_id" text,
	"last_synced_at" timestamp with time zone,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mena_content_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"message_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mena_content_settings" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"auto_publish_enabled" boolean DEFAULT false NOT NULL,
	"auto_publish_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mena_post_activity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"post_id" text NOT NULL,
	"account_id" text,
	"channel" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE "mena_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_message_id" text,
	"source_group_jid" text,
	"source_message_date" timestamp with time zone,
	"source_text" text,
	"media_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"auto_publish_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"publish_results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mena_workspace_members" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mena_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "mena_meta_connections" ADD CONSTRAINT "mena_meta_connections_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "mena_oauth_states" ADD CONSTRAINT "mena_oauth_states_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "mena_whatsapp_connections" ADD CONSTRAINT "mena_whatsapp_connections_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "mena_whatsapp_group_selections" ADD CONSTRAINT "mena_whatsapp_group_selections_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "mena_whatsapp_group_selections" ADD CONSTRAINT "mena_whatsapp_group_selections_owner_id_mena_whatsapp_connections_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."mena_whatsapp_connections"("owner_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "mena_whatsapp_message_media" ADD CONSTRAINT "mena_whatsapp_message_media_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "mena_whatsapp_messages" ADD CONSTRAINT "mena_whatsapp_messages_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "mena_whatsapp_sync_states" ADD CONSTRAINT "mena_whatsapp_sync_states_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "mena_content_jobs" ADD CONSTRAINT "mena_content_jobs_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "mena_content_settings" ADD CONSTRAINT "mena_content_settings_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "mena_post_activity_events" ADD CONSTRAINT "mena_post_activity_events_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "mena_post_activity_events" ADD CONSTRAINT "mena_post_activity_events_post_id_mena_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."mena_posts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "mena_posts" ADD CONSTRAINT "mena_posts_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "mena_workspace_members" ADD CONSTRAINT "mena_workspace_members_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "mena_meta_connections_workspace_key" ON "mena_meta_connections" USING btree ("workspace_id");
CREATE UNIQUE INDEX "mena_whatsapp_connections_workspace_key" ON "mena_whatsapp_connections" USING btree ("workspace_id");
CREATE UNIQUE INDEX "mena_whatsapp_group_selections_owner_id_group_jid_key" ON "mena_whatsapp_group_selections" USING btree ("owner_id","group_jid");
CREATE INDEX "mena_whatsapp_group_selections_workspace_idx" ON "mena_whatsapp_group_selections" USING btree ("workspace_id","instance_name","group_jid");
CREATE UNIQUE INDEX "mena_whatsapp_message_media_unique_key" ON "mena_whatsapp_message_media" USING btree ("owner_id","instance_name","group_jid","message_id","media_index","media_type");
CREATE INDEX "mena_whatsapp_message_media_workspace_idx" ON "mena_whatsapp_message_media" USING btree ("workspace_id","instance_name","group_jid");
CREATE UNIQUE INDEX "mena_whatsapp_messages_owner_instance_group_remote_id_key" ON "mena_whatsapp_messages" USING btree ("owner_id","instance_name","group_jid","remote_message_id");
CREATE INDEX "mena_whatsapp_messages_workspace_idx" ON "mena_whatsapp_messages" USING btree ("workspace_id","instance_name","group_jid");
CREATE UNIQUE INDEX "mena_whatsapp_sync_states_owner_instance_group_key" ON "mena_whatsapp_sync_states" USING btree ("owner_id","instance_name","group_jid");
CREATE INDEX "mena_whatsapp_sync_states_workspace_idx" ON "mena_whatsapp_sync_states" USING btree ("workspace_id","instance_name","group_jid");
CREATE INDEX "mena_content_jobs_workspace_pending_idx" ON "mena_content_jobs" USING btree ("workspace_id","status","next_run_at");
CREATE UNIQUE INDEX "mena_content_settings_workspace_key" ON "mena_content_settings" USING btree ("workspace_id");
CREATE INDEX "mena_post_activity_account_channel_time_idx" ON "mena_post_activity_events" USING btree ("owner_id","account_id","channel","occurred_at");
CREATE INDEX "mena_post_activity_post_time_idx" ON "mena_post_activity_events" USING btree ("owner_id","post_id","occurred_at");
CREATE INDEX "mena_post_activity_workspace_time_idx" ON "mena_post_activity_events" USING btree ("workspace_id","occurred_at");
CREATE INDEX "mena_posts_workspace_created_idx" ON "mena_posts" USING btree ("workspace_id","created_at");
CREATE UNIQUE INDEX "mena_posts_workspace_id_key" ON "mena_posts" USING btree ("workspace_id","id");
CREATE UNIQUE INDEX "mena_workspace_members_workspace_user_key" ON "mena_workspace_members" USING btree ("workspace_id","user_id");
CREATE INDEX "mena_workspace_members_user_idx" ON "mena_workspace_members" USING btree ("user_id");
CREATE INDEX "mena_workspaces_created_by_idx" ON "mena_workspaces" USING btree ("created_by");

CREATE TABLE "mena_meta_connections" (
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"page_id" text NOT NULL,
	"page_name" text NOT NULL,
	"encrypted_page_access_token" text NOT NULL,
	"instagram_user_id" text,
	"instagram_username" text,
	"granted_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"authorization_verified_at" timestamp with time zone,
	"access_token_expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_meta_connections_page_id_valid_check" CHECK ("mena_meta_connections"."page_id" IS NOT NULL AND btrim("mena_meta_connections"."page_id", chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)) <> '' AND "mena_meta_connections"."page_id" = btrim("mena_meta_connections"."page_id", chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))),
	CONSTRAINT "mena_meta_connections_instagram_user_id_valid_check" CHECK ("mena_meta_connections"."instagram_user_id" IS NULL OR (btrim("mena_meta_connections"."instagram_user_id", chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)) <> '' AND "mena_meta_connections"."instagram_user_id" = btrim("mena_meta_connections"."instagram_user_id", chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))))
);
--> statement-breakpoint
CREATE TABLE "mena_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"requested_integration" text DEFAULT 'facebook' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mena_whatsapp_auto_reply_events" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"remote_message_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"reply_message_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "mena_whatsapp_auto_reply_events_status_check" CHECK ("mena_whatsapp_auto_reply_events"."status" IN ('queued', 'processing', 'sending', 'sent', 'failed', 'unknown')),
	CONSTRAINT "mena_whatsapp_auto_reply_events_attempts_check" CHECK ("mena_whatsapp_auto_reply_events"."attempts" >= 0 AND "mena_whatsapp_auto_reply_events"."attempts" <= 3)
);
--> statement-breakpoint
CREATE TABLE "mena_whatsapp_connections" (
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"phone_number" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"auto_sync_enabled" boolean DEFAULT true NOT NULL,
	"sync_messages_enabled" boolean DEFAULT true NOT NULL,
	"sync_images_enabled" boolean DEFAULT true NOT NULL,
	"sync_videos_enabled" boolean DEFAULT true NOT NULL,
	"auto_reply_enabled" boolean DEFAULT false NOT NULL,
	"auto_reply_language" text DEFAULT 'ar' NOT NULL,
	"auto_reply_tone" text DEFAULT 'friendly_professional' NOT NULL,
	"auto_reply_instructions" text,
	"auto_reply_tested_hash" text,
	"config_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_whatsapp_connections_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
CREATE TABLE "mena_whatsapp_direct_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"remote_jid_hash" text NOT NULL,
	"encrypted_remote_jid" text NOT NULL,
	"provider_message_id" text,
	"client_request_id" text,
	"direction" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error_code" text,
	"encrypted_text_body" text NOT NULL,
	"message_timestamp" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_whatsapp_direct_messages_direction_check" CHECK ("mena_whatsapp_direct_messages"."direction" IN ('inbound', 'outbound')),
	CONSTRAINT "mena_whatsapp_direct_messages_status_check" CHECK ("mena_whatsapp_direct_messages"."status" IN ('received', 'sending', 'sent', 'failed', 'unknown')),
	CONSTRAINT "mena_whatsapp_direct_messages_text_length_check" CHECK (length("mena_whatsapp_direct_messages"."encrypted_text_body") <= 6000)
);
--> statement-breakpoint
CREATE TABLE "mena_whatsapp_group_jids" (
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"group_jid" text NOT NULL,
	"group_id" text NOT NULL,
	"kind" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_whatsapp_group_jids_kind_check" CHECK ("mena_whatsapp_group_jids"."kind" IN ('community', 'announcement', 'group', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "mena_whatsapp_group_selections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"group_jid" text NOT NULL,
	"group_id" text,
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
--> statement-breakpoint
CREATE TABLE "mena_whatsapp_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"kind" text DEFAULT 'unknown' NOT NULL,
	"name" text NOT NULL,
	"parent_group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_whatsapp_groups_kind_check" CHECK ("mena_whatsapp_groups"."kind" IN ('community', 'announcement', 'group', 'unknown')),
	CONSTRAINT "mena_whatsapp_groups_not_self_parent_check" CHECK ("mena_whatsapp_groups"."parent_group_id" IS NULL OR "mena_whatsapp_groups"."parent_group_id" <> "mena_whatsapp_groups"."id")
);
--> statement-breakpoint
CREATE TABLE "mena_whatsapp_message_media" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"group_jid" text NOT NULL,
	"group_id" text,
	"message_id" text NOT NULL,
	"media_index" integer DEFAULT 0 NOT NULL,
	"media_type" text NOT NULL,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"storage_key" text NOT NULL,
	"storage_path" text NOT NULL,
	"storage_provider" text DEFAULT 'local' NOT NULL,
	"thumbnail_path" text,
	"sha256" text,
	"download_status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"download_attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mena_whatsapp_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"group_jid" text NOT NULL,
	"group_id" text,
	"provider_remote_jid" text,
	"provider_remote_jid_alt" text,
	"remote_message_id" text NOT NULL,
	"sender_id" text,
	"sender_name" text,
	"message_type" text NOT NULL,
	"text_body" text,
	"caption" text,
	"media_available" boolean DEFAULT false NOT NULL,
	"media_group_id" text,
	"media_group_is_album" boolean DEFAULT false NOT NULL,
	"media_group_source" text,
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_whatsapp_messages_media_group_source_check" CHECK ("mena_whatsapp_messages"."media_group_source" IS NULL OR "mena_whatsapp_messages"."media_group_source" IN ('protocol_association', 'provider_album_container'))
);
--> statement-breakpoint
CREATE TABLE "mena_whatsapp_sync_states" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"group_jid" text NOT NULL,
	"group_id" text,
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
--> statement-breakpoint
CREATE TABLE "mena_whatsapp_content_associations" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"group_id" text NOT NULL,
	"left_message_id" text NOT NULL,
	"right_message_id" text NOT NULL,
	"decision" text NOT NULL,
	"content_bundle_id" text,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_whatsapp_content_associations_pair_order_check" CHECK ("mena_whatsapp_content_associations"."left_message_id" < "mena_whatsapp_content_associations"."right_message_id"),
	CONSTRAINT "mena_whatsapp_content_associations_decision_check" CHECK (("mena_whatsapp_content_associations"."decision" = 'accepted' AND "mena_whatsapp_content_associations"."content_bundle_id" IS NOT NULL) OR ("mena_whatsapp_content_associations"."decision" = 'rejected' AND "mena_whatsapp_content_associations"."content_bundle_id" IS NULL))
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "mena_content_settings" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"auto_publish_enabled" boolean DEFAULT false NOT NULL,
	"auto_publish_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "mena_meta_auto_reply_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"inbox_item_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "mena_meta_auto_reply_jobs_status_check" CHECK ("mena_meta_auto_reply_jobs"."status" IN ('queued', 'processing', 'sending', 'sent', 'failed', 'skipped', 'unknown')),
	CONSTRAINT "mena_meta_auto_reply_jobs_attempts_check" CHECK ("mena_meta_auto_reply_jobs"."attempts" >= 0 AND "mena_meta_auto_reply_jobs"."attempts" <= 3)
);
--> statement-breakpoint
CREATE TABLE "mena_meta_auto_reply_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"facebook_messages_enabled" boolean DEFAULT false NOT NULL,
	"facebook_comments_enabled" boolean DEFAULT false NOT NULL,
	"instagram_messages_enabled" boolean DEFAULT false NOT NULL,
	"instagram_comments_enabled" boolean DEFAULT false NOT NULL,
	"language" text DEFAULT 'ar' NOT NULL,
	"tone" text DEFAULT 'friendly_professional' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_meta_auto_reply_settings_language_check" CHECK ("mena_meta_auto_reply_settings"."language" IN ('ar', 'match_customer')),
	CONSTRAINT "mena_meta_auto_reply_settings_tone_check" CHECK ("mena_meta_auto_reply_settings"."tone" IN ('friendly_professional', 'concise', 'formal')),
	CONSTRAINT "mena_meta_auto_reply_settings_instructions_length_check" CHECK (length("mena_meta_auto_reply_settings"."instructions") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "mena_meta_inbox_items" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"parent_id" text,
	"actor_id" text,
	"actor_name" text,
	"text" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reply_text" text,
	"reply_external_id" text,
	"replied_at" timestamp with time zone,
	"reply_status" text,
	"reply_attempt_started_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_meta_inbox_platform_check" CHECK ("mena_meta_inbox_items"."platform" IN ('facebook', 'instagram')),
	CONSTRAINT "mena_meta_inbox_kind_check" CHECK ("mena_meta_inbox_items"."kind" IN ('message', 'comment'))
);
--> statement-breakpoint
CREATE TABLE "mena_meta_webhook_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"subscribed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subscribed_at" timestamp with time zone,
	"last_error_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_meta_webhook_subscriptions_platform_check" CHECK ("mena_meta_webhook_subscriptions"."platform" IN ('facebook', 'instagram'))
);
--> statement-breakpoint
CREATE TABLE "mena_meta_order_intakes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"platform" text NOT NULL,
	"conversation_id" text NOT NULL,
	"actor_id" text,
	"status" text DEFAULT 'collecting' NOT NULL,
	"awaiting_field" text,
	"product_id" text,
	"quantity" integer,
	"customer_name" text,
	"customer_phone" text,
	"delivery_address" text,
	"desired_delivery_time" text,
	"last_inbox_item_id" text,
	"draft_order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_meta_order_intakes_platform_check" CHECK ("mena_meta_order_intakes"."platform" IN ('facebook', 'instagram')),
	CONSTRAINT "mena_meta_order_intakes_status_check" CHECK ("mena_meta_order_intakes"."status" IN ('collecting', 'creating', 'created', 'cancelled')),
	CONSTRAINT "mena_meta_order_intakes_quantity_check" CHECK ("mena_meta_order_intakes"."quantity" IS NULL OR "mena_meta_order_intakes"."quantity" BETWEEN 1 AND 999),
	CONSTRAINT "mena_meta_order_intakes_awaiting_field_check" CHECK ("mena_meta_order_intakes"."awaiting_field" IS NULL OR "mena_meta_order_intakes"."awaiting_field" IN ('product', 'quantity', 'name', 'phone', 'address', 'delivery_time'))
);
--> statement-breakpoint
CREATE TABLE "mena_workspace_deletion_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_workspace_deletion_requests_status_check" CHECK ("mena_workspace_deletion_requests"."status" = 'pending')
);
--> statement-breakpoint
CREATE TABLE "mena_workspace_members" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mena_workspace_onboarding" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"current_step" integer DEFAULT 3 NOT NULL,
	"completed" boolean DEFAULT true NOT NULL,
	"social_accounts_completed" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_workspace_onboarding_step_check" CHECK ("mena_workspace_onboarding"."current_step" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "mena_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mena_inventory_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"order_id" text,
	"actor_id" text NOT NULL,
	"type" text NOT NULL,
	"stock_delta" integer DEFAULT 0 NOT NULL,
	"reserved_delta" integer DEFAULT 0 NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_inventory_movements_type_check" CHECK ("mena_inventory_movements"."type" IN ('opening_balance', 'adjustment', 'reservation', 'release', 'shipment')),
	CONSTRAINT "mena_inventory_movements_delta_check" CHECK ("mena_inventory_movements"."stock_delta" <> 0 OR "mena_inventory_movements"."reserved_delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "mena_product_extraction_sources" (
	"workspace_id" text NOT NULL,
	"suggestion_id" text,
	"message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mena_product_extraction_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"source_key" text NOT NULL,
	"classification" text DEFAULT 'product' NOT NULL,
	"extracted_data" jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_model" text NOT NULL,
	"status" text DEFAULT 'review' NOT NULL,
	"field_review" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"product_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_product_extraction_status_check" CHECK ("mena_product_extraction_suggestions"."status" IN ('review', 'draft_created', 'possible_duplicate', 'dismissed')),
	CONSTRAINT "mena_product_extraction_classification_check" CHECK ("mena_product_extraction_suggestions"."classification" IN ('product', 'not_product'))
);
--> statement-breakpoint
CREATE TABLE "mena_product_posts" (
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"post_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mena_product_publication_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"request_key" text NOT NULL,
	"product_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"post_id" text,
	"permalink" text,
	"last_error" text,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_product_publication_job_channel_check" CHECK ("mena_product_publication_jobs"."channel" IN ('facebook', 'instagram')),
	CONSTRAINT "mena_product_publication_job_status_check" CHECK ("mena_product_publication_jobs"."status" IN ('queued', 'processing', 'published', 'failed', 'action_required'))
);
--> statement-breakpoint
CREATE TABLE "mena_products" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" numeric(12, 2),
	"currency" text,
	"availability" text DEFAULT 'unknown' NOT NULL,
	"inventory_tracked" boolean DEFAULT false NOT NULL,
	"stock_on_hand" integer DEFAULT 0 NOT NULL,
	"stock_reserved" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"media_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_products_availability_check" CHECK ("mena_products"."availability" IN ('unknown', 'in_stock', 'out_of_stock', 'preorder')),
	CONSTRAINT "mena_products_status_check" CHECK ("mena_products"."status" IN ('draft', 'active', 'archived')),
	CONSTRAINT "mena_products_inventory_check" CHECK ("mena_products"."stock_on_hand" >= 0 AND "mena_products"."stock_reserved" >= 0 AND "mena_products"."stock_reserved" <= "mena_products"."stock_on_hand" AND "mena_products"."low_stock_threshold" >= 0),
	CONSTRAINT "mena_products_price_check" CHECK ("mena_products"."price" IS NULL OR "mena_products"."price" >= 0),
	CONSTRAINT "mena_products_currency_check" CHECK ("mena_products"."currency" IS NULL OR "mena_products"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "mena_products_price_currency_check" CHECK ("mena_products"."price" IS NULL OR "mena_products"."currency" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "mena_whatsapp_product_extraction_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"message_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stage" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_whatsapp_product_extraction_job_status_check" CHECK ("mena_whatsapp_product_extraction_jobs"."status" IN ('pending', 'processing', 'waiting_media', 'waiting_association', 'complete', 'review', 'failed')),
	CONSTRAINT "mena_whatsapp_product_extraction_job_stage_check" CHECK ("mena_whatsapp_product_extraction_jobs"."stage" IN ('received', 'media', 'association', 'extraction', 'persistence'))
);
--> statement-breakpoint
CREATE TABLE "mena_workspace_subscription_usage" (
	"workspace_id" text NOT NULL,
	"period_key" text NOT NULL,
	"ai_generations" integer DEFAULT 0 NOT NULL,
	"posts_created" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_workspace_subscription_usage_nonnegative_check" CHECK ("mena_workspace_subscription_usage"."ai_generations" >= 0 AND "mena_workspace_subscription_usage"."posts_created" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mena_workspace_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"payment_provider" text,
	"provider_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_workspace_subscriptions_plan_check" CHECK ("mena_workspace_subscriptions"."plan_id" IN ('free', 'starter', 'growth')),
	CONSTRAINT "mena_workspace_subscriptions_status_check" CHECK ("mena_workspace_subscriptions"."status" IN ('trialing', 'active', 'canceled', 'past_due'))
);
--> statement-breakpoint
CREATE TABLE "mena_order_delivery_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"order_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_order_delivery_events_from_status_check" CHECK ("mena_order_delivery_events"."from_status" IS NULL OR "mena_order_delivery_events"."from_status" IN ('pending', 'ready', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned')),
	CONSTRAINT "mena_order_delivery_events_to_status_check" CHECK ("mena_order_delivery_events"."to_status" IN ('pending', 'ready', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned'))
);
--> statement-breakpoint
CREATE TABLE "mena_order_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"order_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_order_events_from_status_check" CHECK ("mena_order_events"."from_status" IS NULL OR "mena_order_events"."from_status" IN ('draft', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled')),
	CONSTRAINT "mena_order_events_to_status_check" CHECK ("mena_order_events"."to_status" IN ('draft', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "mena_order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text,
	"product_name" text NOT NULL,
	"product_sku" text,
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_order_items_quantity_check" CHECK ("mena_order_items"."quantity" > 0),
	CONSTRAINT "mena_order_items_unit_price_check" CHECK ("mena_order_items"."unit_price" >= 0 AND "mena_order_items"."line_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mena_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"owner_id" text NOT NULL,
	"client_request_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"delivery_address" text,
	"notes" text DEFAULT '' NOT NULL,
	"source_meta_inbox_item_id" text,
	"source_platform" text,
	"source_conversation_id" text,
	"source_whatsapp_instance_name" text,
	"meta_confirmation_status" text DEFAULT 'not_required' NOT NULL,
	"meta_confirmation_attempts" integer DEFAULT 0 NOT NULL,
	"meta_confirmation_next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta_confirmation_lease_expires_at" timestamp with time zone,
	"meta_confirmation_sent_at" timestamp with time zone,
	"meta_confirmation_error" text,
	"whatsapp_confirmation_status" text DEFAULT 'not_required' NOT NULL,
	"whatsapp_confirmation_attempts" integer DEFAULT 0 NOT NULL,
	"whatsapp_confirmation_next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"whatsapp_confirmation_lease_expires_at" timestamp with time zone,
	"whatsapp_confirmation_sent_at" timestamp with time zone,
	"whatsapp_confirmation_error" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"inventory_reserved" boolean DEFAULT false NOT NULL,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"delivery_provider" text,
	"tracking_number" text,
	"delivery_fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"collection_status" text DEFAULT 'not_collected' NOT NULL,
	"collected_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"delivered_at" timestamp with time zone,
	"currency" text NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_orders_meta_confirmation_status_check" CHECK ("mena_orders"."meta_confirmation_status" IN ('not_required', 'queued', 'processing', 'sending', 'sent', 'manual_followup', 'failed', 'unknown')),
	CONSTRAINT "mena_orders_meta_confirmation_attempts_check" CHECK ("mena_orders"."meta_confirmation_attempts" >= 0),
	CONSTRAINT "mena_orders_whatsapp_confirmation_status_check" CHECK ("mena_orders"."whatsapp_confirmation_status" IN ('not_required', 'queued', 'processing', 'sending', 'sent', 'failed', 'unknown', 'manual_followup')),
	CONSTRAINT "mena_orders_whatsapp_confirmation_attempts_check" CHECK ("mena_orders"."whatsapp_confirmation_attempts" BETWEEN 0 AND 3),
	CONSTRAINT "mena_orders_status_check" CHECK ("mena_orders"."status" IN ('draft', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled')),
	CONSTRAINT "mena_orders_delivery_status_check" CHECK ("mena_orders"."delivery_status" IN ('pending', 'ready', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned')),
	CONSTRAINT "mena_orders_collection_status_check" CHECK ("mena_orders"."collection_status" IN ('not_collected', 'collected', 'remitted')),
	CONSTRAINT "mena_orders_delivery_money_check" CHECK ("mena_orders"."delivery_fee" >= 0 AND "mena_orders"."collected_amount" >= 0),
	CONSTRAINT "mena_orders_total_check" CHECK ("mena_orders"."total" >= 0),
	CONSTRAINT "mena_orders_currency_check" CHECK ("mena_orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "mena_orders_source_platform_check" CHECK ("mena_orders"."source_platform" IS NULL OR "mena_orders"."source_platform" IN ('facebook', 'instagram', 'whatsapp')),
	CONSTRAINT "mena_orders_whatsapp_source_check" CHECK ("mena_orders"."source_platform" <> 'whatsapp' OR ("mena_orders"."source_conversation_id" IS NOT NULL AND "mena_orders"."source_whatsapp_instance_name" IS NOT NULL AND "mena_orders"."source_meta_inbox_item_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "mena_whatsapp_order_intakes" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"remote_jid_hash" text NOT NULL,
	"status" text DEFAULT 'collecting' NOT NULL,
	"awaiting_field" text,
	"product_id" text,
	"quantity" integer,
	"encrypted_customer_data" text NOT NULL,
	"client_request_id" text NOT NULL,
	"last_provider_message_id" text,
	"draft_order_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mena_whatsapp_order_intakes_status_check" CHECK ("mena_whatsapp_order_intakes"."status" IN ('collecting', 'creating', 'created', 'cancelled')),
	CONSTRAINT "mena_whatsapp_order_intakes_awaiting_field_check" CHECK ("mena_whatsapp_order_intakes"."awaiting_field" IS NULL OR "mena_whatsapp_order_intakes"."awaiting_field" IN ('product', 'quantity', 'name', 'phone', 'address')),
	CONSTRAINT "mena_whatsapp_order_intakes_quantity_check" CHECK ("mena_whatsapp_order_intakes"."quantity" IS NULL OR "mena_whatsapp_order_intakes"."quantity" BETWEEN 1 AND 999)
);
--> statement-breakpoint
ALTER TABLE "mena_meta_connections" ADD CONSTRAINT "mena_meta_connections_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_oauth_states" ADD CONSTRAINT "mena_oauth_states_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_auto_reply_events" ADD CONSTRAINT "mena_whatsapp_auto_reply_events_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_connections" ADD CONSTRAINT "mena_whatsapp_connections_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_direct_messages" ADD CONSTRAINT "mena_whatsapp_direct_messages_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_direct_messages" ADD CONSTRAINT "mena_whatsapp_direct_messages_connection_fk" FOREIGN KEY ("workspace_id","instance_name") REFERENCES "public"."mena_whatsapp_connections"("workspace_id","instance_name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_group_jids" ADD CONSTRAINT "mena_whatsapp_group_jids_group_fk" FOREIGN KEY ("group_id","workspace_id","instance_name") REFERENCES "public"."mena_whatsapp_groups"("id","workspace_id","instance_name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_group_selections" ADD CONSTRAINT "mena_whatsapp_group_selections_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_group_selections" ADD CONSTRAINT "mena_whatsapp_group_selections_owner_id_mena_whatsapp_connections_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."mena_whatsapp_connections"("owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_group_selections" ADD CONSTRAINT "mena_whatsapp_group_selections_group_fk" FOREIGN KEY ("group_id","workspace_id","instance_name") REFERENCES "public"."mena_whatsapp_groups"("id","workspace_id","instance_name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_groups" ADD CONSTRAINT "mena_whatsapp_groups_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_groups" ADD CONSTRAINT "mena_whatsapp_groups_connection_fk" FOREIGN KEY ("workspace_id","instance_name") REFERENCES "public"."mena_whatsapp_connections"("workspace_id","instance_name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_groups" ADD CONSTRAINT "mena_whatsapp_groups_parent_fk" FOREIGN KEY ("parent_group_id","workspace_id","instance_name") REFERENCES "public"."mena_whatsapp_groups"("id","workspace_id","instance_name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_message_media" ADD CONSTRAINT "mena_whatsapp_message_media_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_message_media" ADD CONSTRAINT "mena_whatsapp_message_media_group_fk" FOREIGN KEY ("group_id","workspace_id","instance_name") REFERENCES "public"."mena_whatsapp_groups"("id","workspace_id","instance_name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_messages" ADD CONSTRAINT "mena_whatsapp_messages_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_messages" ADD CONSTRAINT "mena_whatsapp_messages_group_fk" FOREIGN KEY ("group_id","workspace_id","instance_name") REFERENCES "public"."mena_whatsapp_groups"("id","workspace_id","instance_name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_sync_states" ADD CONSTRAINT "mena_whatsapp_sync_states_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_sync_states" ADD CONSTRAINT "mena_whatsapp_sync_states_group_fk" FOREIGN KEY ("group_id","workspace_id","instance_name") REFERENCES "public"."mena_whatsapp_groups"("id","workspace_id","instance_name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_content_associations" ADD CONSTRAINT "mena_whatsapp_content_associations_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_content_associations" ADD CONSTRAINT "mena_whatsapp_content_associations_left_message_id_mena_whatsapp_messages_id_fk" FOREIGN KEY ("left_message_id") REFERENCES "public"."mena_whatsapp_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_content_associations" ADD CONSTRAINT "mena_whatsapp_content_associations_right_message_id_mena_whatsapp_messages_id_fk" FOREIGN KEY ("right_message_id") REFERENCES "public"."mena_whatsapp_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_content_associations" ADD CONSTRAINT "mena_whatsapp_content_associations_group_fk" FOREIGN KEY ("group_id","workspace_id","instance_name") REFERENCES "public"."mena_whatsapp_groups"("id","workspace_id","instance_name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_content_jobs" ADD CONSTRAINT "mena_content_jobs_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_content_settings" ADD CONSTRAINT "mena_content_settings_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_post_activity_events" ADD CONSTRAINT "mena_post_activity_events_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_post_activity_events" ADD CONSTRAINT "mena_post_activity_events_post_id_mena_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."mena_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_posts" ADD CONSTRAINT "mena_posts_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_meta_auto_reply_jobs" ADD CONSTRAINT "mena_meta_auto_reply_jobs_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_meta_auto_reply_jobs" ADD CONSTRAINT "mena_meta_auto_reply_jobs_inbox_item_id_mena_meta_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."mena_meta_inbox_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_meta_auto_reply_settings" ADD CONSTRAINT "mena_meta_auto_reply_settings_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_meta_inbox_items" ADD CONSTRAINT "mena_meta_inbox_items_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_meta_webhook_subscriptions" ADD CONSTRAINT "mena_meta_webhook_subscriptions_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_meta_order_intakes" ADD CONSTRAINT "mena_meta_order_intakes_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_workspace_deletion_requests" ADD CONSTRAINT "mena_workspace_deletion_requests_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_workspace_members" ADD CONSTRAINT "mena_workspace_members_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_workspace_onboarding" ADD CONSTRAINT "mena_workspace_onboarding_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_inventory_movements" ADD CONSTRAINT "mena_inventory_movements_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_inventory_movements" ADD CONSTRAINT "mena_inventory_movements_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."mena_products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_sources" ADD CONSTRAINT "mena_product_extraction_sources_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_sources" ADD CONSTRAINT "mena_product_extraction_sources_message_id_mena_whatsapp_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mena_whatsapp_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_sources" ADD CONSTRAINT "mena_product_extraction_source_suggestion_fk" FOREIGN KEY ("workspace_id","suggestion_id") REFERENCES "public"."mena_product_extraction_suggestions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD CONSTRAINT "mena_product_extraction_suggestions_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_extraction_suggestions" ADD CONSTRAINT "mena_product_extraction_suggestions_product_id_mena_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."mena_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_posts" ADD CONSTRAINT "mena_product_posts_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_posts" ADD CONSTRAINT "mena_product_posts_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."mena_products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_posts" ADD CONSTRAINT "mena_product_posts_post_fk" FOREIGN KEY ("workspace_id","post_id") REFERENCES "public"."mena_posts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_publication_jobs" ADD CONSTRAINT "mena_product_publication_jobs_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_publication_jobs" ADD CONSTRAINT "mena_product_publication_jobs_post_id_mena_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."mena_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_product_publication_jobs" ADD CONSTRAINT "mena_product_publication_job_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."mena_products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_products" ADD CONSTRAINT "mena_products_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_product_extraction_jobs" ADD CONSTRAINT "mena_whatsapp_product_extraction_jobs_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_product_extraction_jobs" ADD CONSTRAINT "mena_whatsapp_product_extraction_jobs_message_id_mena_whatsapp_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mena_whatsapp_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_workspace_subscription_usage" ADD CONSTRAINT "mena_workspace_subscription_usage_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_workspace_subscriptions" ADD CONSTRAINT "mena_workspace_subscriptions_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_order_delivery_events" ADD CONSTRAINT "mena_order_delivery_events_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_order_delivery_events" ADD CONSTRAINT "mena_order_delivery_events_order_fk" FOREIGN KEY ("workspace_id","order_id") REFERENCES "public"."mena_orders"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_order_events" ADD CONSTRAINT "mena_order_events_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_order_events" ADD CONSTRAINT "mena_order_events_order_fk" FOREIGN KEY ("workspace_id","order_id") REFERENCES "public"."mena_orders"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_order_items" ADD CONSTRAINT "mena_order_items_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_order_items" ADD CONSTRAINT "mena_order_items_order_fk" FOREIGN KEY ("workspace_id","order_id") REFERENCES "public"."mena_orders"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_order_items" ADD CONSTRAINT "mena_order_items_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."mena_products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_orders" ADD CONSTRAINT "mena_orders_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_order_intakes" ADD CONSTRAINT "mena_whatsapp_order_intakes_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_order_intakes" ADD CONSTRAINT "mena_whatsapp_order_intakes_connection_fk" FOREIGN KEY ("workspace_id","instance_name") REFERENCES "public"."mena_whatsapp_connections"("workspace_id","instance_name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mena_whatsapp_order_intakes" ADD CONSTRAINT "mena_whatsapp_order_intakes_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."mena_products"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mena_meta_connections_workspace_key" ON "mena_meta_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_meta_connections_page_id_key" ON "mena_meta_connections" USING btree (btrim("page_id", chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)));--> statement-breakpoint
CREATE UNIQUE INDEX "mena_meta_connections_instagram_user_id_key" ON "mena_meta_connections" USING btree (btrim("instagram_user_id", chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))) WHERE "mena_meta_connections"."instagram_user_id" IS NOT NULL AND btrim("mena_meta_connections"."instagram_user_id", chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)) <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_auto_reply_events_message_key" ON "mena_whatsapp_auto_reply_events" USING btree ("workspace_id","instance_name","remote_message_id");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_auto_reply_events_pending_idx" ON "mena_whatsapp_auto_reply_events" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_auto_reply_events_lease_idx" ON "mena_whatsapp_auto_reply_events" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_connections_workspace_key" ON "mena_whatsapp_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_connections_workspace_instance_key" ON "mena_whatsapp_connections" USING btree ("workspace_id","instance_name");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_direct_messages_provider_id_key" ON "mena_whatsapp_direct_messages" USING btree ("workspace_id","instance_name","remote_jid_hash","provider_message_id") WHERE "mena_whatsapp_direct_messages"."provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_direct_messages_client_request_key" ON "mena_whatsapp_direct_messages" USING btree ("workspace_id","instance_name","client_request_id") WHERE "mena_whatsapp_direct_messages"."client_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mena_whatsapp_direct_messages_conversation_idx" ON "mena_whatsapp_direct_messages" USING btree ("workspace_id","instance_name","remote_jid_hash","message_timestamp");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_direct_messages_expiry_idx" ON "mena_whatsapp_direct_messages" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_group_jids_workspace_instance_jid_key" ON "mena_whatsapp_group_jids" USING btree ("workspace_id","instance_name","group_jid");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_group_jids_group_idx" ON "mena_whatsapp_group_jids" USING btree ("workspace_id","instance_name","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_group_selections_owner_id_group_jid_key" ON "mena_whatsapp_group_selections" USING btree ("owner_id","group_jid");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_group_selections_workspace_instance_group_id_key" ON "mena_whatsapp_group_selections" USING btree ("workspace_id","instance_name","group_id");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_group_selections_workspace_idx" ON "mena_whatsapp_group_selections" USING btree ("workspace_id","instance_name","group_jid");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_groups_id_workspace_instance_key" ON "mena_whatsapp_groups" USING btree ("id","workspace_id","instance_name");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_groups_workspace_instance_parent_idx" ON "mena_whatsapp_groups" USING btree ("workspace_id","instance_name","parent_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_message_media_unique_key" ON "mena_whatsapp_message_media" USING btree ("owner_id","instance_name","group_jid","message_id","media_index","media_type");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_message_media_group_id_unique_key" ON "mena_whatsapp_message_media" USING btree ("owner_id","instance_name","group_id","message_id","media_index","media_type");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_message_media_workspace_idx" ON "mena_whatsapp_message_media" USING btree ("workspace_id","instance_name","group_jid");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_message_media_retry_idx" ON "mena_whatsapp_message_media" USING btree ("workspace_id","download_status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_message_media_workspace_sha256_idx" ON "mena_whatsapp_message_media" USING btree ("workspace_id","sha256","download_status");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_messages_owner_instance_group_remote_id_key" ON "mena_whatsapp_messages" USING btree ("owner_id","instance_name","group_jid","remote_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_messages_owner_instance_group_id_remote_id_key" ON "mena_whatsapp_messages" USING btree ("owner_id","instance_name","group_id","remote_message_id");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_messages_workspace_idx" ON "mena_whatsapp_messages" USING btree ("workspace_id","instance_name","group_jid");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_sync_states_owner_instance_group_key" ON "mena_whatsapp_sync_states" USING btree ("owner_id","instance_name","group_jid");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_sync_states_workspace_instance_group_id_key" ON "mena_whatsapp_sync_states" USING btree ("workspace_id","instance_name","group_id");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_sync_states_workspace_idx" ON "mena_whatsapp_sync_states" USING btree ("workspace_id","instance_name","group_jid");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_content_associations_pair_key" ON "mena_whatsapp_content_associations" USING btree ("workspace_id","instance_name","group_id","left_message_id","right_message_id");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_content_associations_bundle_idx" ON "mena_whatsapp_content_associations" USING btree ("workspace_id","instance_name","group_id","content_bundle_id");--> statement-breakpoint
CREATE INDEX "mena_content_jobs_workspace_pending_idx" ON "mena_content_jobs" USING btree ("workspace_id","status","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_content_settings_workspace_key" ON "mena_content_settings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "mena_post_activity_account_channel_time_idx" ON "mena_post_activity_events" USING btree ("owner_id","account_id","channel","occurred_at");--> statement-breakpoint
CREATE INDEX "mena_post_activity_post_time_idx" ON "mena_post_activity_events" USING btree ("owner_id","post_id","occurred_at");--> statement-breakpoint
CREATE INDEX "mena_post_activity_workspace_time_idx" ON "mena_post_activity_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "mena_posts_workspace_created_idx" ON "mena_posts" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_posts_workspace_id_key" ON "mena_posts" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_meta_auto_reply_jobs_workspace_item_key" ON "mena_meta_auto_reply_jobs" USING btree ("workspace_id","inbox_item_id");--> statement-breakpoint
CREATE INDEX "mena_meta_auto_reply_jobs_pending_idx" ON "mena_meta_auto_reply_jobs" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "mena_meta_auto_reply_jobs_lease_idx" ON "mena_meta_auto_reply_jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_meta_auto_reply_settings_workspace_key" ON "mena_meta_auto_reply_settings" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_meta_inbox_workspace_external_key" ON "mena_meta_inbox_items" USING btree ("workspace_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "mena_meta_inbox_workspace_time_idx" ON "mena_meta_inbox_items" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_meta_webhook_subscriptions_workspace_platform_key" ON "mena_meta_webhook_subscriptions" USING btree ("workspace_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_meta_order_intakes_conversation_key" ON "mena_meta_order_intakes" USING btree ("workspace_id","platform","conversation_id");--> statement-breakpoint
CREATE INDEX "mena_meta_order_intakes_workspace_status_idx" ON "mena_meta_order_intakes" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_workspace_deletion_requests_workspace_key" ON "mena_workspace_deletion_requests" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_workspace_members_workspace_user_key" ON "mena_workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "mena_workspace_members_user_idx" ON "mena_workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_workspace_onboarding_workspace_user_key" ON "mena_workspace_onboarding" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "mena_workspace_onboarding_user_idx" ON "mena_workspace_onboarding" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mena_workspaces_created_by_idx" ON "mena_workspaces" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "mena_inventory_movements_workspace_product_created_idx" ON "mena_inventory_movements" USING btree ("workspace_id","product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_extraction_source_workspace_message_key" ON "mena_product_extraction_sources" USING btree ("workspace_id","message_id");--> statement-breakpoint
CREATE INDEX "mena_product_extraction_source_suggestion_idx" ON "mena_product_extraction_sources" USING btree ("workspace_id","suggestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_extraction_workspace_id_key" ON "mena_product_extraction_suggestions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_extraction_workspace_source_key" ON "mena_product_extraction_suggestions" USING btree ("workspace_id","source_key");--> statement-breakpoint
CREATE INDEX "mena_product_extraction_workspace_status_created_idx" ON "mena_product_extraction_suggestions" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_posts_workspace_product_post_key" ON "mena_product_posts" USING btree ("workspace_id","product_id","post_id");--> statement-breakpoint
CREATE INDEX "mena_product_posts_workspace_post_idx" ON "mena_product_posts" USING btree ("workspace_id","post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_publication_job_id_workspace_key" ON "mena_product_publication_jobs" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_product_publication_job_request_product_channel_key" ON "mena_product_publication_jobs" USING btree ("workspace_id","request_key","product_id","channel","account_id");--> statement-breakpoint
CREATE INDEX "mena_product_publication_job_queue_idx" ON "mena_product_publication_jobs" USING btree ("status","next_run_at","created_at");--> statement-breakpoint
CREATE INDEX "mena_product_publication_job_product_idx" ON "mena_product_publication_jobs" USING btree ("workspace_id","product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_products_workspace_id_key" ON "mena_products" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_products_workspace_sku_key" ON "mena_products" USING btree ("workspace_id","sku") WHERE "mena_products"."sku" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mena_products_workspace_status_updated_idx" ON "mena_products" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_product_extraction_job_workspace_id_key" ON "mena_whatsapp_product_extraction_jobs" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_product_extraction_job_message_key" ON "mena_whatsapp_product_extraction_jobs" USING btree ("workspace_id","message_id");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_product_extraction_job_queue_idx" ON "mena_whatsapp_product_extraction_jobs" USING btree ("status","next_run_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_workspace_subscription_usage_period_key" ON "mena_workspace_subscription_usage" USING btree ("workspace_id","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_workspace_subscriptions_workspace_key" ON "mena_workspace_subscriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "mena_workspace_subscriptions_status_idx" ON "mena_workspace_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mena_order_delivery_events_workspace_order_created_idx" ON "mena_order_delivery_events" USING btree ("workspace_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "mena_order_events_workspace_order_created_idx" ON "mena_order_events" USING btree ("workspace_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "mena_order_items_workspace_order_idx" ON "mena_order_items" USING btree ("workspace_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_orders_workspace_id_key" ON "mena_orders" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_orders_workspace_number_key" ON "mena_orders" USING btree ("workspace_id","order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_orders_workspace_request_key" ON "mena_orders" USING btree ("workspace_id","client_request_id");--> statement-breakpoint
CREATE INDEX "mena_orders_workspace_status_created_idx" ON "mena_orders" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "mena_orders_meta_confirmation_queue_idx" ON "mena_orders" USING btree ("meta_confirmation_status","meta_confirmation_next_run_at") WHERE "mena_orders"."meta_confirmation_status" IN ('queued', 'processing', 'sending');--> statement-breakpoint
CREATE INDEX "mena_orders_whatsapp_confirmation_queue_idx" ON "mena_orders" USING btree ("whatsapp_confirmation_status","whatsapp_confirmation_next_run_at") WHERE "mena_orders"."whatsapp_confirmation_status" IN ('queued', 'processing', 'sending');--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_order_intakes_conversation_key" ON "mena_whatsapp_order_intakes" USING btree ("workspace_id","instance_name","remote_jid_hash");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_order_intakes_workspace_status_idx" ON "mena_whatsapp_order_intakes" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_order_intakes_expiry_idx" ON "mena_whatsapp_order_intakes" USING btree ("expires_at");
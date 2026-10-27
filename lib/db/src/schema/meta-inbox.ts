import { sql } from "drizzle-orm";
import {
  check,
  boolean,
  integer,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const menaMetaInboxItems = pgTable(
  "mena_meta_inbox_items",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: text("platform").$type<"facebook" | "instagram">().notNull(),
    kind: text("kind").$type<"message" | "comment">().notNull(),
    externalId: text("external_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    parentId: text("parent_id"),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    text: text("text").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    replyText: text("reply_text"),
    replyExternalId: text("reply_external_id"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_meta_inbox_workspace_external_key").on(
      table.workspaceId,
      table.platform,
      table.externalId,
    ),
    index("mena_meta_inbox_workspace_time_idx").on(
      table.workspaceId,
      table.occurredAt,
    ),
    check(
      "mena_meta_inbox_platform_check",
      sql`${table.platform} IN ('facebook', 'instagram')`,
    ),
    check(
      "mena_meta_inbox_kind_check",
      sql`${table.kind} IN ('message', 'comment')`,
    ),
  ],
);

export const menaMetaWebhookSubscriptions = pgTable(
  "mena_meta_webhook_subscriptions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: text("platform").$type<"facebook" | "instagram">().notNull(),
    accountId: text("account_id").notNull(),
    subscribedFields: jsonb("subscribed_fields")
      .$type<string[]>()
      .notNull()
      .default([]),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_meta_webhook_subscriptions_workspace_platform_key").on(
      table.workspaceId,
      table.platform,
    ),
    check(
      "mena_meta_webhook_subscriptions_platform_check",
      sql`${table.platform} IN ('facebook', 'instagram')`,
    ),
  ],
);

export const menaMetaAutoReplySettings = pgTable(
  "mena_meta_auto_reply_settings",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    facebookMessagesEnabled: boolean("facebook_messages_enabled")
      .notNull()
      .default(false),
    facebookCommentsEnabled: boolean("facebook_comments_enabled")
      .notNull()
      .default(false),
    instagramMessagesEnabled: boolean("instagram_messages_enabled")
      .notNull()
      .default(false),
    instagramCommentsEnabled: boolean("instagram_comments_enabled")
      .notNull()
      .default(false),
    language: text("language")
      .$type<"ar" | "match_customer">()
      .notNull()
      .default("ar"),
    tone: text("tone")
      .$type<"friendly_professional" | "concise" | "formal">()
      .notNull()
      .default("friendly_professional"),
    instructions: text("instructions").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_meta_auto_reply_settings_workspace_key").on(
      table.workspaceId,
    ),
    check(
      "mena_meta_auto_reply_settings_language_check",
      sql`${table.language} IN ('ar', 'match_customer')`,
    ),
    check(
      "mena_meta_auto_reply_settings_tone_check",
      sql`${table.tone} IN ('friendly_professional', 'concise', 'formal')`,
    ),
    check(
      "mena_meta_auto_reply_settings_instructions_length_check",
      sql`length(${table.instructions}) <= 2000`,
    ),
  ],
);

export const menaMetaAutoReplyJobs = pgTable(
  "mena_meta_auto_reply_jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    inboxItemId: text("inbox_item_id")
      .notNull()
      .references(() => menaMetaInboxItems.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<
        | "queued"
        | "processing"
        | "sending"
        | "sent"
        | "failed"
        | "skipped"
        | "unknown"
      >()
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("mena_meta_auto_reply_jobs_workspace_item_key").on(
      table.workspaceId,
      table.inboxItemId,
    ),
    index("mena_meta_auto_reply_jobs_pending_idx").on(
      table.status,
      table.nextRunAt,
    ),
    index("mena_meta_auto_reply_jobs_lease_idx").on(
      table.status,
      table.leaseExpiresAt,
    ),
    check(
      "mena_meta_auto_reply_jobs_status_check",
      sql`${table.status} IN ('queued', 'processing', 'sending', 'sent', 'failed', 'skipped', 'unknown')`,
    ),
    check(
      "mena_meta_auto_reply_jobs_attempts_check",
      sql`${table.attempts} >= 0 AND ${table.attempts} <= 3`,
    ),
  ],
);

export type MetaInboxItem = typeof menaMetaInboxItems.$inferSelect;

import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const posts = pgTable("mena_posts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  channels: jsonb("channels").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("draft"),
  sourceType: text("source_type").notNull().default("manual"),
  sourceMessageId: text("source_message_id"),
  sourceGroupJid: text("source_group_jid"),
  sourceMessageDate: timestamp("source_message_date", { withTimezone: true }),
  sourceText: text("source_text"),
  mediaUrls: jsonb("media_urls").$type<string[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  autoPublish: boolean("auto_publish").notNull().default(false),
  autoPublishChannels: jsonb("auto_publish_channels").$type<string[]>().notNull().default([]),
  publishResults: jsonb("publish_results").$type<Record<string, unknown>>().notNull().default({}),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("mena_posts_workspace_created_idx").on(table.workspaceId, table.createdAt),
  uniqueIndex("mena_posts_workspace_id_key").on(table.workspaceId, table.id),
]);

export const menaContentSettings = pgTable("mena_content_settings", {
  ownerId: text("owner_id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  autoPublishEnabled: boolean("auto_publish_enabled").notNull().default(false),
  autoPublishChannels: jsonb("auto_publish_channels").$type<string[]>().notNull().default([]),
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("mena_content_settings_workspace_key").on(table.workspaceId)]);

export const menaContentJobs = pgTable("mena_content_jobs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  messageId: text("message_id").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("mena_content_jobs_workspace_pending_idx").on(table.workspaceId, table.status, table.nextRunAt),
]);

export const menaPostActivityEvents = pgTable("mena_post_activity_events", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  postId: text("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  accountId: text("account_id"),
  channel: text("channel").notNull(),
  eventType: text("event_type").notNull(),
  actorId: text("actor_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  index("mena_post_activity_account_channel_time_idx").on(
    table.ownerId,
    table.accountId,
    table.channel,
    table.occurredAt,
  ),
  index("mena_post_activity_post_time_idx").on(
    table.ownerId,
    table.postId,
    table.occurredAt,
  ),
  index("mena_post_activity_workspace_time_idx").on(
    table.workspaceId,
    table.occurredAt,
  ),
]);

export type DbPost = typeof posts.$inferSelect;
export type InsertPost = typeof posts.$inferInsert;

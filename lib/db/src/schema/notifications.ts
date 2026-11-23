import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

// ---------------------------------------------------------------------------
// Push notification delivery for the merchant app.
//
// Two tables, deliberately separate:
//
//   mena_push_notification_tokens   which devices may be told something
//   mena_push_notification_outbox   what has to be told, and how far it got
//
// Tokens are keyed by *user*, not by membership. A merchant who belongs to
// three workspaces still carries one phone in one pocket; storing the token
// per membership would send the same alert three times and make revocation
// ambiguous. Recipients are resolved through mena_workspace_members at send
// time, so a member added after an event is enqueued still receives it.
// ---------------------------------------------------------------------------

export const pushNotificationTokens = pgTable(
  "mena_push_notification_tokens",
  {
    id: text("id").primaryKey(),
    // No foreign key: the server stores nothing about Clerk users outside
    // memberships, and mena_workspace_members.user_id is unkeyed too.
    userId: text("user_id").notNull(),
    token: text("token").notNull(),
    platform: text("platform").notNull(),
    // Expo's installation id when the client can supply it. Not unique on its
    // own — reinstalling produces a new one for the same device.
    deviceId: text("device_id"),
    // Flipped to false when Expo reports DeviceNotRegistered (uninstall, or
    // the user turned notifications off for the app). The row is kept rather
    // than deleted so a returning device is re-enabled instead of duplicated.
    enabled: boolean("enabled").notNull().default(true),
    // Lets stale tokens be pruned: a client re-registers on every cold start,
    // so a token not seen for months belongs to a device that is gone.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_push_notification_tokens_user_token_key").on(
      table.userId,
      table.token,
    ),
    // Recipient resolution always filters on enabled, and most rows stay
    // enabled, so the partial index is about skipping revoked tokens cheaply
    // rather than about selectivity.
    index("mena_push_notification_tokens_enabled_idx")
      .on(table.userId)
      .where(sql`${table.enabled}`),
    check(
      "mena_push_notification_tokens_platform_check",
      sql`${table.platform} IN ('ios', 'android', 'web')`,
    ),
  ],
);

export const pushNotificationOutbox = pgTable(
  "mena_push_notification_outbox",
  {
    id: text("id").primaryKey(),
    // CASCADE, not the RESTRICT used by most workspace children: a queue of
    // transient alerts must never be what blocks a workspace from being
    // deleted, and there is nothing here worth preserving afterwards.
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    // NULL means every member of the workspace, which is what all four event
    // types use today. The column exists so a future per-user alert (a reply
    // assigned to one merchant) does not need a migration.
    recipientUserId: text("recipient_user_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // Deep-link payload: route plus the ids the screen needs. Kept small on
    // purpose — Expo limits the whole message to 4 KB.
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    // Collapses repeats. Always time-bucketed by the caller (for example
    // `customer_message:<conversationId>:<hourBucket>`) so uniqueness expires
    // on its own instead of suppressing the same alert forever.
    dedupeKey: text("dedupe_key").notNull(),
    // Mirrors the mena_orders meta-confirmation statuses so both queues are
    // reasoned about the same way. `unknown` is the important one: the lease
    // expired while the Expo request was in flight, so delivery cannot be
    // ruled out and the row must never be retried blindly.
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // How many devices actually received it. Zero is a legitimate outcome —
    // it means nobody had registered a token yet, not that sending broke.
    recipientCount: integer("recipient_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_push_notification_outbox_dedupe_key").on(
      table.workspaceId,
      table.eventType,
      table.dedupeKey,
    ),
    index("mena_push_notification_outbox_queue_idx")
      .on(table.status, table.nextRunAt)
      .where(
        sql`${table.status} IN ('queued', 'processing', 'sending')`,
      ),
    index("mena_push_notification_outbox_workspace_time_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    check(
      "mena_push_notification_outbox_event_type_check",
      sql`${table.eventType} IN ('customer_message', 'publish_failure', 'new_order', 'quota_exhausted')`,
    ),
    check(
      "mena_push_notification_outbox_status_check",
      sql`${table.status} IN ('queued', 'processing', 'sending', 'sent', 'failed', 'unknown')`,
    ),
    check(
      "mena_push_notification_outbox_attempts_check",
      sql`${table.attempts} >= 0`,
    ),
    check(
      "mena_push_notification_outbox_recipient_count_check",
      sql`${table.recipientCount} >= 0`,
    ),
  ],
);

export type PushNotificationToken = typeof pushNotificationTokens.$inferSelect;
export type PushNotificationOutboxRow =
  typeof pushNotificationOutbox.$inferSelect;

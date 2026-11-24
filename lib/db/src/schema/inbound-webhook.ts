import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

/**
 * Every inbound webhook decision the server made, kept for a few days.
 *
 * The logs already name each outcome, but logs are not queryable by a merchant
 * and not retained by the app. Without this table, "no customer messages have
 * arrived" has two very different causes that look identical on screen: the
 * provider never called, or it called and the call was rejected. The rows here
 * separate them, including the rejections that cannot be attributed to a
 * workspace — a refused secret is rejected before the instance is looked up, so
 * `workspace_id` stays null and the row is found by `instance_name` instead.
 *
 * Identifiers only: never message content, which would put customer text in a
 * diagnostics table with a longer lifetime than the message itself.
 */
export const menaInboundWebhookEvents = pgTable(
  "mena_inbound_webhook_events",
  {
    id: text("id").primaryKey(),
    /** Null when the attempt could not be attributed to a workspace. */
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    /**
     * Null when the attempt could not be attributed to a platform either — a
     * Meta call rejected before its object type was read. Honest about the
     * unknown rather than guessing "facebook" for an Instagram merchant.
     */
    platform: text("platform").$type<
      "whatsapp" | "facebook" | "instagram"
    >(),
    /** Stable outcome name, e.g. `WHATSAPP_WEBHOOK_REJECTED_SECRET`. */
    event: text("event").notNull(),
    /** True when the outcome proves the provider reached this server. */
    deliveryConfirmed: boolean("delivery_confirmed").notNull().default(true),
    instanceName: text("instance_name"),
    accountId: text("account_id"),
    context: jsonb("context")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The merchant-facing lookup: attempts for my workspace, newest first.
    index("mena_inbound_webhook_event_workspace_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    // Unattributed attempts are matched by the identifiers the payload carried.
    index("mena_inbound_webhook_event_instance_idx").on(
      table.platform,
      table.instanceName,
      table.createdAt,
    ),
    index("mena_inbound_webhook_event_account_idx").on(
      table.platform,
      table.accountId,
      table.createdAt,
    ),
    // Retention purge.
    index("mena_inbound_webhook_event_created_idx").on(table.createdAt),
    check(
      "mena_inbound_webhook_event_platform_check",
      sql`${table.platform} IN ('whatsapp', 'facebook', 'instagram')`,
    ),
  ],
);

export type InboundWebhookEvent =
  typeof menaInboundWebhookEvents.$inferSelect;

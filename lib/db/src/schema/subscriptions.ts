import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspaces";

export type SubscriptionPlanId = "free" | "starter" | "growth";
export type WorkspaceSubscriptionStatus =
  | "trialing"
  | "active"
  | "canceled"
  | "past_due";

export const workspaceSubscriptions = pgTable(
  "mena_workspace_subscriptions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    planId: text("plan_id").$type<SubscriptionPlanId>().notNull(),
    status: text("status").$type<WorkspaceSubscriptionStatus>().notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    paymentProvider: text("payment_provider"),
    providerSubscriptionId: text("provider_subscription_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_workspace_subscriptions_workspace_key").on(
      table.workspaceId,
    ),
    index("mena_workspace_subscriptions_status_idx").on(table.status),
    check(
      "mena_workspace_subscriptions_plan_check",
      sql`${table.planId} IN ('free', 'starter', 'growth')`,
    ),
    check(
      "mena_workspace_subscriptions_status_check",
      sql`${table.status} IN ('trialing', 'active', 'canceled', 'past_due')`,
    ),
  ],
);

export const workspaceSubscriptionUsage = pgTable(
  "mena_workspace_subscription_usage",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    aiGenerations: integer("ai_generations").notNull().default(0),
    postsCreated: integer("posts_created").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_workspace_subscription_usage_period_key").on(
      table.workspaceId,
      table.periodKey,
    ),
    check(
      "mena_workspace_subscription_usage_nonnegative_check",
      sql`${table.aiGenerations} >= 0 AND ${table.postsCreated} >= 0`,
    ),
  ],
);

export type WorkspaceSubscription =
  typeof workspaceSubscriptions.$inferSelect;
export type WorkspaceSubscriptionUsage =
  typeof workspaceSubscriptionUsage.$inferSelect;

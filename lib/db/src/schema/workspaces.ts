import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const workspaces = pgTable(
  "mena_workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("mena_workspaces_created_by_idx").on(table.createdBy)],
);

export const workspaceOnboarding = pgTable(
  "mena_workspace_onboarding",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    currentStep: integer("current_step").notNull().default(3),
    completed: boolean("completed").notNull().default(true),
    socialAccountsCompleted: boolean("social_accounts_completed")
      .notNull()
      .default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_workspace_onboarding_workspace_user_key").on(
      table.workspaceId,
      table.userId,
    ),
    index("mena_workspace_onboarding_user_idx").on(table.userId),
    check(
      "mena_workspace_onboarding_step_check",
      sql`${table.currentStep} BETWEEN 0 AND 3`,
    ),
  ],
);

export const workspaceMembers = pgTable(
  "mena_workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_workspace_members_workspace_user_key").on(
      table.workspaceId,
      table.userId,
    ),
    index("mena_workspace_members_user_idx").on(table.userId),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceOnboarding = typeof workspaceOnboarding.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;

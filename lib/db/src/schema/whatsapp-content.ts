import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { menaWhatsAppGroups, menaWhatsAppMessages } from "./social";
import { workspaces } from "./workspaces";
import { sql } from "drizzle-orm";

export const menaWhatsAppContentAssociations = pgTable(
  "mena_whatsapp_content_associations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    instanceName: text("instance_name").notNull(),
    groupId: text("group_id").notNull(),
    leftMessageId: text("left_message_id")
      .notNull()
      .references(() => menaWhatsAppMessages.id, { onDelete: "restrict" }),
    rightMessageId: text("right_message_id")
      .notNull()
      .references(() => menaWhatsAppMessages.id, { onDelete: "restrict" }),
    decision: text("decision").$type<"accepted" | "rejected">().notNull(),
    contentBundleId: text("content_bundle_id"),
    decidedBy: text("decided_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_content_associations_pair_key").on(
      table.workspaceId,
      table.instanceName,
      table.groupId,
      table.leftMessageId,
      table.rightMessageId,
    ),
    index("mena_whatsapp_content_associations_bundle_idx").on(
      table.workspaceId,
      table.instanceName,
      table.groupId,
      table.contentBundleId,
    ),
    foreignKey({
      columns: [table.groupId, table.workspaceId, table.instanceName],
      foreignColumns: [
        menaWhatsAppGroups.id,
        menaWhatsAppGroups.workspaceId,
        menaWhatsAppGroups.instanceName,
      ],
      name: "mena_whatsapp_content_associations_group_fk",
    }).onDelete("restrict"),
    check(
      "mena_whatsapp_content_associations_pair_order_check",
      sql`${table.leftMessageId} < ${table.rightMessageId}`,
    ),
    check(
      "mena_whatsapp_content_associations_decision_check",
      sql`(${table.decision} = 'accepted' AND ${table.contentBundleId} IS NOT NULL) OR (${table.decision} = 'rejected' AND ${table.contentBundleId} IS NULL)`,
    ),
  ],
);

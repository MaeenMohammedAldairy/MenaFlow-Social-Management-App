import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const menaMetaOrderIntakes = pgTable(
  "mena_meta_order_intakes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: text("platform").$type<"facebook" | "instagram">().notNull(),
    conversationId: text("conversation_id").notNull(),
    actorId: text("actor_id"),
    status: text("status")
      .$type<"collecting" | "creating" | "created" | "cancelled">()
      .notNull()
      .default("collecting"),
    awaitingField: text("awaiting_field").$type<
      "product" | "quantity" | "name" | "phone" | "address" | "delivery_time"
    >(),
    productId: text("product_id"),
    quantity: integer("quantity"),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    deliveryAddress: text("delivery_address"),
    desiredDeliveryTime: text("desired_delivery_time"),
    lastInboxItemId: text("last_inbox_item_id"),
    draftOrderId: text("draft_order_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_meta_order_intakes_conversation_key").on(
      table.workspaceId,
      table.platform,
      table.conversationId,
    ),
    index("mena_meta_order_intakes_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    check(
      "mena_meta_order_intakes_platform_check",
      sql`${table.platform} IN ('facebook', 'instagram')`,
    ),
    check(
      "mena_meta_order_intakes_status_check",
      sql`${table.status} IN ('collecting', 'created', 'cancelled')`,
    ),
    check(
      "mena_meta_order_intakes_quantity_check",
      sql`${table.quantity} IS NULL OR ${table.quantity} BETWEEN 1 AND 999`,
    ),
    check(
      "mena_meta_order_intakes_awaiting_field_check",
      sql`${table.awaitingField} IS NULL OR ${table.awaitingField} IN ('product', 'quantity', 'name', 'phone', 'address', 'delivery_time')`,
    ),
  ],
);

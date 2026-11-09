import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { products } from "./products";
import { workspaces } from "./workspaces";

export const orderStatuses = [
  "draft",
  "confirmed",
  "preparing",
  "shipped",
  "completed",
  "cancelled",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

export const deliveryStatuses = [
  "pending",
  "ready",
  "picked_up",
  "in_transit",
  "delivered",
  "failed",
  "returned",
] as const;

export type DeliveryStatus = (typeof deliveryStatuses)[number];

export const collectionStatuses = [
  "not_collected",
  "collected",
  "remitted",
] as const;

export type CollectionStatus = (typeof collectionStatuses)[number];

export const menaOrders = pgTable(
  "mena_orders",
  {
    id: text("id").primaryKey(),
    orderNumber: text("order_number").notNull(),
    ownerId: text("owner_id").notNull(),
    clientRequestId: text("client_request_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    deliveryAddress: text("delivery_address"),
    notes: text("notes").notNull().default(""),
    sourceMetaInboxItemId: text("source_meta_inbox_item_id"),
    sourcePlatform: text("source_platform"),
    sourceConversationId: text("source_conversation_id"),
    status: text("status").$type<OrderStatus>().notNull().default("draft"),
    inventoryReserved: boolean("inventory_reserved").notNull().default(false),
    deliveryStatus: text("delivery_status")
      .$type<DeliveryStatus>()
      .notNull()
      .default("pending"),
    deliveryProvider: text("delivery_provider"),
    trackingNumber: text("tracking_number"),
    deliveryFee: numeric("delivery_fee", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    collectionStatus: text("collection_status")
      .$type<CollectionStatus>()
      .notNull()
      .default("not_collected"),
    collectedAmount: numeric("collected_amount", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    currency: text("currency").notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_orders_workspace_id_key").on(table.workspaceId, table.id),
    uniqueIndex("mena_orders_workspace_number_key").on(
      table.workspaceId,
      table.orderNumber,
    ),
    uniqueIndex("mena_orders_workspace_request_key").on(
      table.workspaceId,
      table.clientRequestId,
    ),
    index("mena_orders_workspace_status_created_idx").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    check(
      "mena_orders_status_check",
      sql`${table.status} IN ('draft', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled')`,
    ),
    check(
      "mena_orders_delivery_status_check",
      sql`${table.deliveryStatus} IN ('pending', 'ready', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned')`,
    ),
    check(
      "mena_orders_collection_status_check",
      sql`${table.collectionStatus} IN ('not_collected', 'collected', 'remitted')`,
    ),
    check(
      "mena_orders_delivery_money_check",
      sql`${table.deliveryFee} >= 0 AND ${table.collectedAmount} >= 0`,
    ),
    check("mena_orders_total_check", sql`${table.total} >= 0`),
    check("mena_orders_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "mena_orders_source_platform_check",
      sql`${table.sourcePlatform} IS NULL OR ${table.sourcePlatform} IN ('facebook', 'instagram')`,
    ),
  ],
);

export const menaOrderItems = pgTable(
  "mena_order_items",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    productId: text("product_id"),
    productName: text("product_name").notNull(),
    productSku: text("product_sku"),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mena_order_items_workspace_order_idx").on(
      table.workspaceId,
      table.orderId,
    ),
    foreignKey({
      columns: [table.workspaceId, table.orderId],
      foreignColumns: [menaOrders.workspaceId, menaOrders.id],
      name: "mena_order_items_order_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.productId],
      foreignColumns: [products.workspaceId, products.id],
      name: "mena_order_items_product_fk",
    }),
    check("mena_order_items_quantity_check", sql`${table.quantity} > 0`),
    check(
      "mena_order_items_unit_price_check",
      sql`${table.unitPrice} >= 0 AND ${table.lineTotal} >= 0`,
    ),
  ],
);

export const menaOrderEvents = pgTable(
  "mena_order_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    actorId: text("actor_id").notNull(),
    fromStatus: text("from_status").$type<OrderStatus>(),
    toStatus: text("to_status").$type<OrderStatus>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mena_order_events_workspace_order_created_idx").on(
      table.workspaceId,
      table.orderId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.workspaceId, table.orderId],
      foreignColumns: [menaOrders.workspaceId, menaOrders.id],
      name: "mena_order_events_order_fk",
    }).onDelete("cascade"),
    check(
      "mena_order_events_from_status_check",
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('draft', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled')`,
    ),
    check(
      "mena_order_events_to_status_check",
      sql`${table.toStatus} IN ('draft', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled')`,
    ),
  ],
);

export const menaOrderDeliveryEvents = pgTable(
  "mena_order_delivery_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    actorId: text("actor_id").notNull(),
    fromStatus: text("from_status").$type<DeliveryStatus>(),
    toStatus: text("to_status").$type<DeliveryStatus>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mena_order_delivery_events_workspace_order_created_idx").on(
      table.workspaceId,
      table.orderId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.workspaceId, table.orderId],
      foreignColumns: [menaOrders.workspaceId, menaOrders.id],
      name: "mena_order_delivery_events_order_fk",
    }).onDelete("cascade"),
    check(
      "mena_order_delivery_events_from_status_check",
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('pending', 'ready', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned')`,
    ),
    check(
      "mena_order_delivery_events_to_status_check",
      sql`${table.toStatus} IN ('pending', 'ready', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned')`,
    ),
  ],
);

export type MenaOrder = typeof menaOrders.$inferSelect;
export type MenaOrderItem = typeof menaOrderItems.$inferSelect;
export type MenaOrderEvent = typeof menaOrderEvents.$inferSelect;
export type MenaOrderDeliveryEvent = typeof menaOrderDeliveryEvents.$inferSelect;

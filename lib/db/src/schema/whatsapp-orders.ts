import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { products } from "./products";
import { menaWhatsAppConnections } from "./social";
import { workspaces } from "./workspaces";

export const menaWhatsAppOrderIntakes = pgTable(
  "mena_whatsapp_order_intakes",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    instanceName: text("instance_name").notNull(),
    remoteJidHash: text("remote_jid_hash").notNull(),
    status: text("status")
      .$type<"collecting" | "creating" | "created" | "cancelled">()
      .notNull()
      .default("collecting"),
    awaitingField: text("awaiting_field").$type<
      "product" | "quantity" | "name" | "phone" | "address"
    >(),
    productId: text("product_id"),
    quantity: integer("quantity"),
    encryptedCustomerData: text("encrypted_customer_data").notNull(),
    clientRequestId: text("client_request_id").notNull(),
    lastProviderMessageId: text("last_provider_message_id"),
    draftOrderId: text("draft_order_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_order_intakes_conversation_key").on(
      table.workspaceId,
      table.instanceName,
      table.remoteJidHash,
    ),
    index("mena_whatsapp_order_intakes_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    index("mena_whatsapp_order_intakes_expiry_idx").on(table.expiresAt),
    foreignKey({
      columns: [table.workspaceId, table.instanceName],
      foreignColumns: [
        menaWhatsAppConnections.workspaceId,
        menaWhatsAppConnections.instanceName,
      ],
      name: "mena_whatsapp_order_intakes_connection_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.productId],
      foreignColumns: [products.workspaceId, products.id],
      name: "mena_whatsapp_order_intakes_product_fk",
    }).onDelete("restrict"),
    check(
      "mena_whatsapp_order_intakes_status_check",
      sql`${table.status} IN ('collecting', 'creating', 'created', 'cancelled')`,
    ),
    check(
      "mena_whatsapp_order_intakes_awaiting_field_check",
      sql`${table.awaitingField} IS NULL OR ${table.awaitingField} IN ('product', 'quantity', 'name', 'phone', 'address')`,
    ),
    check(
      "mena_whatsapp_order_intakes_quantity_check",
      sql`${table.quantity} IS NULL OR ${table.quantity} BETWEEN 1 AND 999`,
    ),
  ],
);
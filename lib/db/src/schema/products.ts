import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  boolean,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  integer,
} from "drizzle-orm/pg-core";
import { posts } from "./posts";
import { menaWhatsAppMessages } from "./social";
import { workspaces } from "./workspaces";

export const products = pgTable(
  "mena_products",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sku: text("sku"),
    name: text("name").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    description: text("description").notNull().default(""),
    price: numeric("price", { precision: 12, scale: 2 }),
    currency: text("currency"),
    availability: text("availability")
      .$type<"unknown" | "in_stock" | "out_of_stock" | "preorder">()
      .notNull()
      .default("unknown"),
    inventoryTracked: boolean("inventory_tracked").notNull().default(false),
    stockOnHand: integer("stock_on_hand").notNull().default(0),
    stockReserved: integer("stock_reserved").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
    status: text("status")
      .$type<"draft" | "active" | "archived">()
      .notNull()
      .default("draft"),
    mediaUrls: jsonb("media_urls").$type<string[]>().notNull().default([]),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_products_workspace_id_key").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("mena_products_workspace_sku_key")
      .on(table.workspaceId, table.sku)
      .where(sql`${table.sku} IS NOT NULL`),
    index("mena_products_workspace_status_updated_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    check(
      "mena_products_availability_check",
      sql`${table.availability} IN ('unknown', 'in_stock', 'out_of_stock', 'preorder')`,
    ),
    check(
      "mena_products_status_check",
      sql`${table.status} IN ('draft', 'active', 'archived')`,
    ),
    check(
      "mena_products_inventory_check",
      sql`${table.stockOnHand} >= 0 AND ${table.stockReserved} >= 0 AND ${table.stockReserved} <= ${table.stockOnHand} AND ${table.lowStockThreshold} >= 0`,
    ),
    check(
      "mena_products_price_check",
      sql`${table.price} IS NULL OR ${table.price} >= 0`,
    ),
    check(
      "mena_products_currency_check",
      sql`${table.currency} IS NULL OR ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "mena_products_price_currency_check",
      sql`${table.price} IS NULL OR ${table.currency} IS NOT NULL`,
    ),
  ],
);

export const inventoryMovementTypes = [
  "opening_balance",
  "adjustment",
  "reservation",
  "release",
  "shipment",
] as const;

export type InventoryMovementType = (typeof inventoryMovementTypes)[number];

export const menaInventoryMovements = pgTable(
  "mena_inventory_movements",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    orderId: text("order_id"),
    actorId: text("actor_id").notNull(),
    type: text("type").$type<InventoryMovementType>().notNull(),
    stockDelta: integer("stock_delta").notNull().default(0),
    reservedDelta: integer("reserved_delta").notNull().default(0),
    reason: text("reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mena_inventory_movements_workspace_product_created_idx").on(
      table.workspaceId,
      table.productId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.workspaceId, table.productId],
      foreignColumns: [products.workspaceId, products.id],
      name: "mena_inventory_movements_product_fk",
    }),
    check(
      "mena_inventory_movements_type_check",
      sql`${table.type} IN ('opening_balance', 'adjustment', 'reservation', 'release', 'shipment')`,
    ),
    check(
      "mena_inventory_movements_delta_check",
      sql`${table.stockDelta} <> 0 OR ${table.reservedDelta} <> 0`,
    ),
  ],
);

export const productPosts = pgTable(
  "mena_product_posts",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    postId: text("post_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_product_posts_workspace_product_post_key").on(
      table.workspaceId,
      table.productId,
      table.postId,
    ),
    index("mena_product_posts_workspace_post_idx").on(
      table.workspaceId,
      table.postId,
    ),
    foreignKey({
      columns: [table.workspaceId, table.productId],
      foreignColumns: [products.workspaceId, products.id],
      name: "mena_product_posts_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.postId],
      foreignColumns: [posts.workspaceId, posts.id],
      name: "mena_product_posts_post_fk",
    }).onDelete("cascade"),
  ],
);

export const productExtractionSuggestions = pgTable(
  "mena_product_extraction_suggestions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    classification: text("classification")
      .$type<"product" | "not_product">()
      .notNull()
      .default("product"),
    extractedData: jsonb("extracted_data")
      .$type<Record<string, unknown>>()
      .notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, string | null>>()
      .notNull()
      .default({}),
    confidence: jsonb("confidence")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    aiModel: text("ai_model").notNull(),
    status: text("status")
      .$type<"review" | "draft_created" | "possible_duplicate" | "dismissed">()
      .notNull()
      .default("review"),
    fieldReview: jsonb("field_review")
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    productId: text("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_product_extraction_workspace_id_key").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("mena_product_extraction_workspace_source_key").on(
      table.workspaceId,
      table.sourceKey,
    ),
    index("mena_product_extraction_workspace_status_created_idx").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    check(
      "mena_product_extraction_status_check",
      sql`${table.status} IN ('review', 'draft_created', 'possible_duplicate', 'dismissed')`,
    ),
    check(
      "mena_product_extraction_classification_check",
      sql`${table.classification} IN ('product', 'not_product')`,
    ),
  ],
);

export const productExtractionSources = pgTable(
  "mena_product_extraction_sources",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    suggestionId: text("suggestion_id"),
    messageId: text("message_id")
      .notNull()
      .references(() => menaWhatsAppMessages.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_product_extraction_source_workspace_message_key").on(
      table.workspaceId,
      table.messageId,
    ),
    index("mena_product_extraction_source_suggestion_idx").on(
      table.workspaceId,
      table.suggestionId,
    ),
    foreignKey({
      columns: [table.workspaceId, table.suggestionId],
      foreignColumns: [
        productExtractionSuggestions.workspaceId,
        productExtractionSuggestions.id,
      ],
      name: "mena_product_extraction_source_suggestion_fk",
    }).onDelete("cascade"),
  ],
);

export const whatsappProductExtractionJobs = pgTable(
  "mena_whatsapp_product_extraction_jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => menaWhatsAppMessages.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<
        | "pending"
        | "processing"
        | "waiting_media"
        | "waiting_association"
        | "complete"
        | "review"
        | "failed"
      >()
      .notNull()
      .default("pending"),
    stage: text("stage")
      .$type<
        | "received"
        | "media"
        | "association"
        | "extraction"
        | "persistence"
      >()
      .notNull()
      .default("received"),
    attempts: integer("attempts").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_product_extraction_job_workspace_id_key").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("mena_whatsapp_product_extraction_job_message_key").on(
      table.workspaceId,
      table.messageId,
    ),
    index("mena_whatsapp_product_extraction_job_queue_idx").on(
      table.status,
      table.nextRunAt,
      table.createdAt,
    ),
    check(
      "mena_whatsapp_product_extraction_job_status_check",
      sql`${table.status} IN ('pending', 'processing', 'waiting_media', 'waiting_association', 'complete', 'review', 'failed')`,
    ),
    check(
      "mena_whatsapp_product_extraction_job_stage_check",
      sql`${table.stage} IN ('received', 'media', 'association', 'extraction', 'persistence')`,
    ),
  ],
);

export const productPublicationJobs = pgTable(
  "mena_product_publication_jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    requestKey: text("request_key").notNull(),
    productId: text("product_id").notNull(),
    channel: text("channel").$type<"facebook" | "instagram">().notNull(),
    accountId: text("account_id").notNull(),
    status: text("status")
      .$type<"queued" | "processing" | "published" | "failed" | "action_required">()
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    postId: text("post_id").references(() => posts.id, { onDelete: "set null" }),
    permalink: text("permalink"),
    lastError: text("last_error"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_product_publication_job_id_workspace_key").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("mena_product_publication_job_request_product_channel_key").on(
      table.workspaceId,
      table.requestKey,
      table.productId,
      table.channel,
      table.accountId,
    ),
    index("mena_product_publication_job_queue_idx").on(
      table.status,
      table.nextRunAt,
      table.createdAt,
    ),
    index("mena_product_publication_job_product_idx").on(
      table.workspaceId,
      table.productId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.workspaceId, table.productId],
      foreignColumns: [products.workspaceId, products.id],
      name: "mena_product_publication_job_product_fk",
    }).onDelete("cascade"),
    check(
      "mena_product_publication_job_channel_check",
      sql`${table.channel} IN ('facebook', 'instagram')`,
    ),
    check(
      "mena_product_publication_job_status_check",
      sql`${table.status} IN ('queued', 'processing', 'published', 'failed', 'action_required')`,
    ),
  ],
);

export type Product = typeof products.$inferSelect;

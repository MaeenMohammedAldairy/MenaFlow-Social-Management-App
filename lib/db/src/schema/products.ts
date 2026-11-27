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

/**
 * One structured fact about a product — a feature, a specification or an
 * accessory — kept with the words that prove it. `verified: false` means the
 * value is a lead the merchant must confirm, never catalog truth.
 */
export type ProductFactRecord = {
  value: string;
  sourceId: string | null;
  quote: string | null;
  start: number | null;
  end: number | null;
  verified: boolean;
};

export type ProductPriceStatus =
  | "confirmed"
  | "unquoted"
  | "ambiguous"
  | "missing";

/**
 * Why an extraction job ended, mirrored from
 * `api-server/src/lib/product-extraction-reasons.ts`. Kept as a literal here so
 * the schema stays free of a cross-package import; the runtime module is the one
 * that validates and names these.
 */
export type ProductExtractionReasonCode =
  | "RECORDED"
  | "SKIPPED_MESSAGE_UNRECEIVABLE"
  | "SKIPPED_ALREADY_COVERED"
  | "FAILED_ASSOCIATED_MESSAGE_UNAVAILABLE"
  | "WAITING_MEDIA"
  | "FAILED_MEDIA_UNRECOVERABLE"
  | "RECORDED_MEDIA_PARTIAL"
  | "WAITING_ASSOCIATION"
  | "REEXTRACTED_GROUP_GROWN"
  | "NEEDS_TEXT"
  | "FAILED_MODEL_RESPONSE"
  | "PAUSED_AI_QUOTA"
  | "FAILED_PERSISTENCE";

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
    normalizedName: text("normalized_name"),
    sourceTrust: text("source_trust")
      .$type<"merchant" | "customer" | "unknown">()
      .notNull()
      .default("merchant"),
    lastExtractionSuggestionId: text("last_extraction_suggestion_id"),
    updatedBy: text("updated_by"),
    updatedReason: text("updated_reason"),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    description: text("description").notNull().default(""),
    price: numeric("price", { precision: 12, scale: 2 }),
    currency: text("currency"),
    /** The merchant's own words for the number («25 ألف»), never rewritten. */
    rawPriceText: text("raw_price_text"),
    priceStatus: text("price_status").$type<ProductPriceStatus>(),
    features: jsonb("features")
      .$type<ProductFactRecord[]>()
      .notNull()
      .default([]),
    specifications: jsonb("specifications")
      .$type<ProductFactRecord[]>()
      .notNull()
      .default([]),
    accessories: jsonb("accessories")
      .$type<ProductFactRecord[]>()
      .notNull()
      .default([]),
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
    index("mena_products_workspace_normalized_name_idx").on(
      table.workspaceId,
      table.normalizedName,
    ),
    check(
      "mena_products_availability_check",
      sql`${table.availability} IN ('unknown', 'in_stock', 'out_of_stock', 'preorder')`,
    ),
    check(
      "mena_products_source_trust_check",
      sql`${table.sourceTrust} IN ('merchant', 'customer', 'unknown')`,
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
    /**
     * Hash of the message ids that were read. It identifies *what was read*, so
     * it must not be unique: a group that gains a message gets a new source key
     * while staying the same product group.
     */
    sourceKey: text("source_key").notNull(),
    /**
     * Identity of the product group itself (album id, accepted bundle id, or the
     * single message). One suggestion per group per version — the version chain,
     * not a pile of near-duplicate cards.
     */
    groupKey: text("group_key").notNull(),
    version: integer("version").notNull().default(1),
    /**
     * Ordinal of this item inside the group's answer, 1-based, matching
     * `mena_product_extraction_sources.item_index`. A group may be several
     * products at once, so the version alone cannot identify one suggestion —
     * and a replayed run must still collide with exactly one row.
     */
    itemIndex: integer("item_index").notNull().default(1),
    previousSuggestionId: text("previous_suggestion_id"),
    senderRole: text("sender_role")
      .$type<"merchant" | "customer" | "unknown">()
      .notNull()
      .default("unknown"),
    matchStrategy: text("match_strategy"),
    matchedProductId: text("matched_product_id"),
    matchScore: numeric("match_score", { precision: 5, scale: 4 }),
    extractionInputHash: text("extraction_input_hash"),
    rulesetVersion: text("ruleset_version").notNull().default("v1"),
    modelVersion: text("model_version"),
    /** Which instruction produced this row, so a prompt change is measurable. */
    promptVersion: text("prompt_version"),
    /**
     * What happened to the photos of the group: `included` when they went into
     * the same call as the text, `partial` when some were lost, `pending` when
     * the offer was stored while a download was still running. Without it a
     * text-only extraction is indistinguishable from a full one.
     */
    mediaState: text("media_state")
      .$type<"not_applicable" | "included" | "partial" | "pending" | "lost">()
      .notNull()
      .default("not_applicable"),
    overrideReason: text("override_reason"),
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
      .$type<
        | "review"
        | "draft_created"
        | "possible_duplicate"
        | "dismissed"
        | "superseded"
        | "update_proposed"
        | "accepted_update"
        | "rejected_update"
      >()
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
    // A source key is a record of what was read, so it is looked up but no
    // longer unique: uniqueness on it is what made a second version of the
    // same group impossible and regrouping look like a new product.
    index("mena_product_extraction_workspace_source_key_idx").on(
      table.workspaceId,
      table.sourceKey,
    ),
    uniqueIndex("mena_product_extraction_group_version_key").on(
      table.workspaceId,
      table.groupKey,
      table.version,
      table.itemIndex,
    ),
    index("mena_product_extraction_group_idx").on(
      table.workspaceId,
      table.groupKey,
    ),
    index("mena_product_extraction_workspace_status_created_idx").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    check(
      "mena_product_extraction_suggestion_media_state_check",
      sql`${table.mediaState} IN ('not_applicable', 'included', 'partial', 'pending', 'lost')`,
    ),
    check(
      "mena_product_extraction_status_check",
      sql`${table.status} IN ('review', 'draft_created', 'possible_duplicate', 'dismissed', 'superseded', 'update_proposed', 'accepted_update', 'rejected_update')`,
    ),
    check(
      "mena_product_extraction_classification_check",
      sql`${table.classification} IN ('product', 'not_product')`,
    ),
    check(
      "mena_product_extraction_sender_role_check",
      sql`${table.senderRole} IN ('merchant', 'customer', 'unknown')`,
    ),
    uniqueIndex("mena_product_extraction_version_key").on(
      table.workspaceId,
      table.previousSuggestionId,
      table.version,
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
    itemIndex: integer("item_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_product_extraction_source_workspace_message_key").on(
      table.workspaceId,
      table.messageId,
      table.suggestionId,
      table.itemIndex,
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
    rulesetVersion: text("ruleset_version").notNull().default("v1"),
    /**
     * Why the job ended, at every terminal transition. `lastError` can only
     * carry a failure, so "nothing to do" and "we dropped your message" were
     * indistinguishable — which is how two price-bearing merchant messages
     * disappeared behind a silent `complete`.
     */
    reasonCode: text("reason_code").$type<ProductExtractionReasonCode>(),
    /** Which instruction produced the answer; a prompt change stays measurable. */
    promptVersion: text("prompt_version"),
    /**
     * What the model actually returned, for the handful of seconds it matters:
     * a rejected answer cannot be diagnosed from a thrown error message alone.
     */
    rawExtractionResponse: jsonb("raw_extraction_response")
      .$type<Record<string, unknown> | null>(),
    dedupeKey: text("dedupe_key"),
    idempotencyKey: text("idempotency_key"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deadLetterAt: timestamp("dead_letter_at", { withTimezone: true }),
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
    uniqueIndex("mena_whatsapp_product_extraction_job_dedupe_key").on(
      table.workspaceId,
      table.dedupeKey,
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

/** Append-only audit of every product field change, whatever its source. */
export const menaProductChanges = pgTable(
  "mena_product_changes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    field: text("field").notNull(),
    beforeValue: jsonb("before_value"),
    afterValue: jsonb("after_value"),
    sourceType: text("source_type")
      .$type<"manual" | "extraction" | "order" | "publication">()
      .notNull(),
    sourceId: text("source_id"),
    actorId: text("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_product_changes_workspace_id_key").on(
      table.workspaceId,
      table.id,
    ),
    index("mena_product_changes_product_created_idx").on(
      table.workspaceId,
      table.productId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.workspaceId, table.productId],
      foreignColumns: [products.workspaceId, products.id],
      name: "mena_product_changes_product_fk",
    }).onDelete("cascade"),
    check(
      "mena_product_changes_source_type_check",
      sql`${table.sourceType} IN ('manual', 'extraction', 'order', 'publication')`,
    ),
  ],
);

/** A merchant-facing diff proposed from a later message. Never applied automatically. */
export const menaProductChangeProposals = pgTable(
  "mena_product_change_proposals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    suggestionId: text("suggestion_id").notNull(),
    diff: jsonb("diff").$type<Record<string, unknown>>().notNull(),
    status: text("status")
      .$type<"proposed" | "accepted" | "rejected" | "expired">()
      .notNull()
      .default("proposed"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_product_change_proposals_workspace_id_key").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("mena_product_change_proposals_suggestion_idx").on(
      table.workspaceId,
      table.suggestionId,
    ),
    foreignKey({
      columns: [table.workspaceId, table.productId],
      foreignColumns: [products.workspaceId, products.id],
      name: "mena_product_change_proposals_product_fk",
    }).onDelete("cascade"),
    check(
      "mena_product_change_proposals_status_check",
      sql`${table.status} IN ('proposed', 'accepted', 'rejected', 'expired')`,
    ),
  ],
);

/** Why a suggestion was matched (or not) to an existing product. */
export const menaProductMatchCandidates = pgTable(
  "mena_product_match_candidates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    suggestionId: text("suggestion_id").notNull(),
    productId: text("product_id").notNull(),
    strategy: text("strategy").notNull(),
    score: numeric("score", { precision: 5, scale: 4 }).notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_product_match_candidates_workspace_id_key").on(
      table.workspaceId,
      table.id,
    ),
    index("mena_product_match_candidates_suggestion_idx").on(
      table.workspaceId,
      table.suggestionId,
    ),
    foreignKey({
      columns: [table.workspaceId, table.suggestionId],
      foreignColumns: [
        productExtractionSuggestions.workspaceId,
        productExtractionSuggestions.id,
      ],
      name: "mena_product_match_candidates_suggestion_fk",
    }).onDelete("cascade"),
  ],
);

/** Lifecycle events used by the queue strip, reports and diagnostics. */
export const menaProductExtractionEvents = pgTable(
  "mena_product_extraction_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    jobId: text("job_id"),
    suggestionId: text("suggestion_id"),
    event: text("event").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mena_product_extraction_events_workspace_created_idx").on(
      table.workspaceId,
      table.event,
      table.createdAt,
    ),
  ],
);

/** Provider event keys already accepted; blocks duplicate webhook deliveries. */
export const menaWebhookIdempotency = pgTable(
  "mena_webhook_idempotency",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    eventKey: text("event_key").notNull(),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_webhook_idempotency_provider_event_key").on(
      table.provider,
      table.eventKey,
    ),
    index("mena_webhook_idempotency_created_idx").on(table.createdAt),
  ],
);

export type Product = typeof products.$inferSelect;

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const whatsappCloudConnections = pgTable(
  "mena_whatsapp_cloud_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    environment: text("environment").notNull(),
    onboardingMethod: text("onboarding_method").notNull(),
    status: text("status").notNull().default("connected"),
    createdBy: text("created_by").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastCheckStatus: text("last_check_status"),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "mena_whatsapp_cloud_connections_environment_check",
      sql`${table.environment} IN ('test', 'production')`,
    ),
    check(
      "mena_whatsapp_cloud_connections_method_check",
      sql`${table.onboardingMethod} IN ('developer_test', 'embedded_signup_v4')`,
    ),
    check(
      "mena_whatsapp_cloud_connections_status_check",
      sql`${table.status} IN ('connected', 'reauthorization_required', 'disconnected', 'failed')`,
    ),
    check(
      "mena_whatsapp_cloud_connections_check_status_check",
      sql`${table.lastCheckStatus} IS NULL OR ${table.lastCheckStatus} IN ('passed', 'failed')`,
    ),
    uniqueIndex("mena_whatsapp_cloud_connections_workspace_id_key").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("mena_whatsapp_cloud_connections_workspace_env_id_key").on(
      table.workspaceId,
      table.environment,
      table.id,
    ),
    index("mena_whatsapp_cloud_connections_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
  ],
);

export const whatsappCloudCredentials = pgTable(
  "mena_whatsapp_cloud_credentials",
  {
    workspaceId: text("workspace_id").notNull(),
    connectionId: text("connection_id").notNull(),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    grantedPermissions: text("granted_permissions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    permissionsCheckedAt: timestamp("permissions_checked_at", {
      withTimezone: true,
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "mena_whatsapp_cloud_credentials_pkey",
      columns: [table.workspaceId, table.connectionId],
    }),
    foreignKey({
      name: "mena_whatsapp_cloud_credentials_connection_fk",
      columns: [table.workspaceId, table.connectionId],
      foreignColumns: [
        whatsappCloudConnections.workspaceId,
        whatsappCloudConnections.id,
      ],
    }).onDelete("cascade"),
  ],
);

export const whatsappCloudAccounts = pgTable(
  "mena_whatsapp_cloud_accounts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    environment: text("environment").notNull(),
    connectionId: text("connection_id").notNull(),
    metaWaacId: text("meta_waac_id"),
    businessDisplayName: text("business_display_name"),
    observedAt: timestamp("observed_at", { withTimezone: true })
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
    foreignKey({
      name: "mena_whatsapp_cloud_accounts_connection_fk",
      columns: [table.workspaceId, table.environment, table.connectionId],
      foreignColumns: [
        whatsappCloudConnections.workspaceId,
        whatsappCloudConnections.environment,
        whatsappCloudConnections.id,
      ],
    }).onDelete("cascade"),
    check(
      "mena_whatsapp_cloud_accounts_environment_check",
      sql`${table.environment} IN ('test', 'production')`,
    ),
    uniqueIndex("mena_whatsapp_cloud_accounts_workspace_env_id_key").on(
      table.workspaceId,
      table.environment,
      table.id,
    ),
    uniqueIndex("mena_whatsapp_cloud_accounts_env_waac_key")
      .on(table.environment, table.metaWaacId)
      .where(sql`${table.metaWaacId} IS NOT NULL`),
    index("mena_whatsapp_cloud_accounts_workspace_connection_idx").on(
      table.workspaceId,
      table.connectionId,
    ),
  ],
);

export const whatsappCloudMessagingAccounts = pgTable(
  "mena_whatsapp_cloud_messaging_accounts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    environment: text("environment").notNull(),
    connectionId: text("connection_id").notNull(),
    whatsappAccountId: text("whatsapp_account_id"),
    metaMessagingAccountId: text("meta_messaging_account_id").notNull(),
    displayName: text("display_name"),
    observedAt: timestamp("observed_at", { withTimezone: true })
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
    foreignKey({
      name: "mena_whatsapp_cloud_messaging_accounts_connection_fk",
      columns: [table.workspaceId, table.environment, table.connectionId],
      foreignColumns: [
        whatsappCloudConnections.workspaceId,
        whatsappCloudConnections.environment,
        whatsappCloudConnections.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "mena_whatsapp_cloud_messaging_accounts_waac_fk",
      columns: [table.workspaceId, table.environment, table.whatsappAccountId],
      foreignColumns: [
        whatsappCloudAccounts.workspaceId,
        whatsappCloudAccounts.environment,
        whatsappCloudAccounts.id,
      ],
    }).onDelete("cascade"),
    check(
      "mena_whatsapp_cloud_messaging_accounts_environment_check",
      sql`${table.environment} IN ('test', 'production')`,
    ),
    uniqueIndex("mena_whatsapp_cloud_messaging_accounts_workspace_env_id_key")
      .on(table.workspaceId, table.environment, table.id),
    uniqueIndex("mena_whatsapp_cloud_messaging_accounts_env_meta_id_key").on(
      table.environment,
      table.metaMessagingAccountId,
    ),
    index("mena_whatsapp_cloud_messaging_accounts_workspace_connection_idx")
      .on(table.workspaceId, table.connectionId),
  ],
);

export const whatsappCloudPhoneNumbers = pgTable(
  "mena_whatsapp_cloud_phone_numbers",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    environment: text("environment").notNull(),
    whatsappAccountId: text("whatsapp_account_id"),
    metaPhoneNumberId: text("meta_phone_number_id").notNull(),
    phoneNumber: text("phone_number").notNull(),
    verifiedName: text("verified_name"),
    codeVerificationStatus: text("code_verification_status"),
    registrationStatus: text("registration_status"),
    qualityRating: text("quality_rating"),
    platformType: text("platform_type"),
    observedAt: timestamp("observed_at", { withTimezone: true })
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
    foreignKey({
      name: "mena_whatsapp_cloud_phone_numbers_waac_fk",
      columns: [table.workspaceId, table.environment, table.whatsappAccountId],
      foreignColumns: [
        whatsappCloudAccounts.workspaceId,
        whatsappCloudAccounts.environment,
        whatsappCloudAccounts.id,
      ],
    }).onDelete("cascade"),
    check(
      "mena_whatsapp_cloud_phone_numbers_environment_check",
      sql`${table.environment} IN ('test', 'production')`,
    ),
    uniqueIndex("mena_whatsapp_cloud_phone_numbers_workspace_env_id_key").on(
      table.workspaceId,
      table.environment,
      table.id,
    ),
    uniqueIndex("mena_whatsapp_cloud_phone_numbers_env_meta_id_key").on(
      table.environment,
      table.metaPhoneNumberId,
    ),
    index("mena_whatsapp_cloud_phone_numbers_workspace_idx").on(
      table.workspaceId,
      table.environment,
    ),
  ],
);

export const whatsappCloudMessagingAccountPhoneNumbers = pgTable(
  "mena_whatsapp_cloud_messaging_account_phone_numbers",
  {
    workspaceId: text("workspace_id").notNull(),
    environment: text("environment").notNull(),
    messagingAccountId: text("messaging_account_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "mena_whatsapp_cloud_account_phone_numbers_messaging_fk",
      columns: [
        table.workspaceId,
        table.environment,
        table.messagingAccountId,
      ],
      foreignColumns: [
        whatsappCloudMessagingAccounts.workspaceId,
        whatsappCloudMessagingAccounts.environment,
        whatsappCloudMessagingAccounts.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "mena_whatsapp_cloud_account_phone_numbers_phone_fk",
      columns: [table.workspaceId, table.environment, table.phoneNumberId],
      foreignColumns: [
        whatsappCloudPhoneNumbers.workspaceId,
        whatsappCloudPhoneNumbers.environment,
        whatsappCloudPhoneNumbers.id,
      ],
    }).onDelete("cascade"),
    check(
      "mena_whatsapp_cloud_account_phone_numbers_environment_check",
      sql`${table.environment} IN ('test', 'production')`,
    ),
    uniqueIndex("mena_whatsapp_cloud_account_phone_numbers_pair_key").on(
      table.workspaceId,
      table.environment,
      table.messagingAccountId,
      table.phoneNumberId,
    ),
  ],
);

export const whatsappCloudWebhookEvents = pgTable(
  "mena_whatsapp_cloud_webhook_events",
  {
    id: text("id").primaryKey(),
    eventKey: text("event_key").notNull(),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    connectionId: text("connection_id"),
    metaMessagingAccountId: text("meta_messaging_account_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_cloud_webhook_events_event_key").on(
      table.eventKey,
    ),
    check(
      "mena_whatsapp_cloud_webhook_events_connection_scope_check",
      sql`(${table.workspaceId} IS NULL AND ${table.connectionId} IS NULL) OR (${table.workspaceId} IS NOT NULL AND ${table.connectionId} IS NOT NULL)`,
    ),
    check(
      "mena_whatsapp_cloud_webhook_events_status_check",
      sql`${table.status} IN ('received', 'unmatched', 'processing', 'processed', 'failed')`,
    ),
    check(
      "mena_whatsapp_cloud_webhook_events_attempts_check",
      sql`${table.attempts} >= 0`,
    ),
    index("mena_whatsapp_cloud_webhook_events_pending_idx").on(
      table.status,
      table.nextAttemptAt,
      table.receivedAt,
    ),
    index("mena_whatsapp_cloud_webhook_events_workspace_received_idx").on(
      table.workspaceId,
      table.receivedAt,
    ),
  ],
);

export const whatsappCloudConversations = pgTable(
  "mena_whatsapp_cloud_conversations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    environment: text("environment").notNull(),
    connectionId: text("connection_id").notNull(),
    messagingAccountId: text("messaging_account_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    customerWaId: text("customer_wa_id").notNull(),
    customerName: text("customer_name"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessagePreview: text("last_message_preview"),
    lastMessageDirection: text("last_message_direction"),
    unreadCount: integer("unread_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "mena_whatsapp_cloud_conversations_connection_fk",
      columns: [table.workspaceId, table.environment, table.connectionId],
      foreignColumns: [
        whatsappCloudConnections.workspaceId,
        whatsappCloudConnections.environment,
        whatsappCloudConnections.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "mena_whatsapp_cloud_conversations_account_phone_fk",
      columns: [
        table.workspaceId,
        table.environment,
        table.messagingAccountId,
        table.phoneNumberId,
      ],
      foreignColumns: [
        whatsappCloudMessagingAccountPhoneNumbers.workspaceId,
        whatsappCloudMessagingAccountPhoneNumbers.environment,
        whatsappCloudMessagingAccountPhoneNumbers.messagingAccountId,
        whatsappCloudMessagingAccountPhoneNumbers.phoneNumberId,
      ],
    }).onDelete("cascade"),
    check(
      "mena_whatsapp_cloud_conversations_environment_check",
      sql`${table.environment} IN ('test', 'production')`,
    ),
    check(
      "mena_whatsapp_cloud_conversations_unread_count_check",
      sql`${table.unreadCount} >= 0`,
    ),
    check(
      "mena_whatsapp_cloud_conversations_last_direction_check",
      sql`${table.lastMessageDirection} IS NULL OR ${table.lastMessageDirection} IN ('inbound', 'outbound')`,
    ),
    uniqueIndex("mena_whatsapp_cloud_conversations_workspace_env_id_key").on(
      table.workspaceId,
      table.environment,
      table.id,
    ),
    uniqueIndex("mena_whatsapp_cloud_conversations_customer_key").on(
      table.workspaceId,
      table.environment,
      table.phoneNumberId,
      table.customerWaId,
    ),
    index("mena_whatsapp_cloud_conversations_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  ],
);

export const whatsappCloudMessages = pgTable(
  "mena_whatsapp_cloud_messages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    environment: text("environment").notNull(),
    conversationId: text("conversation_id").notNull(),
    metaMessageId: text("meta_message_id").notNull(),
    direction: text("direction").notNull(),
    messageType: text("message_type").notNull(),
    textBody: text("text_body"),
    media: jsonb("media").$type<Array<Record<string, unknown>>>().notNull().default([]),
    replyToMetaMessageId: text("reply_to_meta_message_id"),
    status: text("status").notNull(),
    statusAt: timestamp("status_at", { withTimezone: true }),
    messageAt: timestamp("message_at", { withTimezone: true }).notNull(),
    statusErrorCode: text("status_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "mena_whatsapp_cloud_messages_conversation_fk",
      columns: [table.workspaceId, table.environment, table.conversationId],
      foreignColumns: [
        whatsappCloudConversations.workspaceId,
        whatsappCloudConversations.environment,
        whatsappCloudConversations.id,
      ],
    }).onDelete("cascade"),
    check(
      "mena_whatsapp_cloud_messages_environment_check",
      sql`${table.environment} IN ('test', 'production')`,
    ),
    check(
      "mena_whatsapp_cloud_messages_direction_check",
      sql`${table.direction} IN ('inbound', 'outbound')`,
    ),
    check(
      "mena_whatsapp_cloud_messages_status_check",
      sql`${table.status} IN ('received', 'sent', 'delivered', 'read', 'failed', 'unknown')`,
    ),
    uniqueIndex("mena_whatsapp_cloud_messages_environment_meta_id_key").on(
      table.environment,
      table.metaMessageId,
    ),
    index("mena_whatsapp_cloud_messages_conversation_time_idx").on(
      table.workspaceId,
      table.environment,
      table.conversationId,
      table.messageAt,
    ),
  ],
);

export type WhatsAppCloudConnection =
  typeof whatsappCloudConnections.$inferSelect;

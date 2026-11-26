import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspaces";

export type WhatsAppGroupKind =
  "community" | "announcement" | "group" | "unknown";

export const menaMetaConnections = pgTable(
  "mena_meta_connections",
  {
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    pageId: text("page_id").notNull(),
    pageName: text("page_name").notNull(),
    encryptedPageAccessToken: text("encrypted_page_access_token").notNull(),
    instagramUserId: text("instagram_user_id"),
    instagramUsername: text("instagram_username"),
    grantedPermissions: jsonb("granted_permissions")
      .$type<string[]>()
      .notNull()
      .default([]),
    authorizationVerifiedAt: timestamp("authorization_verified_at", {
      withTimezone: true,
    }),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "mena_meta_connections_page_id_valid_check",
      sql`${table.pageId} IS NOT NULL AND btrim(${table.pageId}, chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)) <> '' AND ${table.pageId} = btrim(${table.pageId}, chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))`,
    ),
    check(
      "mena_meta_connections_instagram_user_id_valid_check",
      sql`${table.instagramUserId} IS NULL OR (btrim(${table.instagramUserId}, chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)) <> '' AND ${table.instagramUserId} = btrim(${table.instagramUserId}, chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)))`,
    ),
    uniqueIndex("mena_meta_connections_workspace_key").on(table.workspaceId),
    uniqueIndex("mena_meta_connections_page_id_key").on(
      sql`btrim(${table.pageId}, chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))`,
    ),
    uniqueIndex("mena_meta_connections_instagram_user_id_key")
      .on(
        sql`btrim(${table.instagramUserId}, chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))`,
      )
      .where(
        sql`${table.instagramUserId} IS NOT NULL AND btrim(${table.instagramUserId}, chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)) <> ''`,
      ),
  ],
);

export const menaOAuthStates = pgTable("mena_oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  ownerId: text("owner_id").notNull(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "restrict" }),
  requestedIntegration: text("requested_integration")
    .$type<"facebook" | "instagram">()
    .notNull()
    .default("facebook"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const menaWhatsAppConnections = pgTable(
  "mena_whatsapp_connections",
  {
    // Not unique on its own: one user may hold a WhatsApp connection in each of
    // their workspaces. Uniqueness is (owner_id, workspace_id), declared below.
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    instanceName: text("instance_name").notNull(),
    phoneNumber: text("phone_number"),
    // Generated, never written by application code. The digits-only form is
    // what global phone ownership is compared against. It folds Arabic/Persian
    // digits and a legacy `00` prefix exactly like the app-side normalizer.
    phoneDigits: text("phone_digits")
      .generatedAlwaysAs(
        sql`regexp_replace(regexp_replace(translate(coalesce(phone_number, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g'), '^00(?=[1-9])', '', 'g')`,
      )
      .notNull(),
    status: text("status").notNull().default("connected"),
    autoSyncEnabled: boolean("auto_sync_enabled").notNull().default(true),
    syncMessagesEnabled: boolean("sync_messages_enabled")
      .notNull()
      .default(true),
    syncImagesEnabled: boolean("sync_images_enabled").notNull().default(true),
    syncVideosEnabled: boolean("sync_videos_enabled").notNull().default(true),
    autoReplyEnabled: boolean("auto_reply_enabled").notNull().default(false),
    autoReplyLanguage: text("auto_reply_language").notNull().default("ar"),
    autoReplyTone: text("auto_reply_tone")
      .notNull()
      .default("friendly_professional"),
    autoReplyInstructions: text("auto_reply_instructions"),
    autoReplyTestedHash: text("auto_reply_tested_hash"),
    configId: text("config_id"),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_connections_owner_workspace_key").on(
      table.ownerId,
      table.workspaceId,
    ),
    uniqueIndex("mena_whatsapp_connections_workspace_key").on(
      table.workspaceId,
    ),
    uniqueIndex("mena_whatsapp_connections_workspace_instance_key").on(
      table.workspaceId,
      table.instanceName,
    ),
    // One active owner per normalized phone number, across all workspaces.
    // Disconnected/failed rows are history and deliberately excluded.
    uniqueIndex("mena_whatsapp_connections_active_phone_key")
      .on(table.phoneDigits)
      .where(
        sql`${table.phoneDigits} <> '' AND ${table.status} IN ('connecting', 'connected')`,
      ),
  ],
);

export const menaWhatsAppGroups = pgTable(
  "mena_whatsapp_groups",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    ownerId: text("owner_id").notNull(),
    instanceName: text("instance_name").notNull(),
    kind: text("kind").$type<WhatsAppGroupKind>().notNull().default("unknown"),
    name: text("name").notNull(),
    parentGroupId: text("parent_group_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_groups_id_workspace_instance_key").on(
      table.id,
      table.workspaceId,
      table.instanceName,
    ),
    index("mena_whatsapp_groups_workspace_instance_parent_idx").on(
      table.workspaceId,
      table.instanceName,
      table.parentGroupId,
    ),
    foreignKey({
      columns: [table.workspaceId, table.instanceName],
      foreignColumns: [
        menaWhatsAppConnections.workspaceId,
        menaWhatsAppConnections.instanceName,
      ],
      name: "mena_whatsapp_groups_connection_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.parentGroupId, table.workspaceId, table.instanceName],
      foreignColumns: [table.id, table.workspaceId, table.instanceName],
      name: "mena_whatsapp_groups_parent_fk",
    }).onDelete("restrict"),
    check(
      "mena_whatsapp_groups_kind_check",
      sql`${table.kind} IN ('community', 'announcement', 'group', 'unknown')`,
    ),
    check(
      "mena_whatsapp_groups_not_self_parent_check",
      sql`${table.parentGroupId} IS NULL OR ${table.parentGroupId} <> ${table.id}`,
    ),
  ],
);

export const menaWhatsAppGroupJids = pgTable(
  "mena_whatsapp_group_jids",
  {
    workspaceId: text("workspace_id").notNull(),
    instanceName: text("instance_name").notNull(),
    groupJid: text("group_jid").notNull(),
    groupId: text("group_id").notNull(),
    kind: text("kind").$type<WhatsAppGroupKind>().notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_group_jids_workspace_instance_jid_key").on(
      table.workspaceId,
      table.instanceName,
      table.groupJid,
    ),
    index("mena_whatsapp_group_jids_group_idx").on(
      table.workspaceId,
      table.instanceName,
      table.groupId,
    ),
    foreignKey({
      columns: [table.groupId, table.workspaceId, table.instanceName],
      foreignColumns: [
        menaWhatsAppGroups.id,
        menaWhatsAppGroups.workspaceId,
        menaWhatsAppGroups.instanceName,
      ],
      name: "mena_whatsapp_group_jids_group_fk",
    }).onDelete("restrict"),
    check(
      "mena_whatsapp_group_jids_kind_check",
      sql`${table.kind} IN ('community', 'announcement', 'group', 'unknown')`,
    ),
  ],
);

export const menaWhatsAppAutoReplyEvents = pgTable(
  "mena_whatsapp_auto_reply_events",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    instanceName: text("instance_name").notNull(),
    remoteMessageId: text("remote_message_id").notNull(),
    status: text("status")
      .$type<"queued" | "processing" | "sending" | "sent" | "failed" | "unknown">()
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    replyMessageId: text("reply_message_id"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_auto_reply_events_message_key").on(
      table.workspaceId,
      table.instanceName,
      table.remoteMessageId,
    ),
    index("mena_whatsapp_auto_reply_events_pending_idx").on(
      table.status,
      table.nextRunAt,
    ),
    index("mena_whatsapp_auto_reply_events_lease_idx").on(
      table.status,
      table.leaseExpiresAt,
    ),
    check(
      "mena_whatsapp_auto_reply_events_status_check",
      sql`${table.status} IN ('queued', 'processing', 'sending', 'sent', 'failed', 'unknown')`,
    ),
    check(
      "mena_whatsapp_auto_reply_events_attempts_check",
      sql`${table.attempts} >= 0 AND ${table.attempts} <= 3`,
    ),
  ],
);

export const menaWhatsAppDirectMessages = pgTable(
  "mena_whatsapp_direct_messages",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    instanceName: text("instance_name").notNull(),
    remoteJidHash: text("remote_jid_hash").notNull(),
    encryptedRemoteJid: text("encrypted_remote_jid").notNull(),
    providerMessageId: text("provider_message_id"),
    clientRequestId: text("client_request_id"),
    direction: text("direction").$type<"inbound" | "outbound">().notNull(),
    status: text("status")
      .$type<"received" | "sending" | "sent" | "failed" | "unknown">()
      .notNull()
      .default("received"),
    errorCode: text("error_code"),
    encryptedTextBody: text("encrypted_text_body").notNull(),
    messageTimestamp: timestamp("message_timestamp", { withTimezone: true })
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_direct_messages_provider_id_key")
      .on(
        table.workspaceId,
        table.instanceName,
        table.remoteJidHash,
        table.providerMessageId,
      )
      .where(sql`${table.providerMessageId} IS NOT NULL`),
    uniqueIndex("mena_whatsapp_direct_messages_client_request_key")
      .on(table.workspaceId, table.instanceName, table.clientRequestId)
      .where(sql`${table.clientRequestId} IS NOT NULL`),
    index("mena_whatsapp_direct_messages_conversation_idx").on(
      table.workspaceId,
      table.instanceName,
      table.remoteJidHash,
      table.messageTimestamp,
    ),
    index("mena_whatsapp_direct_messages_expiry_idx").on(table.expiresAt),
    foreignKey({
      columns: [table.workspaceId, table.instanceName],
      foreignColumns: [
        menaWhatsAppConnections.workspaceId,
        menaWhatsAppConnections.instanceName,
      ],
      name: "mena_whatsapp_direct_messages_connection_fk",
    }).onDelete("cascade"),
    check(
      "mena_whatsapp_direct_messages_direction_check",
      sql`${table.direction} IN ('inbound', 'outbound')`,
    ),
    check(
      "mena_whatsapp_direct_messages_status_check",
      sql`${table.status} IN ('received', 'sending', 'sent', 'failed', 'unknown')`,
    ),
    check(
      "mena_whatsapp_direct_messages_text_length_check",
      sql`length(${table.encryptedTextBody}) <= 6000`,
    ),
  ],
);

/**
 * Attachments belonging to a one-to-one WhatsApp message.
 *
 * The group media pipeline uses `mena_whatsapp_message_media`, whose identity
 * is built around a group JID/id. A direct conversation has no group identity,
 * so its media needs its own table: the same storage and signing primitives
 * are reused, but the row is keyed by the direct message and its provider id.
 * The binary never lives in PostgreSQL — only identifiers and state do.
 */
export const menaWhatsAppDirectMessageMedia = pgTable(
  "mena_whatsapp_direct_message_media",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    instanceName: text("instance_name").notNull(),
    directMessageId: text("direct_message_id")
      .notNull()
      .references(() => menaWhatsAppDirectMessages.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id"),
    remoteJidHash: text("remote_jid_hash").notNull(),
    mediaIndex: integer("media_index").notNull().default(0),
    mediaType: text("media_type").notNull(),
    mimeType: text("mime_type"),
    fileName: text("file_name"),
    sizeBytes: integer("size_bytes"),
    /** Provider URL or directPath, kept as metadata only — never trusted as a signed URL. */
    sourceUrl: text("source_url"),
    /** Message key + sanitized source message, needed to ask Evolution for the binary. */
    sourceMetadata: jsonb("source_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sha256: text("sha256"),
    storageKey: text("storage_key"),
    storagePath: text("storage_path"),
    storageProvider: text("storage_provider").notNull().default("local"),
    thumbnailPath: text("thumbnail_path"),
    downloadStatus: text("download_status")
      .$type<"pending" | "stored" | "failed">()
      .notNull()
      .default("pending"),
    errorCode: text("error_code"),
    downloadAttempts: integer("download_attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_direct_media_provider_key")
      .on(
        table.workspaceId,
        table.instanceName,
        table.remoteJidHash,
        table.providerMessageId,
        table.mediaIndex,
        table.mediaType,
      )
      .where(sql`${table.providerMessageId} IS NOT NULL`),
    uniqueIndex("mena_whatsapp_direct_media_message_key").on(
      table.directMessageId,
      table.mediaIndex,
      table.mediaType,
    ),
    index("mena_whatsapp_direct_media_conversation_idx").on(
      table.workspaceId,
      table.instanceName,
      table.remoteJidHash,
      table.createdAt,
    ),
    index("mena_whatsapp_direct_media_retry_idx").on(
      table.workspaceId,
      table.downloadStatus,
      table.nextAttemptAt,
    ),
    foreignKey({
      columns: [table.workspaceId, table.instanceName],
      foreignColumns: [
        menaWhatsAppConnections.workspaceId,
        menaWhatsAppConnections.instanceName,
      ],
      name: "mena_whatsapp_direct_media_connection_fk",
    }).onDelete("cascade"),
    check(
      "mena_whatsapp_direct_media_index_check",
      sql`${table.mediaIndex} >= 0`,
    ),
    check(
      "mena_whatsapp_direct_media_status_check",
      sql`${table.downloadStatus} IN ('pending', 'stored', 'failed')`,
    ),
  ],
);

export const menaWhatsAppGroupSelections = pgTable(
  "mena_whatsapp_group_selections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    ownerId: text("owner_id").notNull(),
    instanceName: text("instance_name").notNull(),
    groupJid: text("group_jid").notNull(),
    groupId: text("group_id"),
    groupName: text("group_name").notNull(),
    selected: boolean("selected").notNull().default(true),
    canPublish: boolean("can_publish").notNull(),
    participantRole: text("participant_role").notNull(),
    announcementOnly: boolean("announcement_only").notNull(),
    participantCount: integer("participant_count"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex(
      "mena_whatsapp_group_selections_workspace_instance_group_jid_key",
    ).on(table.workspaceId, table.instanceName, table.groupJid),
    uniqueIndex(
      "mena_whatsapp_group_selections_workspace_instance_group_id_key",
    ).on(table.workspaceId, table.instanceName, table.groupId),
    index("mena_whatsapp_group_selections_workspace_idx").on(
      table.workspaceId,
      table.instanceName,
      table.groupJid,
    ),
    foreignKey({
      columns: [table.ownerId, table.workspaceId],
      foreignColumns: [
        menaWhatsAppConnections.ownerId,
        menaWhatsAppConnections.workspaceId,
      ],
      name: "mena_whatsapp_group_selections_connection_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.groupId, table.workspaceId, table.instanceName],
      foreignColumns: [
        menaWhatsAppGroups.id,
        menaWhatsAppGroups.workspaceId,
        menaWhatsAppGroups.instanceName,
      ],
      name: "mena_whatsapp_group_selections_group_fk",
    }).onDelete("restrict"),
  ],
);

export const menaWhatsAppSyncStates = pgTable(
  "mena_whatsapp_sync_states",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    instanceName: text("instance_name").notNull(),
    groupJid: text("group_jid").notNull(),
    groupId: text("group_id"),
    status: text("status").notNull().default("idle"),
    lastCursor: text("last_cursor"),
    lastMessageId: text("last_message_id"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    importedCount: integer("imported_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_sync_states_owner_instance_group_key").on(
      table.ownerId,
      table.instanceName,
      table.groupJid,
    ),
    uniqueIndex("mena_whatsapp_sync_states_workspace_instance_group_id_key").on(
      table.workspaceId,
      table.instanceName,
      table.groupId,
    ),
    index("mena_whatsapp_sync_states_workspace_idx").on(
      table.workspaceId,
      table.instanceName,
      table.groupJid,
    ),
    foreignKey({
      columns: [table.groupId, table.workspaceId, table.instanceName],
      foreignColumns: [
        menaWhatsAppGroups.id,
        menaWhatsAppGroups.workspaceId,
        menaWhatsAppGroups.instanceName,
      ],
      name: "mena_whatsapp_sync_states_group_fk",
    }).onDelete("restrict"),
  ],
);

export const menaWhatsAppMessages = pgTable(
  "mena_whatsapp_messages",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    instanceName: text("instance_name").notNull(),
    groupJid: text("group_jid").notNull(),
    groupId: text("group_id"),
    providerRemoteJid: text("provider_remote_jid"),
    providerRemoteJidAlt: text("provider_remote_jid_alt"),
    remoteMessageId: text("remote_message_id").notNull(),
    senderId: text("sender_id"),
    senderName: text("sender_name"),
    fromMe: boolean("from_me").notNull().default(false),
    messageType: text("message_type").notNull(),
    textBody: text("text_body"),
    caption: text("caption"),
    mediaAvailable: boolean("media_available").notNull().default(false),
    mediaGroupId: text("media_group_id"),
    mediaGroupIsAlbum: boolean("media_group_is_album").notNull().default(false),
    mediaGroupSource: text("media_group_source").$type<
      "protocol_association" | "provider_album_container" | null
    >(),
    mediaGroupExpectedCount: integer("media_group_expected_count"),
    mediaGroupIndex: integer("media_group_index"),
    mediaDownloadStatus: text("media_download_status")
      .notNull()
      .default("not_required"),
    mediaDownloadError: text("media_download_error"),
    sourceMediaPayload: jsonb("source_media_payload").$type<Array<
      Record<string, unknown>
    > | null>(),
    messageStatus: text("message_status").notNull().default("received"),
    source: text("source").notNull().default("import"),
    messageTimestamp: timestamp("message_timestamp", { withTimezone: true }),
    replyToRemoteId: text("reply_to_remote_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_messages_owner_instance_group_remote_id_key").on(
      table.ownerId,
      table.instanceName,
      table.groupJid,
      table.remoteMessageId,
    ),
    uniqueIndex(
      "mena_whatsapp_messages_owner_instance_group_id_remote_id_key",
    ).on(
      table.ownerId,
      table.instanceName,
      table.groupId,
      table.remoteMessageId,
    ),
    index("mena_whatsapp_messages_workspace_idx").on(
      table.workspaceId,
      table.instanceName,
      table.groupJid,
    ),
    foreignKey({
      columns: [table.groupId, table.workspaceId, table.instanceName],
      foreignColumns: [
        menaWhatsAppGroups.id,
        menaWhatsAppGroups.workspaceId,
        menaWhatsAppGroups.instanceName,
      ],
      name: "mena_whatsapp_messages_group_fk",
    }).onDelete("restrict"),
    check(
      "mena_whatsapp_messages_media_group_source_check",
      sql`${table.mediaGroupSource} IS NULL OR ${table.mediaGroupSource} IN ('protocol_association', 'provider_album_container')`,
    ),
  ],
);

export const menaWhatsAppMessageMedia = pgTable(
  "mena_whatsapp_message_media",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    instanceName: text("instance_name").notNull(),
    groupJid: text("group_jid").notNull(),
    groupId: text("group_id"),
    messageId: text("message_id").notNull(),
    mediaIndex: integer("media_index").notNull().default(0),
    mediaType: text("media_type").notNull(),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    storageKey: text("storage_key").notNull(),
    storagePath: text("storage_path").notNull(),
    storageProvider: text("storage_provider").notNull().default("local"),
    thumbnailPath: text("thumbnail_path"),
    sha256: text("sha256"),
    downloadStatus: text("download_status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    downloadAttempts: integer("download_attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_message_media_unique_key").on(
      table.ownerId,
      table.instanceName,
      table.groupJid,
      table.messageId,
      table.mediaIndex,
      table.mediaType,
    ),
    uniqueIndex("mena_whatsapp_message_media_group_id_unique_key").on(
      table.ownerId,
      table.instanceName,
      table.groupId,
      table.messageId,
      table.mediaIndex,
      table.mediaType,
    ),
    index("mena_whatsapp_message_media_workspace_idx").on(
      table.workspaceId,
      table.instanceName,
      table.groupJid,
    ),
    foreignKey({
      columns: [table.groupId, table.workspaceId, table.instanceName],
      foreignColumns: [
        menaWhatsAppGroups.id,
        menaWhatsAppGroups.workspaceId,
        menaWhatsAppGroups.instanceName,
      ],
      name: "mena_whatsapp_message_media_group_fk",
    }).onDelete("restrict"),
    index("mena_whatsapp_message_media_retry_idx").on(
      table.workspaceId,
      table.downloadStatus,
      table.nextAttemptAt,
    ),
    index("mena_whatsapp_message_media_workspace_sha256_idx").on(
      table.workspaceId,
      table.sha256,
      table.downloadStatus,
    ),
  ],
);

/**
 * A customer's automation consent, scoped to one workspace and to the same
 * conversation identity the direct messages already use (`remote_jid_hash`).
 * One row per customer/workspace: opt-in and opt-out update that row instead
 * of creating history duplicates.
 */
export const menaWhatsAppOptOuts = pgTable(
  "mena_whatsapp_opt_outs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    customerId: text("customer_id").notNull(),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }).notNull(),
    optedInAt: timestamp("opted_in_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mena_whatsapp_opt_outs_workspace_customer_key").on(
      table.workspaceId,
      table.customerId,
    ),
    index("mena_whatsapp_opt_outs_workspace_idx").on(table.workspaceId),
  ],
);

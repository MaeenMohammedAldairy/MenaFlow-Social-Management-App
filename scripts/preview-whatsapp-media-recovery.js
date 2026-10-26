import { createRequire } from "node:module";
import path from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

for (const file of [
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../.env2"),
]) {
  try {
    process.loadEnvFile(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required to preview WhatsApp media recovery.",
  );
}

const { Client } = createRequire(
  path.resolve(__dirname, "../lib/db/package.json"),
)("pg");

async function localFileExists(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  try {
    const file = await stat(filePath);
    return file.isFile() && file.size > 0;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT")
      return false;
    throw error;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const columns = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('mena_whatsapp_messages', 'mena_whatsapp_message_media')
    `);
    const availableColumns = new Map();
    for (const row of columns.rows) {
      const tableColumns = availableColumns.get(row.table_name) ?? new Set();
      tableColumns.add(row.column_name);
      availableColumns.set(row.table_name, tableColumns);
    }
    const messageColumns =
      availableColumns.get("mena_whatsapp_messages") ?? new Set();
    const mediaColumns =
      availableColumns.get("mena_whatsapp_message_media") ?? new Set();
    if (messageColumns.size === 0 || mediaColumns.size === 0) {
      throw new Error(
        "WhatsApp message tables do not exist; apply the database migrations first.",
      );
    }

    const optionalMessage = (column, alias) =>
      messageColumns.has(column)
        ? `message.${column} AS ${alias}`
        : `NULL AS ${alias}`;
    const optionalMedia = (column, alias) =>
      mediaColumns.has(column)
        ? `media.${column} AS ${alias}`
        : `NULL AS ${alias}`;
    const result = await client.query(`
      SELECT
        message.id,
        message.remote_message_id,
        message.owner_id,
        message.instance_name,
        message.group_jid,
        message.sender_id,
        message.message_type,
        message.text_body,
        message.caption,
        message.media_available,
        message.message_timestamp,
        message.created_at,
        ${optionalMessage("media_group_id", "media_group_id")},
        ${optionalMessage("media_group_is_album", "media_group_is_album")},
        ${optionalMessage("media_group_expected_count", "media_group_expected_count")},
        ${optionalMessage("source_media_payload", "source_media_payload")},
        ${optionalMessage("media_download_status", "media_download_status")},
        ${optionalMessage("media_download_error", "media_download_error")},
        media.id AS media_id,
        media.media_index,
        media.media_type,
        media.download_status,
        media.storage_key,
        media.storage_path,
        media.failure_reason,
        ${optionalMedia("download_attempts", "download_attempts")},
        ${optionalMedia("last_attempt_at", "last_attempt_at")},
        ${optionalMedia("next_attempt_at", "next_attempt_at")},
        ${optionalMedia("last_error", "last_error")}
      FROM mena_whatsapp_messages AS message
      LEFT JOIN mena_whatsapp_message_media AS media
        ON media.workspace_id = message.workspace_id
        AND media.message_id = message.id
      WHERE message.message_status <> 'deleted'
        AND (
          message.media_available = TRUE
          OR message.media_group_id IS NOT NULL
          OR message.text_body IS NOT NULL
          OR message.caption IS NOT NULL
        )
      ORDER BY message.created_at DESC, media.media_index ASC
      LIMIT 5000
    `);

    const messages = new Map();
    for (const row of result.rows) {
      let message = messages.get(row.id);
      if (!message) {
        message = {
          id: row.id,
          remoteMessageId: row.remote_message_id,
          ownerId: row.owner_id,
          instanceName: row.instance_name,
          groupJid: row.group_jid,
          senderId: row.sender_id,
          messageType: row.message_type,
          text: row.text_body,
          caption: row.caption,
          mediaAvailable: row.media_available,
          mediaGroupId: row.media_group_id,
          mediaGroupIsAlbum: row.media_group_is_album,
          expectedCount: row.media_group_expected_count,
          messageDownloadStatus: row.media_download_status,
          messageDownloadError: row.media_download_error,
          sourceMedia: asArray(row.source_media_payload),
          messageTimestamp: row.message_timestamp,
          createdAt: row.created_at,
          media: [],
        };
        messages.set(row.id, message);
      }
      if (row.media_id) {
        message.media.push({
          id: row.media_id,
          index: row.media_index,
          type: row.media_type,
          status: row.download_status,
          storageKey: row.storage_key,
          storagePath: row.storage_path,
          fileExists: await localFileExists(row.storage_path),
          failureReason: row.failure_reason,
          attempts: row.download_attempts,
          lastAttemptAt: row.last_attempt_at,
          nextAttemptAt: row.next_attempt_at,
          lastError: row.last_error,
        });
      }
    }

    const allMessages = [...messages.values()];
    const contentGroups = new Map();
    for (const message of allMessages) {
      const key = message.mediaGroupId ?? `message:${message.id}`;
      const group = contentGroups.get(key) ?? [];
      group.push(message);
      contentGroups.set(key, group);
    }

    const groups = [];
    for (const [key, groupMessages] of contentGroups) {
      const media = groupMessages.flatMap((message) => message.media);
      const storedCount = media.filter(
        (item) => item.status === "stored" && item.fileExists,
      ).length;
      const expectedCount = Math.max(
        0,
        ...groupMessages.map((message) => message.expectedCount ?? 0),
      );
      const recoverableFiles = groupMessages.reduce((total, message) => {
        const storedIndexes = new Set(
          message.media
            .filter((item) => item.status === "stored" && item.fileExists)
            .map((item) => item.index),
        );
        return (
          total +
          message.sourceMedia.filter(
            (item) =>
              item &&
              typeof item === "object" &&
              item.sourceMessage &&
              typeof item.sourceMessage === "object" &&
              item.messageKey &&
              typeof item.messageKey === "object" &&
              !storedIndexes.has(item.mediaIndex),
          ).length
        );
      }, 0);
      const reasons = [];
      if (expectedCount > storedCount)
        reasons.push("EXPECTED_MEDIA_NOT_STORED");
      if (media.some((item) => item.status === "failed"))
        reasons.push("MEDIA_DOWNLOAD_FAILED");
      if (media.some((item) => item.status === "stored" && !item.fileExists)) {
        reasons.push("STORAGE_FILE_MISSING");
      }
      if (
        groupMessages.some(
          (message) =>
            message.mediaAvailable &&
            !message.media.some(
              (item) => item.status === "stored" && item.fileExists,
            ),
        )
      )
        reasons.push("MESSAGE_HAS_NO_USABLE_STORED_MEDIA");
      if (
        groupMessages.some(
          (message) =>
            message.mediaAvailable &&
            message.media.length === 0 &&
            message.sourceMedia.length === 0,
        )
      )
        reasons.push("ORIGINAL_MEDIA_PAYLOAD_UNAVAILABLE");
      if (
        groupMessages.some(
          (message) =>
            message.mediaGroupIsAlbum && message.expectedCount === null,
        )
      ) {
        reasons.push("ALBUM_COMPLETION_NOT_PROVEN");
      }
      groups.push({
        groupKey: key,
        groupJid: groupMessages[0]?.groupJid,
        senderIds: [
          ...new Set(
            groupMessages.map((message) => message.senderId).filter(Boolean),
          ),
        ],
        messages: groupMessages.map((message) => ({
          id: message.id,
          remoteMessageId: message.remoteMessageId,
          messageType: message.messageType,
          senderId: message.senderId,
          text: message.text,
          caption: message.caption,
          messageTimestamp: message.messageTimestamp,
          mediaGroupId: message.mediaGroupId,
          mediaAvailable: message.mediaAvailable,
          sourceMediaCount: message.sourceMedia.length,
          media: message.media,
        })),
        discoveredTexts: [
          ...new Set(
            groupMessages.flatMap((message) =>
              [message.text, message.caption].filter(
                (text) => typeof text === "string" && text.trim(),
              ),
            ),
          ),
        ],
        expectedCount,
        storedCount,
        recoverableFiles,
        reasons: [...new Set(reasons)],
      });
    }

    const candidates = [];
    for (const textMessage of allMessages.filter(
      (message) =>
        !message.mediaAvailable &&
        Boolean(message.text?.trim() || message.caption?.trim()),
    )) {
      const nearbyGroups = groups.filter(
        (group) =>
          group.groupJid === textMessage.groupJid &&
          group.groupKey !==
            (textMessage.mediaGroupId ?? `message:${textMessage.id}`) &&
          group.senderIds.includes(textMessage.senderId) &&
          group.messages.some((message) => message.mediaAvailable) &&
          group.messages.some((message) => {
            const timestamp = new Date(
              message.messageTimestamp ?? message.createdAt,
            ).getTime();
            const textTimestamp = new Date(
              textMessage.messageTimestamp ?? textMessage.createdAt,
            ).getTime();
            return (
              Number.isFinite(timestamp) &&
              Number.isFinite(textTimestamp) &&
              Math.abs(timestamp - textTimestamp) <= 30_000
            );
          }),
      );
      for (const candidate of nearbyGroups) {
        candidates.push({
          textMessageId: textMessage.id,
          textRemoteMessageId: textMessage.remoteMessageId,
          candidateGroupKey: candidate.groupKey,
          candidateMessageIds: candidate.messages.map((message) => message.id),
          relation: "REVIEW_ONLY_TIME_GROUP_AND_SENDER_CLUES",
          autoMergeAllowed: false,
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          readOnly: true,
          modifiedRows: 0,
          messageCount: allMessages.length,
          groupCount: groups.length,
          candidateCount: candidates.length,
          warning:
            "Candidates use timing, group, and sender only as review clues. This preview never merges, downloads, or updates records.",
          groups: groups.filter((group) => group.reasons.length > 0),
          candidates,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("WhatsApp media recovery preview failed:", error.message);
  process.exitCode = 1;
});

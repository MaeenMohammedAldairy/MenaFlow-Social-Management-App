function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function extractWhatsAppTextFromMessage(
  value: Record<string, unknown> | null,
): string | null {
  if (!value) return null;
  const pending: Record<string, unknown>[] = [value];
  const seen = new Set<Record<string, unknown>>();
  const directText: string[] = [];
  const captions: string[] = [];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    const extendedText = asRecord(current.extendedTextMessage);
    for (const candidate of [
      current.conversation,
      current.text,
      extendedText?.text,
    ]) {
      const text = normalizeText(candidate);
      if (text) directText.push(text);
    }

    for (const candidate of [
      current.caption,
      asRecord(current.imageMessage)?.caption,
      asRecord(current.videoMessage)?.caption,
      asRecord(current.documentMessage)?.caption,
      asRecord(current.audioMessage)?.caption,
      asRecord(current.stickerMessage)?.text,
      asRecord(current.albumMessage)?.caption,
    ]) {
      const text = normalizeText(candidate);
      if (text) captions.push(text);
    }

    for (const wrapper of [
      current.message,
      asRecord(current.ephemeralMessage)?.message,
      asRecord(current.viewOnceMessage)?.message,
      asRecord(current.viewOnceMessageV2)?.message,
      asRecord(current.viewOnceMessageV2Extension)?.message,
    ]) {
      const nested = asRecord(wrapper);
      if (nested) pending.push(nested);
    }

    const albumMessages = asRecord(current.albumMessage)?.messages;
    if (Array.isArray(albumMessages)) {
      for (const item of albumMessages) {
        const nested = asRecord(item);
        if (nested) pending.push(nested);
      }
    }
  }

  const texts = [...new Set(directText.length > 0 ? directText : captions)];
  return texts.length > 0 ? texts.join("\n") : null;
}

function walkRecords(value: unknown, visit: (record: Record<string, unknown>) => void): void {
  const seen = new Set<object>();
  const pending: unknown[] = [value];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    visit(record);
    pending.push(...Object.values(record));
  }
}

export type WhatsAppAlbumAssociation = {
  parentMessageId: string;
  parentRemoteJid: string | null;
  messageIndex: number | null;
};

function isMediaAlbumAssociationType(value: unknown): boolean {
  return value === 1 ||
    (typeof value === "string" && value.toUpperCase() === "MEDIA_ALBUM");
}

export function hasWhatsAppAlbumAssociation(value: unknown): boolean {
  let found = false;
  walkRecords(value, (record) => {
    if (isMediaAlbumAssociationType(asRecord(record.messageAssociation)?.associationType)) {
      found = true;
    }
  });
  return found;
}

export function extractWhatsAppAlbumAssociation(value: unknown): WhatsAppAlbumAssociation | null {
  let association: WhatsAppAlbumAssociation | null = null;
  walkRecords(value, (record) => {
    if (association) return;
    const messageAssociation = asRecord(record.messageAssociation);
    if (!messageAssociation) return;
    if (!isMediaAlbumAssociationType(messageAssociation.associationType)) return;
    const parentKey = asRecord(messageAssociation.parentMessageKey);
    const parentMessageId = normalizeText(parentKey?.id);
    if (!parentMessageId) return;
    association = {
      parentMessageId,
      parentRemoteJid: normalizeRemoteJid(parentKey?.remoteJid),
      messageIndex:
        typeof messageAssociation.messageIndex === "number" &&
        Number.isInteger(messageAssociation.messageIndex) &&
        messageAssociation.messageIndex >= 0
          ? messageAssociation.messageIndex
          : null,
    };
  });
  return association;
}

export function isWhatsAppAlbumContainer(value: unknown): boolean {
  let found = false;
  walkRecords(value, (record) => {
    if (record.albumMessage && typeof record.albumMessage === "object") found = true;
  });
  return found;
}

export function extractWhatsAppWebhookBatch(value: unknown): Record<string, unknown>[] | null {
  const envelope = asRecord(value);
  if (!envelope) return null;
  const data = envelope.data;
  const dataRecord = asRecord(data);
  const batch = Array.isArray(data)
    ? data
    : Array.isArray(dataRecord?.messages)
      ? dataRecord.messages
      : Array.isArray(envelope.messages)
        ? envelope.messages
        : null;
  return batch
    ? batch.map(asRecord).filter((item): item is Record<string, unknown> => item !== null)
    : null;
}

export function hasWhatsAppMessageContent(value: unknown): boolean {
  if (extractMediaItemsFromMessage(asRecord(value)).length > 0) return true;
  if (
    hasWhatsAppAlbumAssociation(value) ||
    isWhatsAppAlbumContainer(value) ||
    extractWhatsAppMediaGroupExpectedCount(value) !== null
  ) {
    return true;
  }
  let hasText = false;
  walkRecords(value, (record) => {
    if (hasText) return;
    hasText = ["conversation", "text", "caption"].some(
      (field) => typeof record[field] === "string" && Boolean((record[field] as string).trim()),
    );
  });
  return hasText;
}

export function normalizeRemoteJid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractRemoteJidFromEnvelope(value: unknown): string | null {
  const seen = new Set<unknown>();

  function walk(node: unknown): string | null {
    if (node === null || node === undefined) return null;
    if (seen.has(node)) return null;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const entry of node) {
        const remoteJid = walk(entry);
        if (remoteJid) return remoteJid;
      }
      return null;
    }

    const record = asRecord(node);
    if (!record) return null;

    for (const key of ["remoteJid", "groupJid", "chatJid", "remotejid"]) {
      const remoteJid = normalizeRemoteJid(record[key]);
      if (remoteJid && remoteJid.includes("@")) return remoteJid;
    }

    for (const nested of Object.values(record)) {
      const remoteJid = walk(nested);
      if (remoteJid) return remoteJid;
    }

    return null;
  }

  return walk(value);
}

export function extractRemoteMessageIdFromEnvelope(value: unknown): string | null {
  const envelope = asRecord(value);
  if (!envelope) return null;

  const key = asRecord(envelope.key);
  const message = asRecord(envelope.message) ?? asRecord(envelope.data);
  const candidates = [
    key?.id,
    envelope.id,
    message?.id,
    envelope.remoteMessageId,
    key?.remoteMessageId,
  ];

  for (const candidate of candidates) {
    const id = normalizeText(candidate);
    if (id) return id;
  }

  return null;
}

function normalizeMediaType(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "unknown";
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("application/")) return "document";
  return "media";
}

export function extractMediaDetailsFromMessage(message: Record<string, unknown> | null): {
  mediaType: string;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  mediaUrl: string | null;
  base64Data: string | null;
  sourceSha256: string | null;
  caption: string | null;
} | null {
  return extractMediaItemsFromMessage(message)[0] ?? null;
}

export type WhatsAppMediaDetails = {
  mediaType: string;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  mediaUrl: string | null;
  base64Data: string | null;
  sourceSha256: string | null;
  caption: string | null;
  sourceMessage: Record<string, unknown>;
};

export function extractMediaItemsFromMessage(
  message: Record<string, unknown> | null,
): WhatsAppMediaDetails[] {
  if (!message) return [];

  const nested = asRecord(message.message);
  const album = asRecord(message.albumMessage) ?? asRecord(nested?.albumMessage);
  const albumItems = Array.isArray(album?.messages) ? album.messages : [];
  const sharedCaption = normalizeText(
    message.caption ?? message.conversation ?? nested?.caption ?? nested?.conversation ?? album?.caption,
  );
  const sources = albumItems.length > 0
    ? albumItems.map(asRecord).filter((item): item is Record<string, unknown> => item !== null)
    : [message];
  const output: WhatsAppMediaDetails[] = [];

  for (const source of sources) {
    const details = extractSingleMediaDetails(source);
    if (details) {
      output.push({
        ...details,
        caption: details.caption ?? sharedCaption,
        sourceMessage: source,
      });
    }
  }
  return output;
}

function extractSingleMediaDetails(message: Record<string, unknown>): Omit<WhatsAppMediaDetails, "sourceMessage"> | null {
  if (!message) return null;

  const nested = asRecord(message.message);
  const mediaNodes: unknown[] = [
    message.imageMessage,
    message.videoMessage,
    message.audioMessage,
    message.documentMessage,
    message.stickerMessage,
    message.pttMessage,
    message.voiceMessage,
    message.albumMessage,
    nested?.imageMessage,
    nested?.videoMessage,
    nested?.audioMessage,
    nested?.documentMessage,
    nested?.stickerMessage,
    nested?.pttMessage,
    nested?.voiceMessage,
    nested?.albumMessage,
    message.mediaMessage,
    nested?.mediaMessage,
  ];

  for (const node of mediaNodes) {
    const direct = asRecord(node);
    const candidate = direct && (direct.imageMessage || direct.videoMessage || direct.audioMessage || direct.documentMessage || direct.stickerMessage || direct.pttMessage || direct.voiceMessage || direct.albumMessage)
      ? asRecord(
          direct.imageMessage ??
          direct.videoMessage ??
          direct.audioMessage ??
          direct.documentMessage ??
          direct.stickerMessage ??
          direct.pttMessage ??
          direct.voiceMessage ??
          direct.albumMessage,
        )
      : direct;
    if (!candidate) continue;

    const mimeType =
      typeof candidate.mimetype === "string"
        ? candidate.mimetype
        : typeof candidate.mimeType === "string"
          ? candidate.mimeType
          : null;
    const fileName =
      typeof candidate.fileName === "string"
        ? candidate.fileName
        : typeof candidate.filename === "string"
          ? candidate.filename
          : null;
    const sizeBytes =
      typeof candidate.fileLength === "number"
        ? candidate.fileLength
        : typeof candidate.size === "number"
          ? candidate.size
          : null;
    const mediaUrl =
      typeof candidate.url === "string"
        ? candidate.url
        : typeof candidate.directPath === "string"
          ? candidate.directPath
          : null;
    const base64Data =
      typeof candidate.base64 === "string"
        ? candidate.base64
        : typeof candidate.data === "string"
          ? candidate.data
          : null;
    const sourceSha256 =
      typeof candidate.fileSha256 === "string"
        ? candidate.fileSha256
        : typeof candidate.file_sha256 === "string"
          ? candidate.file_sha256
          : null;
    if (!mimeType && !mediaUrl && !base64Data) continue;

    return {
      mediaType: normalizeMediaType(mimeType ?? ""),
      mimeType,
      fileName,
      sizeBytes,
      mediaUrl,
      base64Data,
      sourceSha256,
      caption:
        typeof candidate.caption === "string"
          ? candidate.caption.trim() || null
          : typeof message.caption === "string"
            ? message.caption.trim() || null
            : null,
    };
  }

  return null;
}

export function extractWhatsAppMediaGroupId(value: unknown): string | null {
  if (!asRecord(value)) return null;
  let marker: string | null = null;
  walkRecords(value, (record) => {
    if (marker) return;
    for (const field of [
      "mediaGroupId",
      "media_group_id",
      "albumId",
      "album_id",
      "groupedId",
      "grouped_id",
      "groupingKey",
      "grouping_key",
      "mediaGroupKey",
      "media_group_key",
    ]) {
      marker = normalizeText(record[field]);
      if (marker) return;
    }
  });
  if (marker) return marker;
  const association = extractWhatsAppAlbumAssociation(value);
  if (association) return `parent:${association.parentMessageId}`;
  return null;
}

export function extractWhatsAppMediaGroupExpectedCount(value: unknown): number | null {
  if (!asRecord(value)) return null;
  const countFields = [
    "mediaGroupExpectedCount",
    "expectedMediaCount",
    "mediaCount",
    "totalMediaCount",
    "itemCount",
    "totalItems",
  ];
  let expectedCount: number | null = null;
  walkRecords(value, (record) => {
    const association = asRecord(record.messageAssociation);
    const expectedImages = typeof association?.expectedImageCount === "number"
      ? association.expectedImageCount
      : 0;
    const expectedVideos = typeof association?.expectedVideoCount === "number"
      ? association.expectedVideoCount
      : 0;
    const associatedTotal = expectedImages + expectedVideos;
    if (Number.isInteger(associatedTotal) && associatedTotal > 0) {
      expectedCount = Math.max(expectedCount ?? 0, Math.min(associatedTotal, 100));
      return;
    }
    for (const field of countFields) {
      const candidate = record[field];
      if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) {
        expectedCount = Math.max(expectedCount ?? 0, Math.min(candidate, 100));
      }
    }
    const album = asRecord(record.albumMessage);
    if (!album) return;
    const containerImageCount = typeof album.expectedImageCount === "number" ? album.expectedImageCount : 0;
    const containerVideoCount = typeof album.expectedVideoCount === "number" ? album.expectedVideoCount : 0;
    const containerTotal = containerImageCount + containerVideoCount;
    if (Number.isInteger(containerTotal) && containerTotal > 0) {
      expectedCount = Math.max(expectedCount ?? 0, Math.min(containerTotal, 100));
    }
    if (Array.isArray(album.messages) && album.messages.length > 0) {
      expectedCount = Math.max(expectedCount ?? 0, Math.min(album.messages.length, 100));
    }
  });
  return expectedCount;
}

export function filterHistoryRecordsForGroup(records: unknown[], groupJid: string): unknown[] {
  return records.filter((record) => {
    const envelope = asRecord(record);
    const key = asRecord(envelope?.key);
    if (
      normalizeRemoteJid(key?.remoteJid) === groupJid ||
      normalizeRemoteJid(key?.remoteJidAlt) === groupJid
    ) {
      return true;
    }
    const remoteJid = extractRemoteJidFromEnvelope(record);
    return remoteJid === groupJid;
  });
}

export function isSelectedWhatsAppGroupMessage(
  selectedGroupJids: readonly string[],
  groupJid: string,
  remoteJid: string | null,
): boolean {
  return (
    groupJid.endsWith("@g.us") &&
    remoteJid === groupJid &&
    selectedGroupJids.includes(groupJid)
  );
}

export function normalizeWhatsAppWebhookEventName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[.-]/g, "_").toUpperCase();
  return normalized || null;
}

export function isWhatsAppMessageWebhookEvent(eventName: string | null): boolean {
  return (
    eventName === "MESSAGES_UPSERT" ||
    eventName === "MESSAGES_SET" ||
    eventName === "MESSAGES_DELETE" ||
    eventName === "MESSAGES_UPDATE"
  );
}

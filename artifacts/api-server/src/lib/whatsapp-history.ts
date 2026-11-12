export function buildWhatsAppHistoryQuery(
  groupJid: string,
  pageSize: number,
  jidField: "remoteJid" | "remoteJidAlt" = "remoteJid",
  page = 1,
): {
  where: {
    key: { remoteJid: string } | { remoteJidAlt: string };
  };
  offset: number;
  page: number;
} {
  const key =
    jidField === "remoteJid"
      ? { remoteJid: groupJid }
      : { remoteJidAlt: groupJid };
  return {
    where: { key },
    offset: pageSize,
    page,
  };
}

export function parseWhatsAppHistoryTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  const timestamp =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.isFinite(Number(value))
          ? Number(value)
          : Date.parse(value)
        : Number.NaN;
  if (!Number.isFinite(timestamp)) return null;
  const milliseconds =
    Math.abs(timestamp) >= 1_000_000_000_000 ? timestamp : timestamp * 1000;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function filterWhatsAppHistoryAfter(
  records: unknown[],
  since: Date,
): unknown[] {
  return records.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const message =
      record.message && typeof record.message === "object"
        ? (record.message as Record<string, unknown>)
        : record;
    const timestamp =
      record.messageTimestamp ?? record.timestamp ?? record.t ??
      message.messageTimestamp ?? message.timestamp ?? message.t;
    const date = parseWhatsAppHistoryTimestamp(timestamp);
    return date !== null && date.getTime() > since.getTime();
  });
}

export function filterWhatsAppHistoryFrom(
  records: unknown[],
  since: Date,
): unknown[] {
  return records.filter((value) => {
    const timestamp = getWhatsAppHistoryTimestamp(value);
    return timestamp !== null && timestamp.getTime() >= since.getTime();
  });
}

export function getWhatsAppHistoryMessageId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const key =
    record.key && typeof record.key === "object"
      ? (record.key as Record<string, unknown>)
      : null;
  if (typeof key?.id === "string" && key.id.length > 0) return key.id;
  if (typeof record.id === "string" && record.id.length > 0) return record.id;
  const message =
    record.message && typeof record.message === "object"
      ? (record.message as Record<string, unknown>)
      : null;
  return typeof message?.id === "string" && message.id.length > 0
    ? message.id
    : null;
}

export function isWhatsAppHistoryCandidate(
  record: unknown,
  fullyPersistedMessageIds: ReadonlySet<string>,
): boolean {
  const messageId = getWhatsAppHistoryMessageId(record);
  return !messageId || !fullyPersistedMessageIds.has(messageId);
}

export function getWhatsAppHistoryTimestamp(value: unknown): Date | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const message =
    record.message && typeof record.message === "object"
      ? (record.message as Record<string, unknown>)
      : record;
  const timestamp =
    record.messageTimestamp ?? record.timestamp ?? record.t ??
    message.messageTimestamp ?? message.timestamp ?? message.t;
  return parseWhatsAppHistoryTimestamp(timestamp);
}

export function isWhatsAppHistoryPageBeforeCursor(
  records: unknown[],
  cursor: Date,
): boolean {
  if (records.length === 0) return false;
  return records.every((record) => {
    const timestamp = getWhatsAppHistoryTimestamp(record);
    return timestamp !== null && timestamp.getTime() < cursor.getTime();
  });
}

export function extractWhatsAppHistoryRecords(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;

  const envelope = value as Record<string, unknown>;
  const nestedMessages = envelope.messages;
  if (Array.isArray(nestedMessages)) return nestedMessages;
  if (nestedMessages && typeof nestedMessages === "object") {
    const records = (nestedMessages as Record<string, unknown>).records;
    if (Array.isArray(records)) return records;
  }
  if (Array.isArray(envelope.records)) return envelope.records;
  if (Array.isArray(envelope.chats)) return envelope.chats;

  for (const key of ["data", "result"]) {
    const records = extractWhatsAppHistoryRecords(envelope[key]);
    if (records) return records;
  }
  return null;
}

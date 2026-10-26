export function buildWhatsAppHistoryQuery(
  groupJid: string,
  pageSize: number,
  jidField: "remoteJid" | "remoteJidAlt" = "remoteJid",
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
    page: 1,
  };
}

export function parseWhatsAppHistoryTimestamp(value: unknown): Date | null {
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

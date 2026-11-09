export type MetaInboxCursor = {
  occurredAt: Date;
  id: string;
};

export function encodeMetaInboxCursor(
  occurredAt: Date,
  id: string,
): string {
  return Buffer.from(
    JSON.stringify({ occurredAt: occurredAt.toISOString(), id }),
  ).toString("base64url");
}

export function parseMetaInboxCursor(value: string): MetaInboxCursor {
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (
    !parsed ||
    typeof parsed.occurredAt !== "string" ||
    typeof parsed.id !== "string" ||
    !parsed.id
  ) {
    throw new Error("INVALID_META_INBOX_CURSOR");
  }
  const occurredAt = new Date(parsed.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error("INVALID_META_INBOX_CURSOR");
  }
  return { occurredAt, id: parsed.id };
}

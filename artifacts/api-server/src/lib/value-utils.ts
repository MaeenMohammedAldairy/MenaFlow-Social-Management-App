export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function recordOrEmpty(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

export function queryString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

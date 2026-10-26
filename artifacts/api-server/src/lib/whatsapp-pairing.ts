function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function pairingCodeFrom(payload: unknown): string | null {
  const body = asRecord(payload);
  const data = asRecord(body?.data);
  const instance = asRecord(body?.instance);
  const dataInstance = asRecord(data?.instance);
  const qrCode = asRecord(body?.qrcode ?? body?.qrCode);
  const dataQrCode = asRecord(data?.qrcode ?? data?.qrCode);
  const instanceQrCode = asRecord(instance?.qrcode ?? instance?.qrCode);
  const dataInstanceQrCode = asRecord(
    dataInstance?.qrcode ?? dataInstance?.qrCode,
  );
  for (const candidate of [
    body?.pairingCode,
    qrCode?.pairingCode,
    instanceQrCode?.pairingCode,
    dataInstanceQrCode?.pairingCode,
    data?.pairingCode,
    dataQrCode?.pairingCode,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

export function pairingQrBase64From(payload: unknown): string | null {
  const body = asRecord(payload);
  const data = asRecord(body?.data);
  const instance = asRecord(body?.instance);
  const dataInstance = asRecord(data?.instance);
  const qrCode = asRecord(body?.qrcode ?? body?.qrCode);
  const dataQrCode = asRecord(data?.qrcode ?? data?.qrCode);
  const instanceQrCode = asRecord(instance?.qrcode ?? instance?.qrCode);
  const dataInstanceQrCode = asRecord(
    dataInstance?.qrcode ?? dataInstance?.qrCode,
  );
  for (const candidate of [
    body?.base64,
    qrCode?.base64,
    instanceQrCode?.base64,
    dataInstanceQrCode?.base64,
    data?.base64,
    dataQrCode?.base64,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

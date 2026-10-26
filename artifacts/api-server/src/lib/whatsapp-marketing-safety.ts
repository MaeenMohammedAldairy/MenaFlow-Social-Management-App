const privateContentPattern =
  /\b(otp|one[\s-]?time[\s-]?password|verification code|password|pin code|cvv|credit card|bank account)\b|رمز\s*(التحقق|التفعيل)|كلمة\s*المرور|رقم\s*البطاقة|حساب\s*بنكي/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const phonePattern = /(?:\+?\d[\d\s().-]{7,}\d)/;

export interface MarketingAssessment {
  eligible: boolean;
  title: string;
  facebook: string;
  instagram: string;
  reason: string;
}

export function normalizePhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function isBusinessAuthoredMessage(
  senderId: string | null | undefined,
  businessPhone: string | null | undefined,
): boolean {
  const sender = normalizePhone(senderId?.split("@")[0]);
  const business = normalizePhone(businessPhone);
  return Boolean(sender && business && sender === business);
}

export function resolveMessageSenderId(input: {
  fromMe: unknown;
  participant?: unknown;
  sender?: unknown;
}, businessPhone: string | null | undefined): string | null {
  if (input.fromMe === true && businessPhone) return businessPhone;
  if (typeof input.participant === "string") return input.participant;
  if (typeof input.sender === "string") return input.sender;
  return null;
}

export function containsSensitivePersonalData(text: string): boolean {
  return (
    privateContentPattern.test(text) ||
    emailPattern.test(text) ||
    phonePattern.test(text)
  );
}

export function canAnalyzeWhatsAppMessage(input: {
  isGroup: boolean;
  groupSelected: boolean;
  messageAvailable: boolean;
}): boolean {
  return input.isGroup && input.groupSelected && input.messageAvailable;
}

export function canAutoPublishMessage(input: {
  isGroup: boolean;
  businessAuthored: boolean;
  text: string;
  mediaReady: boolean;
  hasUnsupportedVideo: boolean;
}): boolean {
  return (
    input.isGroup &&
    input.businessAuthored &&
    !containsSensitivePersonalData(input.text) &&
    input.mediaReady &&
    !input.hasUnsupportedVideo
  );
}

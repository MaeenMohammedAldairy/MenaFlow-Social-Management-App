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
  groupCanPublish: boolean;
  messageAvailable: boolean;
}): boolean {
  return (
    input.isGroup &&
    input.groupSelected &&
    input.groupCanPublish &&
    input.messageAvailable
  );
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

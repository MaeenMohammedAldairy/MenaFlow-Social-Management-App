const OPT_OUT_PHRASES = new Set([
  "stop",
  "unsubscribe",
  "cancel subscription",
  "إلغاء",
  "الغاء",
  "إلغاء الاشتراك",
  "الغاء الاشتراك",
  "توقف",
  "أوقف",
  "اوقف",
  "وقف",
  "لا ترسل",
  "لا ترسلوا",
  "لا أريد رسائل",
  "لا اريد رسائل",
]);

export function isWhatsAppOptOutMessage(text: string | null): boolean {
  const normalized = (text ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[.!؟?،,]+$/u, "")
    .trim();
  return OPT_OUT_PHRASES.has(normalized);
}

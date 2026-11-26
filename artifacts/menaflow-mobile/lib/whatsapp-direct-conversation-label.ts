/**
 * One label, two sources. Evolution supplies the customer's display name in
 * `pushName`/`senderName`; the DM inbox exposes the saved value as
 * `senderName`. When there is no usable name the phone-derived
 * `customerNumber` remains the label, exactly as before.
 */
export function whatsappDirectConversationLabel(conversation: {
  senderName?: string | null;
  customerNumber: string;
}): string {
  const name = conversation.senderName?.trim();
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
    return conversation.customerNumber;
  }
  return name;
}

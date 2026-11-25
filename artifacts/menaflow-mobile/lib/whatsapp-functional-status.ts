/**
 * whatsapp-functional-status.ts
 *
 * The only two WhatsApp connection states a merchant needs to read: the
 * connection works, or the system is repairing it. Everything that explains
 * *how* (webhook registration, provider instances, logs, error codes) belongs
 * to the server and stays out of the UI.
 *
 * Pure and React Native-free so the exact wording is testable.
 */

export const WHATSAPP_WORKING_MESSAGE = "واتساب يعمل بشكل طبيعي";
export const WHATSAPP_REPAIRING_MESSAGE =
  "نعمل على إصلاح اتصال واتساب تلقائيًا.";

export type WhatsAppFunctionalStatus = {
  label: string;
  tone: "green" | "amber";
  message: string;
};

type InboundIssue = {
  severity?: string | null;
};

type InboundSummary = {
  deliveryConfirmed?: boolean | null;
  issues?: ReadonlyArray<InboundIssue> | null;
};

/**
 * A critical issue is a real inbound fault that the background repair path can
 * act on. A quiet new account with no messages yet is not a fault; showing a
 * repair promise there would be a false alarm.
 */
export function whatsAppFunctionalStatus(input: {
  connected: boolean;
  inbound?: InboundSummary | null;
}): WhatsAppFunctionalStatus {
  const repairing =
    input.connected &&
    (input.inbound?.issues ?? []).some(
      (issue) => issue?.severity === "critical",
    );

  if (repairing) {
    return {
      label: "جارٍ الإصلاح",
      tone: "amber",
      message: WHATSAPP_REPAIRING_MESSAGE,
    };
  }
  return {
    label: "متصل",
    tone: "green",
    message: WHATSAPP_WORKING_MESSAGE,
  };
}

/**
 * whatsapp-phone-ownership.ts
 *
 * One place for the rule that was missing: a WhatsApp number is owned, at most,
 * by one *active* workspace connection across the whole deployment.
 *
 * The normalization follows the mobile app's existing E.164 policy in
 * `artifacts/menaflow-mobile/lib/whatsapp-phone.ts`: Arabic-Indic and Persian
 * digits, a leading `00`, and local formatting are folded to international
 * digits before any comparison. This module stays pure — no database, no
 * network, no environment — so every ownership branch is testable.
 */

export const ACTIVE_WHATSAPP_CONNECTION_STATUSES = [
  "connecting",
  "connected",
] as const;

export type WhatsAppConnectionStatus = (typeof ACTIVE_WHATSAPP_CONNECTION_STATUSES)[number];

export function isActiveWhatsAppConnectionStatus(
  status: string | null | undefined,
): status is WhatsAppConnectionStatus {
  return (
    typeof status === "string" &&
    (ACTIVE_WHATSAPP_CONNECTION_STATUSES as readonly string[]).includes(status)
  );
}

export const WHATSAPP_NUMBER_OWNED_BY_ANOTHER_WORKSPACE =
  "WHATSAPP_NUMBER_OWNED_BY_ANOTHER_WORKSPACE";

export const WHATSAPP_NUMBER_OWNED_BY_ANOTHER_WORKSPACE_MESSAGE =
  "هذا الرقم مرتبط حاليًا بمساحة عمل أخرى ولا يمكن استخدامه هنا.";

function toLatinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

/**
 * Returns the international digits only (no `+`), or null when the value is
 * not a number this deployment can safely compare. A leading `+` is optional
 * for backward compatibility with older API clients; no country is invented
 * here because the mobile client already applies the device country policy.
 */
export function normalizeWhatsAppPhoneDigits(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const folded = toLatinDigits(input).trim().replace(/^00/, "+");
  const withoutFormatting = folded.replace(/[\s().-]/g, "");
  const match = /^\+?([1-9]\d{7,14})$/.exec(withoutFormatting);
  return match?.[1] ?? null;
}

export type WhatsAppPhoneOwnershipRow = {
  workspaceId: string;
  status: string | null;
  instanceName?: string | null;
};

export type WhatsAppPhoneOwnershipDecision =
  | { status: "available" }
  | { status: "same_workspace" }
  | {
      status: "owned_elsewhere";
      code: typeof WHATSAPP_NUMBER_OWNED_BY_ANOTHER_WORKSPACE;
      message: typeof WHATSAPP_NUMBER_OWNED_BY_ANOTHER_WORKSPACE_MESSAGE;
    };

/**
 * `rows` must be the complete set of connections holding this phone number.
 * `disconnected` and `failed` rows are history: they never grant ownership.
 */
export function decideWhatsAppPhoneOwnership(input: {
  digits: string;
  currentWorkspaceId: string;
  rows: readonly WhatsAppPhoneOwnershipRow[];
}): WhatsAppPhoneOwnershipDecision {
  let sameWorkspace = false;
  for (const row of input.rows) {
    if (!isActiveWhatsAppConnectionStatus(row.status)) continue;
    if (row.workspaceId !== input.currentWorkspaceId) {
      // Another active claim wins even if this workspace also has one: the
      // deployment must never pick an owner from an inconsistent state.
      return {
        status: "owned_elsewhere",
        code: WHATSAPP_NUMBER_OWNED_BY_ANOTHER_WORKSPACE,
        message: WHATSAPP_NUMBER_OWNED_BY_ANOTHER_WORKSPACE_MESSAGE,
      };
    }
    sameWorkspace = true;
  }
  return sameWorkspace ? { status: "same_workspace" } : { status: "available" };
}

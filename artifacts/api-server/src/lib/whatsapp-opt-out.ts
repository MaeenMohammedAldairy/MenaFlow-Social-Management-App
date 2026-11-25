/**
 * whatsapp-opt-out.ts
 *
 * Customer consent for WhatsApp automation. The old implementation only looked
 * at the message in the webhook, so a queued reply could still be sent after
 * the customer asked to stop. Consent is now a stored fact, scoped to a
 * workspace and to the conversation identity the direct messages already use.
 *
 * This module stays pure: the Drizzle implementation of `WhatsAppOptOutStore`
 * lives in `whatsapp-opt-out-store.ts`, so every race and lifetime rule is
 * testable without a database.
 */

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

const OPT_IN_PHRASES = new Set([
  "start",
  "ابدأ",
  "ابدا",
  "اشترك",
  "إعادة الاشتراك",
  "اعادة الاشتراك",
]);

function normalizeConsentPhrase(text: string | null): string {
  return (text ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[.!؟?،,]+$/u, "")
    .trim();
}

export function isWhatsAppOptOutMessage(text: string | null): boolean {
  return OPT_OUT_PHRASES.has(normalizeConsentPhrase(text));
}

export function isWhatsAppOptInMessage(text: string | null): boolean {
  return OPT_IN_PHRASES.has(normalizeConsentPhrase(text));
}

export type WhatsAppConsentAction = "opt_out" | "opt_in";

export function whatsAppConsentActionForMessage(
  text: string | null,
): WhatsAppConsentAction | null {
  if (isWhatsAppOptOutMessage(text)) return "opt_out";
  if (isWhatsAppOptInMessage(text)) return "opt_in";
  return null;
}

export type WhatsAppOptOutRecord = {
  workspaceId: string;
  customerId: string;
  optedOutAt: Date;
  /** Non-null means the customer actively re-subscribed; the row stays for audit. */
  optedInAt: Date | null;
};

export type WhatsAppOptOutStore = {
  find(input: {
    workspaceId: string;
    customerId: string;
  }): Promise<WhatsAppOptOutRecord | null>;
  optOut(input: {
    ownerId: string;
    workspaceId: string;
    customerId: string;
    at: Date;
  }): Promise<WhatsAppOptOutRecord>;
  optIn(input: {
    ownerId: string;
    workspaceId: string;
    customerId: string;
    at: Date;
  }): Promise<WhatsAppOptOutRecord>;
};

/** A row with `opted_in_at` is history, not an active opt-out. */
export function isActiveWhatsAppOptOut(
  record: WhatsAppOptOutRecord | null | undefined,
): boolean {
  return Boolean(record && record.optedInAt === null);
}

export async function recordWhatsAppConsent(input: {
  store: WhatsAppOptOutStore;
  ownerId: string;
  workspaceId: string;
  customerId: string;
  action: WhatsAppConsentAction;
  at?: Date;
}): Promise<WhatsAppOptOutRecord> {
  const at = input.at ?? new Date();
  if (input.action === "opt_out") {
    return input.store.optOut({
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      customerId: input.customerId,
      at,
    });
  }
  return input.store.optIn({
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    customerId: input.customerId,
    at,
  });
}

/** The single fresh read every automation path must make before sending. */
export async function isWhatsAppCustomerOptedOut(input: {
  store: WhatsAppOptOutStore;
  workspaceId: string;
  customerId: string;
}): Promise<boolean> {
  const record = await input.store.find({
    workspaceId: input.workspaceId,
    customerId: input.customerId,
  });
  return isActiveWhatsAppOptOut(record);
}

export type WhatsAppConsentLock = {
  run<T>(key: string, run: () => Promise<T>): Promise<T>;
};

export type WhatsAppAutomationGateResult<T> =
  | { status: "opted_out" }
  | { status: "allowed"; value: T };

/**
 * Holds one per-customer lock across the fresh read *and* the caller's send, so
 * a STOP that arrives mid-flight cannot be overtaken by an old queued job: it
 * either commits before the read (the job is dropped) or waits for the send to
 * finish and applies to later jobs.
 */
export async function withWhatsAppAutomationConsent<T>(input: {
  store: WhatsAppOptOutStore;
  lock: WhatsAppConsentLock;
  workspaceId: string;
  customerId: string;
  run: () => Promise<T>;
}): Promise<WhatsAppAutomationGateResult<T>> {
  return input.lock.run(
    `menaflow:whatsapp-opt-out:${input.workspaceId}:${input.customerId}`,
    async () => {
      if (
        await isWhatsAppCustomerOptedOut({
          store: input.store,
          workspaceId: input.workspaceId,
          customerId: input.customerId,
        })
      ) {
        return { status: "opted_out" } as const;
      }
      return { status: "allowed", value: await input.run() } as const;
    },
  );
}

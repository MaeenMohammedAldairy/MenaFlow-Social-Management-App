/**
 * What a data source is, in the words the merchant sees.
 *
 * The sources screen answers four questions about each of its three cards — is it
 * connected, what does the pill say, what does the line under the name say, and how
 * many cards need attention. They were written as closures inside a 2,494-line
 * component, which made them untestable: every branch of `sourceStatus` is a
 * claim shown to a merchant ("متصل", "يحتاج إعادة تفويض", "نسخة الخادم غير
 * موجودة"), and the states that produce them come from a server payload the client
 * does not control.
 *
 * The rules are lifted out unchanged so they can be asserted directly. The input is
 * deliberately structural rather than the generated response type: the screen passes
 * what the query gave it, including `undefined` while loading.
 *
 * Pure and free of React Native on purpose, in the style of
 * `lib/onboarding-guard.ts`.
 */

/** One source's connection state as the server reports it. */
export type SourceConnectionState = {
  authorizationStatus?: string | null;
  authorizationReason?: string | null;
  connectionState?: string | null;
  accountName?: string | null;
};

export type SourceConnections = {
  facebook?: SourceConnectionState | null;
  instagram?: SourceConnectionState | null;
  whatsapp?: SourceConnectionState | null;
};

export type SourceKey = "facebook" | "instagram" | "whatsapp";

export type MetaPlatform = "facebook" | "instagram";

const WHATSAPP_WORKING_MESSAGE = "واتساب يعمل بشكل طبيعي";
const WHATSAPP_REPAIRING_MESSAGE = "نعمل على إصلاح اتصال واتساب تلقائيًا.";

/**
 * Whether the connections payload is still unknown to the screen.
 *
 * While it is, no card may claim a state: "غير مربوط" during a load tells a
 * merchant with a linked page that they have none, which is the same mistake the
 * dashboard checklist used to make.
 */
export type SourceStatusContext = {
  isLoading: boolean;
};

/** A source is usable when its platform says so — the two families differ. */
export function isSourceConnected(
  connections: SourceConnections | null | undefined,
  key: SourceKey,
): boolean {
  if (key === "facebook" || key === "instagram") {
    return connections?.[key]?.authorizationStatus === "ready";
  }
  if (key === "whatsapp") {
    return connections?.whatsapp?.connectionState === "connected";
  }
  return false;
}

/** How many of the three cards are usable. WhatsApp is the only one this screen counts. */
export function connectedSourceCount(
  connections: SourceConnections | null | undefined,
): number {
  return isSourceConnected(connections, "whatsapp") ? 1 : 0;
}

/**
 * How many cards are saved but not working — the badge on the screen's header.
 *
 * A source that was never linked is not "needing attention"; it is simply not set
 * up, and counting it would put a permanent warning on a merchant who has not
 * started with WhatsApp yet.
 */
export function attentionSourceCount(
  connections: SourceConnections | null | undefined,
): number {
  return Boolean(connections?.whatsapp) &&
    !isSourceConnected(connections, "whatsapp")
    ? 1
    : 0;
}

/** Why a Meta connection needs re-authorising, in the merchant's words. */
export function metaReauthorizationReason(
  connections: SourceConnections | null | undefined,
  platform: MetaPlatform,
): string {
  const reason = connections?.[platform]?.authorizationReason;
  if (reason === "token_invalid") return "رمز Meta غير صالح أو مرفوض.";
  if (reason === "token_expired") return "انتهت صلاحية رمز Meta.";
  return "صلاحيات Meta تحتاج إلى تحقق.";
}

/** The short status pill for a source card. */
export function sourceStatus(
  connections: SourceConnections | null | undefined,
  key: SourceKey,
  context: SourceStatusContext,
): string {
  if (context.isLoading) return "جارٍ التحقق…";
  if (key === "facebook" || key === "instagram") {
    const connection = connections?.[key];
    if (!connection) return "غير مربوط";
    return connection.authorizationStatus === "needs_reauthorization"
      ? "يحتاج إعادة تفويض"
      : "متصل";
  }
  if (key === "whatsapp") {
    const connection = connections?.whatsapp;
    if (!connection) return "غير مربوط";
    if (isSourceConnected(connections, "whatsapp")) return "متصل";
    if (connection.connectionState === "connecting") return "جارٍ التحقق…";
    // Every saved-but-not-working state is repaired in the background. The
    // merchant only needs to know that the system is on it.
    return "جارٍ الإصلاح";
  }
  return "غير مربوط";
}

/**
 * The secondary line under a source name: the account identity when things are
 * fine, or the reason attention is needed when they are not. `null` means the card
 * shows one line only.
 */
export function sourceDetail(
  connections: SourceConnections | null | undefined,
  key: SourceKey,
  context: SourceStatusContext,
): string | null {
  if (context.isLoading) return null;
  if (key === "facebook" || key === "instagram") {
    const connection = connections?.[key];
    if (!connection) return null;
    if (connection.authorizationStatus === "needs_reauthorization") {
      return metaReauthorizationReason(connections, key);
    }
    return key === "facebook"
      ? `صفحة: ${connection.accountName ?? ""}`
      : `@${connection.accountName ?? ""}`;
  }
  if (key === "whatsapp") {
    const connection = connections?.whatsapp;
    if (!connection) return null;
    if (isSourceConnected(connections, "whatsapp")) {
      return WHATSAPP_WORKING_MESSAGE;
    }
    if (connection.connectionState === "connecting") {
      return "يتم التحقق من الاتصال تلقائيًا.";
    }
    return WHATSAPP_REPAIRING_MESSAGE;
  }
  return null;
}

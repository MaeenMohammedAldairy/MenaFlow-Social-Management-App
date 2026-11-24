/**
 * The dashboard's three channel cards, and the signals the rest of the screen reads
 * from them.
 *
 * The screen used to derive eleven facts from one connections payload inline —
 * three cards of eight fields each, then `hasAnyConnection`,
 * `whatsappUnavailable`, `whatsappConnecting`, `whatsappNeedsReconnection` and
 * `accountNeedingReauthorization` — inside a 1,839-line component with no test
 * covering any of it. Two of those derivations are the difference between a
 * merchant being told "اربط حسابًا للنشر" and being told "أعد تفويض حساب إنستغرام",
 * so they are worth asserting branch by branch.
 *
 * The two platform families really do differ: Meta reports `authorizationStatus`
 * (`ready` / `needs_reauthorization`), the WhatsApp provider reports
 * `connectionState` (`connected` / `connecting` / `unavailable` / `failed` /
 * `missing` / anything else means the pairing is saved but the session is not).
 * Reading the wrong family's field is a card that says "متصل" for a dead session.
 *
 * Pure and free of React Native on purpose, in the style of
 * `lib/onboarding-guard.ts`. The connections input is structural: the screen passes
 * whatever the query produced, including `undefined` while it loads.
 */
import type { SourceConnections } from "./sources-status";

export type ChannelPlatform = "instagram" | "facebook" | "whatsapp";

/** One channel tile on the dashboard. */
export type ChannelCard = {
  platform: ChannelPlatform;
  name: string;
  /** Display form: `@handle` for Instagram, the page name or number otherwise. */
  accountName: string | null;
  connected: boolean;
  needsReauthorization: boolean;
  needsReconnection: boolean;
  isConnecting: boolean;
  isUnavailable: boolean;
};

/** Display order on the dashboard: Instagram first. */
export function homeChannels(
  connections: SourceConnections | null | undefined,
): ChannelCard[] {
  const instagram = connections?.instagram;
  const facebook = connections?.facebook;
  const whatsapp = connections?.whatsapp;
  return [
    {
      platform: "instagram",
      name: "إنستغرام",
      accountName: instagram?.accountName ? `@${instagram.accountName}` : null,
      connected: instagram?.authorizationStatus === "ready",
      needsReauthorization:
        instagram?.authorizationStatus === "needs_reauthorization",
      // Meta has no "connecting" or "unavailable" state to show: either the
      // authorisation is ready, or it needs doing again.
      needsReconnection: false,
      isConnecting: false,
      isUnavailable: false,
    },
    {
      platform: "facebook",
      name: "فيسبوك",
      accountName: facebook?.accountName || null,
      connected: facebook?.authorizationStatus === "ready",
      needsReauthorization:
        facebook?.authorizationStatus === "needs_reauthorization",
      needsReconnection: false,
      isConnecting: false,
      isUnavailable: false,
    },
    {
      platform: "whatsapp",
      name: "واتساب",
      accountName: whatsapp?.accountName || null,
      connected: whatsapp?.connectionState === "connected",
      needsReauthorization: false,
      // Saved but not working, and not merely mid-handshake or unreachable: those
      // two get their own wording below, and "أعد الاتصال" would be wrong for both.
      needsReconnection: Boolean(
        whatsapp &&
          whatsapp.connectionState !== "connected" &&
          whatsapp.connectionState !== "connecting" &&
          whatsapp.connectionState !== "unavailable",
      ),
      isConnecting: whatsapp?.connectionState === "connecting",
      isUnavailable: whatsapp?.connectionState === "unavailable",
    },
  ];
}

/** What the hero and the tiles need to know about the channels, in one place. */
export type ChannelSignals = {
  /**
   * Whether any channel can publish right now. False while the connections state is
   * unknown, because "no connection" and "we could not check" lead to different
   * heroes — one invites the merchant to link an account, the other to retry.
   */
  hasAnyConnection: boolean;
  whatsappUnavailable: boolean;
  whatsappConnecting: boolean;
  whatsappNeedsReconnection: boolean;
  /**
   * The first channel asking for re-authorisation, if any. Only a Meta channel can
   * be in this state — the WhatsApp provider reports a broken session as
   * `needsReconnection` instead — so the platform is typed as narrowly as the fact.
   */
  accountNeedingReauthorization: {
    platform: "facebook" | "instagram";
    name: string;
  } | null;
};

export function channelSignals(
  channels: ReadonlyArray<ChannelCard>,
  connectionsUnavailable: boolean,
): ChannelSignals {
  const reauthorization = channels.find(
    (channel) => channel.needsReauthorization,
  );
  // Narrowed by value rather than asserted: only a Meta card can carry
  // `needsReauthorization`, and if that ever stops being true the hero should lose
  // the branch, not be handed a platform it has no wording for.
  const reauthorizationPlatform =
    reauthorization?.platform === "facebook" ||
    reauthorization?.platform === "instagram"
      ? reauthorization.platform
      : null;
  return {
    hasAnyConnection:
      !connectionsUnavailable && channels.some((channel) => channel.connected),
    whatsappUnavailable: channels.some((channel) => channel.isUnavailable),
    whatsappConnecting: channels.some(
      (channel) => channel.platform === "whatsapp" && channel.isConnecting,
    ),
    whatsappNeedsReconnection: channels.some(
      (channel) => channel.platform === "whatsapp" && channel.needsReconnection,
    ),
    accountNeedingReauthorization:
      reauthorization && reauthorizationPlatform
        ? { platform: reauthorizationPlatform, name: reauthorization.name }
        : null,
  };
}

/**
 * The post the hero should point at, or null when there is nothing to point at.
 *
 * Priority is a problem before an opportunity: a post that failed to publish is
 * what the merchant has to look at, then one waiting for their review, then a
 * draft they were writing.
 */
export function pickPendingPost<T extends { status: string }>(
  posts: ReadonlyArray<T>,
): T | null {
  return (
    posts.find((post) => post.status === "failed") ??
    posts.find((post) => post.status === "review") ??
    posts.find((post) => post.status === "draft") ??
    null
  );
}

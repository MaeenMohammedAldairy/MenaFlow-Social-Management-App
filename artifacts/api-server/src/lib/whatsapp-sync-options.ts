export interface WhatsAppSyncOptions {
  syncMessagesEnabled: boolean;
  syncImagesEnabled: boolean;
  syncVideosEnabled: boolean;
}

export function hasEnabledWhatsAppSyncType(
  options: WhatsAppSyncOptions,
): boolean {
  return (
    options.syncMessagesEnabled ||
    options.syncImagesEnabled ||
    options.syncVideosEnabled
  );
}

export interface WhatsAppMediaItem {
  mediaType?: unknown;
}

export function filterWhatsAppMediaItems<T extends WhatsAppMediaItem>(
  items: T[],
  options: WhatsAppSyncOptions,
): T[] {
  return items.filter((item) => {
    const mediaType =
      typeof item.mediaType === "string"
        ? item.mediaType.toLowerCase()
        : "unknown";
    if (mediaType === "image") return options.syncImagesEnabled;
    if (mediaType === "video") return options.syncVideosEnabled;
    return options.syncMessagesEnabled;
  });
}

export function shouldSyncWhatsAppMessage(
  syncMessagesEnabled: boolean,
  hasTextContent: boolean,
  hasMediaContent: boolean,
  selectedMediaCount: number,
): boolean {
  return selectedMediaCount > 0 ||
    (syncMessagesEnabled && (!hasMediaContent || hasTextContent));
}

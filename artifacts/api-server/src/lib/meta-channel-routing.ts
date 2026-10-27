export type MetaChannel = "facebook" | "instagram";

export function hasDraftForMetaChannels(
  channels: string[],
  draft: { facebook?: string | null; instagram?: string | null },
): boolean {
  return channels.length > 0 && channels.every((channel) => {
    if (channel === "facebook") return Boolean(draft.facebook?.trim());
    if (channel === "instagram") return Boolean(draft.instagram?.trim());
    return false;
  });
}

export function connectedMetaChannels(
  requested: string[],
  connection: { pageId?: string | null; instagramUserId?: string | null } | null | undefined,
): MetaChannel[] {
  if (!connection) return [];
  return requested.filter((channel): channel is MetaChannel =>
    (channel === "facebook" && Boolean(connection.pageId)) ||
    (channel === "instagram" && Boolean(connection.instagramUserId)),
  );
}

export function unconnectedMetaChannels(
  requested: string[],
  connection: { pageId?: string | null; instagramUserId?: string | null } | null | undefined,
): MetaChannel[] {
  const connected = new Set(connectedMetaChannels(requested, connection));
  return requested.filter(
    (channel): channel is MetaChannel =>
      (channel === "facebook" || channel === "instagram") && !connected.has(channel),
  );
}

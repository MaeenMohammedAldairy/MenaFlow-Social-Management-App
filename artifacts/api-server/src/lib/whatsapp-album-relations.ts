export const WHATSAPP_MEDIA_GROUP_SOURCES = [
  "protocol_association",
  "provider_album_container",
] as const;

export type WhatsAppMediaGroupSource =
  (typeof WHATSAPP_MEDIA_GROUP_SOURCES)[number];

export function isConfirmedWhatsAppMediaGroupSource(
  source: string | null | undefined,
): source is WhatsAppMediaGroupSource {
  return source === "protocol_association" ||
    source === "provider_album_container";
}

export function resolveWhatsAppMediaGroupSource(input: {
  hasValidProtocolAssociation: boolean;
  isProviderAlbumContainer: boolean;
}): WhatsAppMediaGroupSource | null {
  if (input.hasValidProtocolAssociation) return "protocol_association";
  if (input.isProviderAlbumContainer) return "provider_album_container";
  return null;
}

export function canShareWhatsAppMediaGroup(input: {
  mediaGroupId: string | null;
  source: string | null;
  candidateMediaGroupId: string | null;
  candidateSource: string | null;
}): boolean {
  return Boolean(
    input.mediaGroupId &&
      input.mediaGroupId === input.candidateMediaGroupId &&
      isConfirmedWhatsAppMediaGroupSource(input.source) &&
      isConfirmedWhatsAppMediaGroupSource(input.candidateSource),
  );
}

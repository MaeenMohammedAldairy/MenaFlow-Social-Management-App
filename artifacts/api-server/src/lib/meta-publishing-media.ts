export function selectFacebookPhotoMedia<T extends {
  mediaType: string;
  mimeType?: string | null;
}>(media: T[]): { photos: T[]; omittedCount: number } {
  const supportedPhotos = media.filter((item) =>
    item.mediaType === "image" &&
    ["image/jpeg", "image/png"].includes(item.mimeType?.toLowerCase() ?? ""),
  );
  const photos = supportedPhotos.slice(0, 10);
  return {
    photos,
    omittedCount: media.length - photos.length,
  };
}

import { useEffect, useRef, useState } from "react";
import type { Post } from "@/context/StudioContext";
import {
  whatsappMediaExpiryFromUrl,
  whatsappMediaIdFromUrl,
} from "@/lib/content-utils";
import { getWhatsAppMediaUrl } from "@workspace/api-client-react";

export function useWhatsAppMediaPreviewRefresh(posts: Post[]) {
  const [mediaPreviewUrls, setMediaPreviewUrls] = useState<
    Record<string, string>
  >({});
  const mediaRefreshRetryAtRef = useRef(new Map<string, number>());
  const [mediaRetryScheduleVersion, setMediaRetryScheduleVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const mediaById = new Map<string, string>();
    const thumbnailMediaIds = new Set<string>();
    for (const post of posts) {
      for (const [index, mediaUrl] of (post.mediaUrls ?? []).entries()) {
        const mediaId = whatsappMediaIdFromUrl(mediaUrl);
        if (mediaId) {
          mediaById.set(mediaId, mediaPreviewUrls[mediaId] ?? mediaUrl);
          if (index < 3) thumbnailMediaIds.add(mediaId);
        }
      }
    }
    const nextRefreshAt = [...mediaById].reduce<number | null>(
      (soonest, [mediaId, mediaUrl]) => {
        const expiresAt = whatsappMediaExpiryFromUrl(mediaUrl);
        if (!expiresAt) return soonest;
        const retryAt = mediaRefreshRetryAtRef.current.get(mediaId) ?? 0;
        const refreshAt = Math.max(expiresAt - 5 * 60 * 1000, retryAt);
        return soonest === null || refreshAt < soonest ? refreshAt : soonest;
      },
      null,
    );
    if (nextRefreshAt === null) return;

    const refreshTimer = setTimeout(
      async () => {
        const now = Date.now();
        const dueMedia = [...mediaById].filter(([mediaId, mediaUrl]) => {
          const expiresAt = whatsappMediaExpiryFromUrl(mediaUrl);
          const retryAt = mediaRefreshRetryAtRef.current.get(mediaId) ?? 0;
          return (
            expiresAt !== null &&
            expiresAt <= now + 5 * 60 * 1000 &&
            retryAt <= now
          );
        });
        let hasFailure = false;
        const refreshedEntries = await Promise.all(
          dueMedia.map(async ([mediaId]) => {
            try {
              // A refusal arrives as an ApiError from the generated client and
              // takes the same path as any other failure: warn, retry in a minute.
              const { url: refreshedUrl } = await getWhatsAppMediaUrl(mediaId);
              if (!refreshedUrl) {
                throw new Error("Media URL refresh returned no URL.");
              }
              let refreshedThumbnailUrl: string | undefined;
              if (thumbnailMediaIds.has(mediaId)) {
                const thumbnail = await getWhatsAppMediaUrl(mediaId, {
                  variant: "thumbnail",
                });
                if (!thumbnail.url) {
                  throw new Error("Thumbnail URL refresh returned no URL.");
                }
                refreshedThumbnailUrl = thumbnail.url;
              }
              mediaRefreshRetryAtRef.current.delete(mediaId);
              return {
                mediaId,
                originalUrl: refreshedUrl,
                thumbnailUrl: refreshedThumbnailUrl,
              };
            } catch (error) {
              console.warn(
                "Unable to refresh a WhatsApp media preview URL:",
                error,
              );
              mediaRefreshRetryAtRef.current.set(mediaId, Date.now() + 60_000);
              hasFailure = true;
              return null;
            }
          }),
        );
        if (!active) return;
        const refreshed: Record<string, string> = {};
        for (const entry of refreshedEntries) {
          if (!entry) continue;
          refreshed[entry.mediaId] = entry.originalUrl;
          if (entry.thumbnailUrl) {
            refreshed[`${entry.mediaId}:thumbnail`] = entry.thumbnailUrl;
          }
        }
        if (Object.keys(refreshed).length > 0) {
          setMediaPreviewUrls((current) => ({
            ...current,
            ...refreshed,
          }));
        }
        if (hasFailure) setMediaRetryScheduleVersion((version) => version + 1);
      },
      Math.max(0, nextRefreshAt - Date.now()),
    );
    return () => {
      active = false;
      clearTimeout(refreshTimer);
    };
  }, [posts, mediaPreviewUrls, mediaRetryScheduleVersion]);

  return mediaPreviewUrls;
}

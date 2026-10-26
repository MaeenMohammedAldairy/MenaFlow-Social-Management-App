import { customFetch } from "./custom-fetch";

export type AutoPublishSettings = {
  enabled: boolean;
  channels: Array<"facebook" | "instagram">;
  enabledAt: string | null;
  initialPublish?: {
    processed: number;
    published: number;
    failed: number;
  };
};

export type WhatsAppBacklogResult = {
  scanned: number;
  created: number;
  existing: number;
  skipped: number;
};

export type PostPublishResponse = {
  success: boolean;
  results: Record<string, { status: string; postId?: string; url?: string | null; reason?: string }>;
  post: {
    id: string;
    status: string;
    error: string | null;
    channels: string[];
    publishResults: Record<string, unknown>;
  };
};

export type FacebookPublishVerificationResponse = {
  status: "found" | "not-found" | "unavailable";
  reason: string | null;
  post: {
    id: string;
    status: string;
    error: string | null;
    channels: string[];
    publishResults: Record<string, unknown>;
  };
};

export function getAutoPublishSettings(): Promise<AutoPublishSettings> {
  return customFetch<AutoPublishSettings>("/api/posts/auto-publish-settings", { method: "GET" });
}

export function saveAutoPublishSettings(
  settings: Pick<AutoPublishSettings, "enabled" | "channels">,
): Promise<AutoPublishSettings> {
  return customFetch<AutoPublishSettings>("/api/posts/auto-publish-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export function processWhatsAppBacklog(limit = 50): Promise<WhatsAppBacklogResult> {
  return customFetch<WhatsAppBacklogResult>("/api/posts/process-whatsapp-backlog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit }),
  });
}

export function publishPostToChannels(
  postId: string,
  channels: Array<"facebook" | "instagram">,
  retryUncertain?: boolean,
): Promise<PostPublishResponse> {
  return customFetch<PostPublishResponse>(`/api/posts/${encodeURIComponent(postId)}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channels,
      ...(retryUncertain === undefined ? {} : { retryUncertain }),
    }),
  });
}

export function verifyFacebookPostStatus(
  postId: string,
): Promise<FacebookPublishVerificationResponse> {
  return customFetch<FacebookPublishVerificationResponse>(
    `/api/posts/${encodeURIComponent(postId)}/verify-facebook`,
    { method: "POST" },
  );
}

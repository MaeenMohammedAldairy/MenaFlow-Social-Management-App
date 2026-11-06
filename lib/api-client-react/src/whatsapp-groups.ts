import { customFetch } from "./custom-fetch";
import type { WhatsAppGroupOption } from "./generated/api.schemas";

export interface WhatsAppGroup {
  groupJid: string;
  groupId: string;
  kind: "announcement";
  communityParentJid?: string;
  name: string;
  selected: boolean;
  verifiedAt?: string;
}

export interface WhatsAppGroupsResponse {
  groups: WhatsAppGroupOption[];
}

export interface WhatsAppGroupSelectionsResponse {
  groups: WhatsAppGroup[];
}

export interface WhatsAppSyncStatusEntry {
  groupJid: string;
  groupName: string;
  status: string;
  savedMessageCount: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface WhatsAppSyncStatusResponse {
  autoSyncEnabled: boolean;
  syncMessagesEnabled: boolean;
  syncImagesEnabled: boolean;
  syncVideosEnabled: boolean;
  groups: WhatsAppSyncStatusEntry[];
}

export interface WhatsAppSyncTriggerResponse {
  status:
    | "started"
    | "already_running"
    | "no_selected_groups"
    | "no_linked_announcement_groups"
    | "no_sync_options";
  includeHistory?: boolean;
  historyLimit?: number;
  groups: Array<{ groupJid: string; groupName: string }>;
}

export interface WhatsAppMessageMedia {
  id: string;
  mediaIndex?: number;
  mediaType: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  downloadStatus?: string | null;
  failureReason?: string | null;
  accessError?: string | null;
  url?: string | null;
  thumbnailUrl?: string | null;
  storageKey?: string | null;
  createdAt?: string | null;
}

export interface WhatsAppMessage {
  id: string;
  remoteMessageId: string;
  senderId?: string | null;
  senderName?: string | null;
  messageType: string;
  textBody?: string | null;
  caption?: string | null;
  mediaAvailable: boolean;
  mediaGroupId?: string | null;
  mediaGroupSource?: "protocol_association" | "provider_album_container" | null;
  contentBundleId?: string | null;
  contentBundleMedia?: WhatsAppMessageMedia[];
  mediaGroupIndex?: number | null;
  mediaGroupExpectedCount?: number | null;
  mediaDownloadStatus?: string | null;
  mediaDownloadError?: string | null;
  messageStatus?: string | null;
  source?: string | null;
  messageTimestamp?: string | null;
  createdAt?: string | null;
  replyToRemoteId?: string | null;
  linkedPostId?: string | null;
  linkedPostStatus?: string | null;
  media: WhatsAppMessageMedia[];
  associationSuggestions?: Array<{
    sourceMessageId: string;
    candidateMessageId: string;
    candidateGroupKey: string;
    candidateMediaGroupId: string | null;
    candidateText: string | null;
    candidateMediaCount: number;
    reason: string;
    decision: "accepted" | "rejected" | null;
  }>;
}

export interface WhatsAppGroupMessagesResponse {
  groupJid: string;
  groupName: string;
  page: number;
  limit: number;
  totalCount: number;
  hasNextPage: boolean;
  messages: WhatsAppMessage[];
}

export async function getWhatsAppGroups(
  options?: Parameters<typeof customFetch>[1],
): Promise<WhatsAppGroupsResponse> {
  return customFetch<WhatsAppGroupsResponse>("/api/social/whatsapp/groups", {
    ...options,
    method: "GET",
  });
}

export async function getWhatsAppGroupSelections(
  options?: Parameters<typeof customFetch>[1],
): Promise<WhatsAppGroupSelectionsResponse> {
  return customFetch<WhatsAppGroupSelectionsResponse>(
    "/api/social/whatsapp/group-selections",
    {
      ...options,
      method: "GET",
    },
  );
}

export async function saveWhatsAppGroupSelections(
  groupJids: string[],
  options?: Parameters<typeof customFetch>[1],
): Promise<WhatsAppGroupSelectionsResponse> {
  return customFetch<WhatsAppGroupSelectionsResponse>(
    "/api/social/whatsapp/group-selections",
    {
      ...options,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: JSON.stringify({ groupJids }),
    },
  );
}

export async function getWhatsAppSyncStatus(
  options?: Parameters<typeof customFetch>[1],
): Promise<WhatsAppSyncStatusResponse> {
  return customFetch<WhatsAppSyncStatusResponse>(
    "/api/social/whatsapp/sync-status",
    {
      ...options,
      method: "GET",
    },
  );
}

export async function updateWhatsAppSyncSettings(
  settings: Partial<{
    autoSyncEnabled: boolean;
    syncMessagesEnabled: boolean;
    syncImagesEnabled: boolean;
    syncVideosEnabled: boolean;
  }>,
  options?: Parameters<typeof customFetch>[1],
): Promise<{
  autoSyncEnabled: boolean;
  syncMessagesEnabled: boolean;
  syncImagesEnabled: boolean;
  syncVideosEnabled: boolean;
}> {
  return customFetch<{
    autoSyncEnabled: boolean;
    syncMessagesEnabled: boolean;
    syncImagesEnabled: boolean;
    syncVideosEnabled: boolean;
  }>("/api/social/whatsapp/sync-settings", {
    ...options,
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    body: JSON.stringify(settings),
  });
}

export async function triggerWhatsAppSyncNow(
  includeHistory = false,
  options?: Parameters<typeof customFetch>[1],
  historyLimit?: number,
): Promise<WhatsAppSyncTriggerResponse> {
  return customFetch<WhatsAppSyncTriggerResponse>(
    "/api/social/whatsapp/sync-now",
    {
      ...options,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: JSON.stringify({
        includeHistory,
        ...(includeHistory && historyLimit !== undefined
          ? { historyLimit }
          : {}),
      }),
    },
  );
}

export async function getWhatsAppGroupMessages(
  groupJid: string,
  params?: { page?: number; limit?: number; sort?: "asc" | "desc" },
  options?: Parameters<typeof customFetch>[1],
): Promise<WhatsAppGroupMessagesResponse> {
  const search = new URLSearchParams();
  if (params?.page) search.set("page", String(params.page));
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.sort) search.set("sort", params.sort);

  const query = search.toString();
  return customFetch<WhatsAppGroupMessagesResponse>(
    `/api/social/whatsapp/groups/${encodeURIComponent(groupJid)}/messages${query ? `?${query}` : ""}`,
    {
      ...options,
      method: "GET",
    },
  );
}

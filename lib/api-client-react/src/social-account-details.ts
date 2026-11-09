import { customFetch } from "./custom-fetch";

export type AccountPlatform = "facebook" | "instagram" | "whatsapp";

export interface SocialAccountMetric {
  key: string;
  label: string;
  value: number;
  period?: string;
}

export interface SocialAccountPost {
  id: string;
  text: string;
  publishedAt: string | null;
  url: string | null;
  imageUrl: string | null;
  mediaType?: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
}

export interface SocialAccountPerformance {
  publishedCount: number;
  attemptedCount: number;
  successRate: number | null;
  scheduledCount: number;
  reviewCount: number;
  failedCount: number;
  aiPublishedCount: number;
  weeklyPublished: Array<{ label: string; count: number }>;
  recentActivity: Array<{
    id: string;
    postId: string;
    title: string;
    eventType: string;
    occurredAt: string;
    actorLabel: string;
    attempt: number | null;
    reason: string | null;
  }>;
}

export interface SocialAccountDetails {
  platform: AccountPlatform;
  accountId: string;
  accountName: string;
  connectedAt: string;
  connectionState: string;
  profileImageUrl: string | null;
  coverImageUrl?: string | null;
  externalUrl: string | null;
  category?: string | null;
  description?: string | null;
  lastSyncedAt: string | null;
  autoSyncEnabled?: boolean;
  permissions: {
    required: string[];
    granted: string[] | null;
    missing: string[];
  };
  metrics: SocialAccountMetric[];
  posts?: SocialAccountPost[];
  performance?: SocialAccountPerformance;
  groups?: Array<{ groupJid: string; groupName: string }>;
  messages?: Array<{
    id: string;
    groupName: string;
    text: string;
    messageType: string;
    sentAt: string;
    source: string;
  }>;
  issues: string[];
}

export function getSocialAccountDetails(
  platform: AccountPlatform,
  options?: Parameters<typeof customFetch>[1],
): Promise<SocialAccountDetails> {
  return customFetch<SocialAccountDetails>(
    `/api/social/account-details/${platform}`,
    { ...options, method: "GET" },
  );
}

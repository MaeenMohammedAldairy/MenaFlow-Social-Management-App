import { customFetch } from "./custom-fetch";

export type WhatsAppAutoReplyLanguage = "ar" | "match_customer";
export type WhatsAppAutoReplyTone =
  | "friendly_professional"
  | "concise"
  | "formal";

export interface WhatsAppAutoReplySettings {
  enabled: boolean;
  language: WhatsAppAutoReplyLanguage;
  tone: WhatsAppAutoReplyTone;
  instructions: string;
}

export interface WhatsAppAutoReplySettingsResponse {
  connected: boolean;
  phoneNumber: string | null;
  settings: WhatsAppAutoReplySettings;
}

export async function getWhatsAppAutoReplySettings(
  options?: Parameters<typeof customFetch>[1],
): Promise<WhatsAppAutoReplySettingsResponse> {
  return customFetch<WhatsAppAutoReplySettingsResponse>(
    "/api/social/whatsapp/auto-reply-settings",
    { ...options, method: "GET" },
  );
}

export async function saveWhatsAppAutoReplySettings(
  settings: WhatsAppAutoReplySettings,
  options?: Parameters<typeof customFetch>[1],
): Promise<WhatsAppAutoReplySettings> {
  return customFetch<WhatsAppAutoReplySettings>(
    "/api/social/whatsapp/auto-reply-settings",
    {
      ...options,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: JSON.stringify(settings),
    },
  );
}

export async function testWhatsAppAutoReply(
  input: Omit<WhatsAppAutoReplySettings, "enabled"> & {
    customerMessage: string;
  },
  options?: Parameters<typeof customFetch>[1],
): Promise<{ reply: string }> {
  return customFetch<{ reply: string }>(
    "/api/social/whatsapp/auto-reply-test",
    {
      ...options,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: JSON.stringify(input),
    },
  );
}

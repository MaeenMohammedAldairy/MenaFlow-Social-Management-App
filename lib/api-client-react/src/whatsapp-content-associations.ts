import { customFetch } from "./custom-fetch";

export type WhatsAppContentAssociationDecision = "accepted" | "rejected";

export function decideWhatsAppContentAssociation(input: {
  firstMessageId: string;
  secondMessageId: string;
  decision: WhatsAppContentAssociationDecision;
}): Promise<{
  decision: WhatsAppContentAssociationDecision;
  contentBundleId: string | null;
}> {
  return customFetch("/api/social/whatsapp/content-associations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

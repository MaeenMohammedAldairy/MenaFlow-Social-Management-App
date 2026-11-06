type SocialConnectionStatus = {
  authorizationStatus?: string;
  connected?: boolean;
  connectionState?: string;
};

export type EligibleSocialConnections = {
  facebook?: SocialConnectionStatus | null;
  instagram?: SocialConnectionStatus | null;
  whatsapp?: SocialConnectionStatus | null;
};

export function hasEligibleSocialConnection(
  connections: EligibleSocialConnections,
): boolean {
  return (
    connections.facebook?.authorizationStatus === "ready" ||
    connections.instagram?.authorizationStatus === "ready" ||
    connections.whatsapp?.connectionState === "connected"
  );
}

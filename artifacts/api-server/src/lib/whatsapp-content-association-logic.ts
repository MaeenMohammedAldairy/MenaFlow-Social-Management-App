import { createHash } from "node:crypto";

export type WhatsAppContentAssociationDecision = "accepted" | "rejected";

type AssociationEdge = {
  leftMessageId: string;
  rightMessageId: string;
  decision: WhatsAppContentAssociationDecision;
};

export function areWhatsAppMessagesInSameContentScope(
  first: {
    workspaceId: string;
    ownerId: string;
    instanceName: string;
    groupId: string | null;
    groupJid: string;
  },
  second: {
    workspaceId: string;
    ownerId: string;
    instanceName: string;
    groupId: string | null;
    groupJid: string;
  },
): boolean {
  return Boolean(
    first.groupId &&
      first.workspaceId === second.workspaceId &&
      first.ownerId === second.ownerId &&
      first.instanceName === second.instanceName &&
      first.groupId === second.groupId &&
      first.groupJid === second.groupJid,
  );
}

/** Deterministic identity for a newly accepted product bundle. */
export function whatsappProductBundleId(scope: {
  workspaceId: string;
  instanceName: string;
  groupId: string;
}, messageIds: readonly string[]): string {
  // Replayed webhooks and reversed decision order must resolve to the same id.
  const ordered = [...new Set(messageIds)].sort();
  const identity = createHash("sha256")
    .update(`${scope.workspaceId}\u0000${scope.instanceName}\u0000${scope.groupId}\u0000`)
    .update(ordered.join("\u0000"))
    .digest("hex")
    .slice(0, 24);
  return `bundle-${identity}`;
}

/**
 * The identity an extracted product group is stored under.
 *
 * Extraction used to key a suggestion by the *message ids it read*, so the same
 * offer written across four messages had four possible keys and any regrouping
 * minted a fifth — which is how one album became three review cards, and how a
 * second version of the same group could never be written (a unique index on
 * that key blocked it). Keying by the group instead — the bundle id once an
 * association is accepted, the WhatsApp album id while it is forming, and the
 * message itself when it stands alone — keeps the identity stable while the
 * group grows, so versions chain and one group stays one suggestion per version.
 *
 * Ordered and scope-qualified like {@link whatsappProductBundleId}, so a replayed
 * webhook and a reversed decision order resolve to the same key.
 */
export function whatsappProductExtractionGroupKey(scope: {
  workspaceId: string;
  instanceName: string;
  groupId: string;
}, identity: {
  bundleId?: string | null;
  mediaGroupId?: string | null;
  messageId: string;
}): string {
  const kind = identity.bundleId
    ? "bundle"
    : identity.mediaGroupId
      ? "album"
      : "message";
  const member = identity.bundleId ?? identity.mediaGroupId ?? identity.messageId;
  const digest = createHash("sha256")
    .update(`${scope.workspaceId}\u0000${scope.instanceName}\u0000${scope.groupId ?? ""}`)
    .update(`\u0000${kind}\u0000${member}`)
    .digest("hex")
    .slice(0, 32);
  return `${kind}:${digest}`;
}

export function normalizeWhatsAppAssociationPair(
  firstMessageId: string,
  secondMessageId: string,
): [string, string] {
  return firstMessageId < secondMessageId
    ? [firstMessageId, secondMessageId]
    : [secondMessageId, firstMessageId];
}

export function whatsappAssociationPairKey(
  firstMessageId: string,
  secondMessageId: string,
): string {
  return normalizeWhatsAppAssociationPair(
    firstMessageId,
    secondMessageId,
  ).join("\u0000");
}

export function connectedWhatsAppMessageIds(
  messageId: string,
  edges: readonly AssociationEdge[],
): string[] {
  const adjacent = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.decision !== "accepted") continue;
    const left = adjacent.get(edge.leftMessageId) ?? new Set<string>();
    const right = adjacent.get(edge.rightMessageId) ?? new Set<string>();
    left.add(edge.rightMessageId);
    right.add(edge.leftMessageId);
    adjacent.set(edge.leftMessageId, left);
    adjacent.set(edge.rightMessageId, right);
  }

  const connected = new Set([messageId]);
  const pending = [messageId];
  while (pending.length > 0) {
    for (const candidate of adjacent.get(pending.pop()!) ?? []) {
      if (connected.has(candidate)) continue;
      connected.add(candidate);
      pending.push(candidate);
    }
  }
  return [...connected].sort();
}

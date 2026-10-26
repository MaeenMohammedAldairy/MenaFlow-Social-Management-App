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

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  menaWhatsAppContentAssociations,
  menaWhatsAppGroupSelections,
  menaWhatsAppGroups,
  menaWhatsAppMessages,
} from "@workspace/db";
import {
  findWhatsAppProductBundleSuggestions,
  selectAutoAcceptableProductBundleSuggestions,
  type WhatsAppSuggestionMessage,
} from "./whatsapp-association-suggestions.ts";
import {
  areWhatsAppMessagesInSameContentScope as messagesShareContentScope,
  connectedWhatsAppMessageIds,
  normalizeWhatsAppAssociationPair,
  whatsappAssociationPairKey,
  whatsappProductBundleId,
  type WhatsAppContentAssociationDecision,
} from "./whatsapp-content-association-logic.ts";
import { reopenWhatsAppProductExtractionGroup } from "./whatsapp-product-group-reopen.ts";
import { logger } from "./logger.ts";

export {
  areWhatsAppMessagesInSameContentScope,
  connectedWhatsAppMessageIds,
  normalizeWhatsAppAssociationPair,
  whatsappAssociationPairKey,
  whatsappProductBundleId,
} from "./whatsapp-content-association-logic.ts";
export type { WhatsAppContentAssociationDecision } from "./whatsapp-content-association-logic.ts";

type AssociationScope = {
  workspaceId: string;
  instanceName: string;
  groupId: string;
};

type AssociationEdge = {
  leftMessageId: string;
  rightMessageId: string;
  decision: WhatsAppContentAssociationDecision;
  contentBundleId: string | null;
  createdAt: Date;
};

export class WhatsAppContentAssociationError extends Error {
  readonly code:
    | "MESSAGE_SCOPE_MISMATCH"
    | "GROUP_NOT_SELECTED"
    | "MESSAGE_NOT_AVAILABLE"
    | "ASSOCIATION_DECISION_CONFLICT";

  constructor(
    code:
      | "MESSAGE_SCOPE_MISMATCH"
      | "GROUP_NOT_SELECTED"
      | "MESSAGE_NOT_AVAILABLE"
      | "ASSOCIATION_DECISION_CONFLICT",
  ) {
    super(code);
    this.code = code;
  }
}

export async function getWhatsAppContentAssociationDecisions(
  scope: AssociationScope,
): Promise<Map<string, WhatsAppContentAssociationDecision>> {
  const rows = await db
    .select({
      leftMessageId: menaWhatsAppContentAssociations.leftMessageId,
      rightMessageId: menaWhatsAppContentAssociations.rightMessageId,
      decision: menaWhatsAppContentAssociations.decision,
    })
    .from(menaWhatsAppContentAssociations)
    .where(and(
      eq(menaWhatsAppContentAssociations.workspaceId, scope.workspaceId),
      eq(menaWhatsAppContentAssociations.instanceName, scope.instanceName),
      eq(menaWhatsAppContentAssociations.groupId, scope.groupId),
    ));
  return new Map(rows.map((row) => [
    whatsappAssociationPairKey(row.leftMessageId, row.rightMessageId),
    row.decision,
  ]));
}

export async function getWhatsAppContentBundles(
  scope: AssociationScope,
  messageIds: string[],
): Promise<Map<string, { id: string; messageIds: string[] }>> {
  const rows = await db
    .select({
      leftMessageId: menaWhatsAppContentAssociations.leftMessageId,
      rightMessageId: menaWhatsAppContentAssociations.rightMessageId,
      decision: menaWhatsAppContentAssociations.decision,
      contentBundleId: menaWhatsAppContentAssociations.contentBundleId,
      createdAt: menaWhatsAppContentAssociations.createdAt,
    })
    .from(menaWhatsAppContentAssociations)
    .where(and(
      eq(menaWhatsAppContentAssociations.workspaceId, scope.workspaceId),
      eq(menaWhatsAppContentAssociations.instanceName, scope.instanceName),
      eq(menaWhatsAppContentAssociations.groupId, scope.groupId),
      eq(menaWhatsAppContentAssociations.decision, "accepted"),
    ));
  const result = new Map<string, { id: string; messageIds: string[] }>();
  const resolvedComponents = new Set<string>();
  for (const messageId of messageIds) {
    const bundleMessageIds = connectedWhatsAppMessageIds(messageId, rows);
    if (bundleMessageIds.length < 2) continue;
    const componentKey = bundleMessageIds.join("\u0000");
    if (resolvedComponents.has(componentKey)) continue;
    resolvedComponents.add(componentKey);
    const bundleMembers = new Set(bundleMessageIds);
    const bundleId = rows
      .filter((row) =>
        bundleMembers.has(row.leftMessageId) &&
        bundleMembers.has(row.rightMessageId),
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .find((row) => row.contentBundleId)?.contentBundleId;
    if (!bundleId) throw new Error("WHATSAPP_CONTENT_BUNDLE_MISSING");
    const bundle = { id: bundleId, messageIds: bundleMessageIds };
    for (const memberId of bundleMessageIds) result.set(memberId, bundle);
  }
  return result;
}

export async function getWhatsAppContentBundle(
  scope: AssociationScope,
  messageId: string,
): Promise<{ id: string; messageIds: string[] } | null> {
  const rows = await db
    .select({
      leftMessageId: menaWhatsAppContentAssociations.leftMessageId,
      rightMessageId: menaWhatsAppContentAssociations.rightMessageId,
      decision: menaWhatsAppContentAssociations.decision,
      contentBundleId: menaWhatsAppContentAssociations.contentBundleId,
      createdAt: menaWhatsAppContentAssociations.createdAt,
    })
    .from(menaWhatsAppContentAssociations)
    .where(and(
      eq(menaWhatsAppContentAssociations.workspaceId, scope.workspaceId),
      eq(menaWhatsAppContentAssociations.instanceName, scope.instanceName),
      eq(menaWhatsAppContentAssociations.groupId, scope.groupId),
      eq(menaWhatsAppContentAssociations.decision, "accepted"),
    ));
  const messageIds = connectedWhatsAppMessageIds(messageId, rows);
  if (messageIds.length < 2) return null;
  const messageSet = new Set(messageIds);
  const bundle = rows
    .filter((row) =>
      messageSet.has(row.leftMessageId) && messageSet.has(row.rightMessageId),
    )
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .find((row) => row.contentBundleId)?.contentBundleId;
  if (!bundle) throw new Error("WHATSAPP_CONTENT_BUNDLE_MISSING");
  return { id: bundle, messageIds };
}

/** Persists the unambiguous suggestions so content is linked without a click. */
export const WHATSAPP_AUTO_ASSOCIATION_DECIDED_BY = "whatsapp-auto-association";

export async function autoAcceptWhatsAppSuggestions(input: {
  workspaceId: string;
  instanceName: string;
  groupId: string;
  messages: WhatsAppSuggestionMessage[];
  decidedBy?: string;
}): Promise<{ acceptedCount: number; messageIds: string[] }> {
  const scope = {
    workspaceId: input.workspaceId,
    instanceName: input.instanceName,
    groupId: input.groupId,
  };
  const suggestions = findWhatsAppProductBundleSuggestions(input.messages);
  const autoAcceptable = selectAutoAcceptableProductBundleSuggestions(suggestions);
  if (autoAcceptable.length === 0) return { acceptedCount: 0, messageIds: [] };
  const decisions = await getWhatsAppContentAssociationDecisions(scope);
  const edges = [...decisions].map(([pair, decision]) => {
    const [leftMessageId, rightMessageId] = pair.split("\u0000");
    return { leftMessageId, rightMessageId, decision };
  });
  const acceptedMessageIds = new Set<string>();
  let acceptedCount = 0;
  for (const suggestion of autoAcceptable) {
    const pairKey = whatsappAssociationPairKey(
      suggestion.sourceMessageId,
      suggestion.candidateMessageId,
    );
    if (decisions.has(pairKey)) continue;
    const sourceComponent = connectedWhatsAppMessageIds(
      suggestion.sourceMessageId,
      edges,
    );
    const candidateComponent = connectedWhatsAppMessageIds(
      suggestion.candidateMessageId,
      edges,
    );
    const sourceSet = new Set(sourceComponent);
    if (candidateComponent.some((id) => sourceSet.has(id))) continue;
    // A merchant's earlier "reject" is a decision, not an absent suggestion.
    if ([...sourceSet].some((id) =>
      candidateComponent.some((candidateId) =>
        decisions.get(whatsappAssociationPairKey(id, candidateId)) === "rejected",
      ),
    )) continue;
    try {
      await decideWhatsAppContentAssociation({
        decidedBy: input.decidedBy ?? WHATSAPP_AUTO_ASSOCIATION_DECIDED_BY,
        workspaceId: input.workspaceId,
        firstMessageId: suggestion.sourceMessageId,
        secondMessageId: suggestion.candidateMessageId,
        decision: "accepted",
      });
      edges.push({
        leftMessageId: normalizeWhatsAppAssociationPair(
          suggestion.sourceMessageId,
          suggestion.candidateMessageId,
        )[0],
        rightMessageId: normalizeWhatsAppAssociationPair(
          suggestion.sourceMessageId,
          suggestion.candidateMessageId,
        )[1],
        decision: "accepted",
      });
    } catch (error) {
      // Another request may have decided the pair between the read and write.
      if (
        error instanceof WhatsAppContentAssociationError &&
        error.code === "ASSOCIATION_DECISION_CONFLICT"
      ) continue;
      throw error;
    }
    acceptedCount += 1;
    acceptedMessageIds.add(suggestion.sourceMessageId);
    acceptedMessageIds.add(suggestion.candidateMessageId);
  }
  return { acceptedCount, messageIds: [...acceptedMessageIds] };
}

export async function decideWhatsAppContentAssociation(input: {
  decidedBy: string;
  workspaceId: string;
  firstMessageId: string;
  secondMessageId: string;
  decision: WhatsAppContentAssociationDecision;
}): Promise<{ decision: WhatsAppContentAssociationDecision; contentBundleId: string | null }> {
  if (input.firstMessageId === input.secondMessageId) {
    throw new WhatsAppContentAssociationError("MESSAGE_SCOPE_MISMATCH");
  }
  const [leftMessageId, rightMessageId] = normalizeWhatsAppAssociationPair(
    input.firstMessageId,
    input.secondMessageId,
  );
  const decided = await db.transaction(async (transaction) => {
    const [leftMessage] = await transaction
      .select({
        id: menaWhatsAppMessages.id,
        ownerId: menaWhatsAppMessages.ownerId,
        workspaceId: menaWhatsAppMessages.workspaceId,
        instanceName: menaWhatsAppMessages.instanceName,
        groupId: menaWhatsAppMessages.groupId,
        groupJid: menaWhatsAppMessages.groupJid,
        messageStatus: menaWhatsAppMessages.messageStatus,
      })
      .from(menaWhatsAppMessages)
      .where(and(
        eq(menaWhatsAppMessages.id, leftMessageId),
        eq(menaWhatsAppMessages.workspaceId, input.workspaceId),
      ))
      .limit(1);
    const [rightMessage] = await transaction
      .select({
        id: menaWhatsAppMessages.id,
        ownerId: menaWhatsAppMessages.ownerId,
        workspaceId: menaWhatsAppMessages.workspaceId,
        instanceName: menaWhatsAppMessages.instanceName,
        groupId: menaWhatsAppMessages.groupId,
        groupJid: menaWhatsAppMessages.groupJid,
        messageStatus: menaWhatsAppMessages.messageStatus,
      })
      .from(menaWhatsAppMessages)
      .where(and(
        eq(menaWhatsAppMessages.id, rightMessageId),
        eq(menaWhatsAppMessages.workspaceId, input.workspaceId),
      ))
      .limit(1);
    if (
      !leftMessage ||
      !rightMessage ||
      !leftMessage.groupId ||
      !messagesShareContentScope(leftMessage, rightMessage)
    ) {
      throw new WhatsAppContentAssociationError("MESSAGE_SCOPE_MISMATCH");
    }
    if (
      leftMessage.messageStatus === "deleted" ||
      rightMessage.messageStatus === "deleted"
    ) {
      throw new WhatsAppContentAssociationError("MESSAGE_NOT_AVAILABLE");
    }

    const [group] = await transaction
      .select({ parentGroupId: menaWhatsAppGroups.parentGroupId })
      .from(menaWhatsAppGroups)
      .where(and(
        eq(menaWhatsAppGroups.id, leftMessage.groupId),
        eq(menaWhatsAppGroups.workspaceId, input.workspaceId),
        eq(menaWhatsAppGroups.instanceName, leftMessage.instanceName),
      ))
      .limit(1)
      .for("update");
    if (!group) {
      throw new WhatsAppContentAssociationError("MESSAGE_SCOPE_MISMATCH");
    }
    const selectableGroupIds = [
      leftMessage.groupId,
      group.parentGroupId,
    ].filter((id): id is string => Boolean(id));
    const [selection] = await transaction
      .select({ id: menaWhatsAppGroupSelections.id })
      .from(menaWhatsAppGroupSelections)
      .where(and(
        eq(menaWhatsAppGroupSelections.workspaceId, input.workspaceId),
        eq(menaWhatsAppGroupSelections.instanceName, leftMessage.instanceName),
        eq(menaWhatsAppGroupSelections.selected, true),
        inArray(menaWhatsAppGroupSelections.groupId, selectableGroupIds),
      ))
      .limit(1);
    if (!selection) {
      throw new WhatsAppContentAssociationError("GROUP_NOT_SELECTED");
    }

    const scope = {
      workspaceId: input.workspaceId,
      instanceName: leftMessage.instanceName,
      groupId: leftMessage.groupId,
    };
    const [existing] = await transaction
      .select()
      .from(menaWhatsAppContentAssociations)
      .where(and(
        eq(menaWhatsAppContentAssociations.workspaceId, scope.workspaceId),
        eq(menaWhatsAppContentAssociations.instanceName, scope.instanceName),
        eq(menaWhatsAppContentAssociations.groupId, scope.groupId),
        eq(menaWhatsAppContentAssociations.leftMessageId, leftMessageId),
        eq(menaWhatsAppContentAssociations.rightMessageId, rightMessageId),
      ))
      .limit(1);
    if (existing) {
      if (existing.decision !== input.decision) {
        throw new WhatsAppContentAssociationError(
          "ASSOCIATION_DECISION_CONFLICT",
        );
      }
      return {
        decision: existing.decision,
        contentBundleId: existing.contentBundleId,
        // A replayed decision created no new group, so there is nothing to
        // re-read: the extraction that produced the current rows already saw
        // exactly these messages.
        bundleMemberIds: [leftMessageId, rightMessageId],
        replayed: true,
      };
    }

    let contentBundleId: string | null = null;
    // The messages the acceptance put into one group, reported to the caller so
    // extraction can be re-armed for the whole group rather than for the pair.
    let bundleMemberIds: string[] = [];
    if (input.decision === "accepted") {
      const edges = await transaction
        .select({
          leftMessageId: menaWhatsAppContentAssociations.leftMessageId,
          rightMessageId: menaWhatsAppContentAssociations.rightMessageId,
          decision: menaWhatsAppContentAssociations.decision,
          contentBundleId: menaWhatsAppContentAssociations.contentBundleId,
          createdAt: menaWhatsAppContentAssociations.createdAt,
        })
        .from(menaWhatsAppContentAssociations)
        .where(and(
          eq(menaWhatsAppContentAssociations.workspaceId, scope.workspaceId),
          eq(menaWhatsAppContentAssociations.instanceName, scope.instanceName),
          eq(menaWhatsAppContentAssociations.groupId, scope.groupId),
          eq(menaWhatsAppContentAssociations.decision, "accepted"),
        ));
      const leftComponent = connectedWhatsAppMessageIds(leftMessageId, edges);
      const rightComponent = connectedWhatsAppMessageIds(rightMessageId, edges);
      const combinedIds = new Set([...leftComponent, ...rightComponent]);
      const existingBundles = edges
        .filter((edge) =>
          combinedIds.has(edge.leftMessageId) &&
          combinedIds.has(edge.rightMessageId) &&
          edge.contentBundleId,
        )
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .map((edge) => edge.contentBundleId!);
      contentBundleId = existingBundles[0] ??
        whatsappProductBundleId(scope, [...combinedIds]);
      bundleMemberIds = [...combinedIds];
      const bundleIdsToMerge = [...new Set(existingBundles)];
      if (bundleIdsToMerge.length > 0) {
        await transaction
          .update(menaWhatsAppContentAssociations)
          .set({ contentBundleId, updatedAt: new Date() })
          .where(and(
            eq(menaWhatsAppContentAssociations.workspaceId, scope.workspaceId),
            eq(menaWhatsAppContentAssociations.instanceName, scope.instanceName),
            eq(menaWhatsAppContentAssociations.groupId, scope.groupId),
            inArray(
              menaWhatsAppContentAssociations.contentBundleId,
              bundleIdsToMerge,
            ),
          ));
      }
    }

    await transaction
      .insert(menaWhatsAppContentAssociations)
      .values({
        id: randomUUID(),
        ownerId: leftMessage.ownerId,
        workspaceId: scope.workspaceId,
        instanceName: scope.instanceName,
        groupId: scope.groupId,
        leftMessageId,
        rightMessageId,
        decision: input.decision,
        contentBundleId,
        decidedBy: input.decidedBy,
      });
    return { decision: input.decision, contentBundleId, bundleMemberIds };
  });
  if (
    input.decision === "accepted" &&
    !decided.replayed &&
    decided.bundleMemberIds.length > 1
  ) {
    // Reading the group again is what an acceptance is *for*. A caption linked to
    // its photos after extraction used to leave both halves stored as separate
    // single-message suggestions — the price stayed in one row, the product name
    // in the other, and nothing re-read them together. Best-effort: a merchant's
    // decision must not be rolled back because a queue row could not be written.
    try {
      await reopenWhatsAppProductExtractionGroup({
        workspaceId: input.workspaceId,
        messageIds: decided.bundleMemberIds,
        reason: "association_accepted",
      });
    } catch (error) {
      logger.warn(
        {
          error,
          workspaceId: input.workspaceId,
          members: decided.bundleMemberIds.length,
          contentBundleId: decided.contentBundleId,
        },
        "WHATSAPP_GROUP_REOPEN_AFTER_ASSOCIATION_FAILED",
      );
    }
  }
  return {
    decision: decided.decision,
    contentBundleId: decided.contentBundleId,
  };
}

/**
 * whatsapp-product-group-reopen.ts
 *
 * Re-arms the extraction jobs of a product group whose membership just changed.
 *
 * A group is not fixed at import time: WhatsApp hands over an album one message
 * at a time, and a merchant (or the auto-association rule) links a caption to
 * its photos later. When that happens, every message of the group has to be read
 * *together* — otherwise the caption is extracted alone and stays without its
 * price, and the photos are extracted alone and keep a name read off a label.
 * Both halves were written as separate one-message suggestions in the live
 * workspace, and the job that would have noticed went `complete` without a word.
 *
 * So the unit of work is the group: this module gives each member job a new
 * ruleset version, which is what tells the worker to read the group again and
 * to write the answer as the next version of one suggestion instead of a second
 * card.
 *
 * Its own module because the callers are `whatsapp-content-associations.ts`
 * (which cannot import `whatsapp-product-extraction.ts`: the extraction module
 * already imports the associations) and the extraction worker itself.
 */

import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  menaWhatsAppMessages,
  productExtractionSources,
  productExtractionSuggestions,
  whatsappProductExtractionJobs,
} from "@workspace/db";
import { logger } from "./logger.ts";

/** Members per call, so one accepted decision cannot reopen a whole workspace. */
export const GROUP_REOPEN_MEMBER_LIMIT = 50;

/** Jobs that are not mid-run and may therefore be handed back to the queue. */
const REOPENABLE_STATUSES = [
  "pending",
  "waiting_media",
  "waiting_association",
  "complete",
  "review",
  "failed",
] as const;

export type GroupReopenResult = {
  /** Jobs moved back to `pending` with a new version. */
  reopened: number;
  /** Members that had no job at all and got one. */
  created: number;
  /** The version the group was reopened at. */
  rulesetVersion: string;
};

function groupVersionFrom(rulesetVersion: string | null | undefined): number {
  const digits = String(rulesetVersion ?? "v1").replace(/\D/g, "");
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Reopens a group for extraction at the next ruleset version.
 *
 * Deliberately conservative: a job that is `processing` is left alone (its run
 * will finish and see the new version next time), and a suggestion whose product
 * was already created is not reopened for *that* message — a catalog row a human
 * edited must not be rewritten by a background pass.
 */
export async function reopenWhatsAppProductExtractionGroup(input: {
  workspaceId: string;
  messageIds: readonly string[];
  reason: "association_accepted" | "bundle_grown" | "media_arrived";
}): Promise<GroupReopenResult> {
  const memberIds = [...new Set(input.messageIds.filter(Boolean))].slice(
    0,
    GROUP_REOPEN_MEMBER_LIMIT,
  );
  if (memberIds.length === 0) {
    return { reopened: 0, created: 0, rulesetVersion: "v1" };
  }
  const now = new Date();
  const members = new Set(memberIds);

  // Everything the group already produced, from its members' ids alone: the
  // sources say which suggestions covered them, the suggestions say how far the
  // chain has run and whether a human already took one into the catalog, and the
  // jobs say which ruleset each read used.
  const [sourceRows, jobRows] = await Promise.all([
    db
      .select({
        messageId: productExtractionSources.messageId,
        suggestionId: productExtractionSources.suggestionId,
      })
      .from(productExtractionSources)
      .where(and(
        eq(productExtractionSources.workspaceId, input.workspaceId),
        inArray(productExtractionSources.messageId, memberIds),
      )),
    db
      .select({ rulesetVersion: whatsappProductExtractionJobs.rulesetVersion })
      .from(whatsappProductExtractionJobs)
      .where(and(
        eq(whatsappProductExtractionJobs.workspaceId, input.workspaceId),
        inArray(whatsappProductExtractionJobs.messageId, memberIds),
      )),
  ]);
  const priorSuggestionIds = [...new Set(
    sourceRows.map((row) => row.suggestionId).filter((id): id is string => Boolean(id)),
  )];
  const priorSuggestions = priorSuggestionIds.length > 0
    ? await db
        .select({
          id: productExtractionSuggestions.id,
          version: productExtractionSuggestions.version,
          productId: productExtractionSuggestions.productId,
        })
        .from(productExtractionSuggestions)
        .where(and(
          eq(productExtractionSuggestions.workspaceId, input.workspaceId),
          inArray(productExtractionSuggestions.id, priorSuggestionIds),
        ))
    : [];

  // A suggestion that already created a product freezes its message: the group
  // still re-extracts through its other members, but a live draft is never
  // quietly re-cut from under the merchant.
  const frozenSuggestionIds = new Set(
    priorSuggestions.filter((row) => row.productId).map((row) => row.id),
  );
  if (frozenSuggestionIds.size > 0) {
    for (const source of sourceRows) {
      if (source.suggestionId && frozenSuggestionIds.has(source.suggestionId)) {
        members.delete(source.messageId);
      }
    }
  }

  // A reading of the group that already covered every one of its members is not
  // worth paying for twice: bumping the version would make the worker re-run the
  // model on the same messages and file the same answer as a new version. Only a
  // group that actually gained something — the caption that was never read with
  // its photos, or media that arrived after the text was read — is reopened.
  const coveredBy = new Map<string, Set<string>>();
  for (const source of sourceRows) {
    if (!source.suggestionId) continue;
    const covered = coveredBy.get(source.suggestionId) ?? new Set<string>();
    covered.add(source.messageId);
    coveredBy.set(source.suggestionId, covered);
  }
  const alreadyReadTogether =
    input.reason !== "media_arrived" &&
    members.size > 0 &&
    priorSuggestions.some((row) => {
      const covered = coveredBy.get(row.id);
      return (
        Boolean(covered) &&
        [...members].every((messageId) => covered!.has(messageId)) &&
        // …and nothing outside the group was read with them, or the answer would
        // be a wider reading than the one the group now asks for.
        covered!.size === members.size
      );
    });
  if (alreadyReadTogether) {
    return {
      reopened: 0,
      created: 0,
      rulesetVersion: `v${Math.max(
        ...priorSuggestions.map((row) => row.version),
        1,
      )}`,
    };
  }

  // The maximum over the whole group, from both kinds of rows: a four-message
  // album has to stay on one chain instead of four chains at four numbers.
  const reachedVersion = Math.max(
    ...priorSuggestions.map((row) => row.version),
    ...jobRows.map((row) => groupVersionFrom(row.rulesetVersion)),
    1,
  );
  const rulesetVersion = `v${reachedVersion + 1}`;
  if (members.size === 0) {
    return { reopened: 0, created: 0, rulesetVersion };
  }

  const reopened = await db
    .update(whatsappProductExtractionJobs)
    .set({
      status: "pending",
      stage: "received",
      attempts: 0,
      lastError: null,
      rulesetVersion,
      // A new key per version, so the same group re-extracted twice is not
      // mistaken for a replay of the first run.
      idempotencyKey: sql`md5(${whatsappProductExtractionJobs.workspaceId} || ':' || ${whatsappProductExtractionJobs.messageId} || ':' || ${rulesetVersion})`,
      nextRunAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(whatsappProductExtractionJobs.workspaceId, input.workspaceId),
      inArray(whatsappProductExtractionJobs.messageId, [...members]),
      inArray(whatsappProductExtractionJobs.status, [...REOPENABLE_STATUSES]),
    ))
    .returning({ id: whatsappProductExtractionJobs.id });

  let created = 0;
  // A member with no job at all — imported before extraction existed, or whose
  // job was never created because it had nothing readable — gets one, or the
  // group would be read without it forever.
  {
    const jobless = await db
      .select({ messageId: whatsappProductExtractionJobs.messageId })
      .from(whatsappProductExtractionJobs)
      .where(and(
        eq(whatsappProductExtractionJobs.workspaceId, input.workspaceId),
        inArray(whatsappProductExtractionJobs.messageId, [...members]),
      ));
    const hasJob = new Set(jobless.map((row) => row.messageId));
    const withoutJob = await db
      .select({
        id: menaWhatsAppMessages.id,
        ownerId: menaWhatsAppMessages.ownerId,
        workspaceId: menaWhatsAppMessages.workspaceId,
      })
      .from(menaWhatsAppMessages)
      .where(and(
        eq(menaWhatsAppMessages.workspaceId, input.workspaceId),
        inArray(menaWhatsAppMessages.id, [...members]),
      ))
      .then((rows) => rows.filter((row) => !hasJob.has(row.id)));
    for (const message of withoutJob) {
      const jobId = createHash("sha256")
        .update(`whatsapp-product:${message.workspaceId}:${message.id}`)
        .digest("hex");
      await db
        .insert(whatsappProductExtractionJobs)
        .values({
          id: jobId,
          ownerId: message.ownerId,
          workspaceId: message.workspaceId,
          messageId: message.id,
          status: "pending",
          stage: "received",
          attempts: 0,
          rulesetVersion,
          dedupeKey: `${jobId}:${rulesetVersion}`,
          idempotencyKey: createHash("sha256")
            .update(`${message.workspaceId}:${message.id}:${rulesetVersion}`)
            .digest("hex"),
          nextRunAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      created += 1;
    }
  }

  if (reopened.length > 0 || created > 0) {
    logger.info(
      {
        workspaceId: input.workspaceId,
        reason: input.reason,
        rulesetVersion,
        members: members.size,
        reopened: reopened.length,
        created,
      },
      "WHATSAPP_PRODUCT_GROUP_REOPENED",
    );
  }
  return { reopened: reopened.length, created, rulesetVersion };
}

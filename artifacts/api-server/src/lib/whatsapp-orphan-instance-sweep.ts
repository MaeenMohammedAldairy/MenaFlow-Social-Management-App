/**
 * whatsapp-orphan-instance-sweep.ts
 *
 * Runs the orphan-instance sweep described in
 * `whatsapp-orphan-instance-policy.ts`: asks Evolution which instances exist,
 * works out which of them are leftovers this app created for workspaces that no
 * longer claim them, and deletes those.
 *
 * The rule that shapes every line here: **a failed sweep must never break the
 * action that triggered it.** Re-registering a webhook or pairing a phone number
 * are the merchant's two ways out of a dead inbox, and an unreachable Evolution
 * API must not turn either into an error. So listing failures are warn-logged and
 * reported as an empty result, and each delete is attempted independently.
 *
 * Deleting is bounded twice over — by the policy's per-run cap and by never
 * touching a name some workspace's connection row claims — because the cost of a
 * wrong deletion is a merchant's WhatsApp session being unlinked without their
 * consent, which no diagnostics row can undo.
 */

import { inArray } from "drizzle-orm";
import { db, menaWhatsAppConnections } from "@workspace/db";
import { EvolutionApiError, evolutionRequest } from "./whatsapp-evolution.ts";
import { logger } from "./logger.ts";
import {
  isMenaFlowInstanceName,
  parseEvolutionInstanceList,
  planOrphanInstanceCleanup,
  type OrphanInstanceOutcome,
} from "./whatsapp-orphan-instance-policy.ts";

/** Outcomes reported back to the caller; the rest stay in the log. */
const MAX_REPORTED_OUTCOMES = 25;

/** Names queried against the connection table in one `IN` list. */
const MAX_CANDIDATE_NAMES = 200;

export type OrphanSweepTrigger = "webhook_reconfigure" | "pairing";

export type OrphanSweepResult = {
  outcomes: OrphanInstanceOutcome[];
  deleted: number;
  failed: number;
  skipped: number;
  /** False when Evolution could not be listed, so nothing was attempted. */
  attempted: boolean;
};

const EMPTY_RESULT: OrphanSweepResult = {
  outcomes: [],
  deleted: 0,
  failed: 0,
  skipped: 0,
  attempted: false,
};

export type OrphanSweepInput = {
  workspaceId: string;
  /** The instance this request is connecting or re-registering. */
  keepInstanceName: string;
  phoneNumber?: string | null;
  trigger: OrphanSweepTrigger;
};

/**
 * Lists Evolution's instances, deletes the provable orphans, and reports every
 * instance it considered.
 *
 * Never throws, structurally rather than by inspection: both callers run this
 * inside a path where an exception would be worse than doing nothing. In pairing,
 * a throw lands in the handler's catch, which deletes the instance it just
 * created and marks the merchant's connection `failed` — a cleanup bug would then
 * break the very reconnect that was meant to fix the inbox.
 */
export async function sweepOrphanWhatsAppInstances(
  input: OrphanSweepInput,
): Promise<OrphanSweepResult> {
  try {
    return await runOrphanInstanceSweep(input);
  } catch (error) {
    logger.warn(
      {
        workspaceId: input.workspaceId,
        trigger: input.trigger,
        error,
      },
      "WHATSAPP_ORPHAN_INSTANCE_SWEEP_FAILED",
    );
    return { ...EMPTY_RESULT, attempted: true };
  }
}

async function runOrphanInstanceSweep(
  input: OrphanSweepInput,
): Promise<OrphanSweepResult> {
  const { workspaceId, keepInstanceName, trigger } = input;

  let instances;
  try {
    // `instance/fetchInstances` with no name returns every instance on the
    // server, which is the point: the orphans are exactly the ones no row here
    // knows about.
    const payload = await evolutionRequest("instance/fetchInstances");
    instances = parseEvolutionInstanceList(payload);
  } catch (error) {
    const code =
      error instanceof EvolutionApiError
        ? error.message
        : error instanceof Error
          ? error.message.slice(0, 80)
          : "EVOLUTION_API_REQUEST_FAILED";
    logger.warn(
      { workspaceId, trigger, code },
      "WHATSAPP_ORPHAN_INSTANCE_SWEEP_NOT_ATTEMPTED",
    );
    return EMPTY_RESULT;
  }

  // Only names this app could have created are candidates, so a shared Evolution
  // server's other tenants are never even queried about.
  const candidateNames = [
    ...new Set(
      instances
        .map((instance) => instance.instanceName)
        .filter((name) => name !== keepInstanceName && isMenaFlowInstanceName(name)),
    ),
  ].slice(0, MAX_CANDIDATE_NAMES);

  const claimedNames = new Set<string>();
  if (candidateNames.length > 0) {
    try {
      const claimed = await db
        .select({ instanceName: menaWhatsAppConnections.instanceName })
        .from(menaWhatsAppConnections)
        .where(inArray(menaWhatsAppConnections.instanceName, candidateNames));
      for (const row of claimed) claimedNames.add(row.instanceName);
    } catch (error) {
      // Without the claim list the sweep cannot tell an orphan from another
      // workspace's live session, so it must not delete anything at all.
      logger.warn(
        { workspaceId, trigger, error },
        "WHATSAPP_ORPHAN_INSTANCE_CLAIMS_UNAVAILABLE",
      );
      return { ...EMPTY_RESULT, attempted: true };
    }
  }

  const plan = planOrphanInstanceCleanup({
    instances,
    keepInstanceName,
    claimedInstanceNames: claimedNames,
    phoneNumber: input.phoneNumber ?? null,
  });

  const outcomes: OrphanInstanceOutcome[] = [];
  let deleted = 0;
  let failed = 0;

  for (const instance of plan.toDelete) {
    try {
      await evolutionRequest(
        `instance/delete/${encodeURIComponent(instance.instanceName)}`,
        { method: "DELETE" },
      );
      deleted += 1;
      outcomes.push({ ...instance, action: "deleted", reason: "DELETED" });
      logger.info(
        { workspaceId, trigger, instanceName: instance.instanceName },
        "WHATSAPP_ORPHAN_INSTANCE_DELETED",
      );
    } catch (error) {
      if (error instanceof EvolutionApiError && error.statusCode === 404) {
        // Already gone: the outcome the caller cares about is achieved.
        deleted += 1;
        outcomes.push({ ...instance, action: "deleted", reason: "DELETED" });
        continue;
      }
      failed += 1;
      outcomes.push({
        ...instance,
        action: "delete_failed",
        reason: "EVOLUTION_DELETE_FAILED",
      });
      logger.warn(
        {
          workspaceId,
          trigger,
          instanceName: instance.instanceName,
          error,
        },
        "WHATSAPP_ORPHAN_INSTANCE_DELETE_FAILED",
      );
    }
  }

  const skipped = plan.skipped.map(({ instance, reason }) => ({
    ...instance,
    action: "skipped" as const,
    reason,
  }));
  outcomes.push(...skipped);

  logger.info(
    {
      workspaceId,
      trigger,
      instances: instances.length,
      deleted,
      failed,
      skipped: skipped.length,
      // Names are workspace hashes, not personal data; the reasons are what make
      // a sweep that deleted nothing diagnosable.
      skippedReasons: skipped
        .slice(0, MAX_REPORTED_OUTCOMES)
        .map((entry) => `${entry.instanceName}:${entry.reason}`),
    },
    "WHATSAPP_ORPHAN_INSTANCE_SWEEP_COMPLETED",
  );

  return {
    outcomes: outcomes.slice(0, MAX_REPORTED_OUTCOMES),
    deleted,
    failed,
    skipped: skipped.length,
    attempted: true,
  };
}

/**
 * whatsapp-webhook-self-heal.ts
 *
 * Runtime wiring for the WhatsApp webhook self-healing worker. The decisions
 * live in `whatsapp-webhook-self-heal-policy.ts`; this module only reads the
 * diagnostics log, asks the existing sweep/reconfigure functions to repair,
 * and serialises cycles with a session-level advisory lock.
 *
 * Nothing here rewrites orphan ownership rules. Every deletion still goes
 * through `sweepOrphanWhatsAppInstances()` and the narrow policy it already
 * enforces; the scheduled trigger simply omits the merchant's phone number so
 * an orphan holding a different number is not skipped.
 */

import { and, desc, eq, gte } from "drizzle-orm";
import {
  db,
  menaInboundWebhookEvents,
  menaWhatsAppConnections,
  pool,
} from "@workspace/db";

import { logger } from "./logger.ts";
import {
  configureWhatsAppWebhook,
  EvolutionApiError,
  resolveWhatsAppWebhookSecret,
  whatsappWebhookUrl,
} from "./whatsapp-evolution.ts";
import { isInboundWebhookRejection } from "./inbound-webhook-diagnostics.ts";
import {
  sweepOrphanWhatsAppInstances,
  type OrphanSweepResult,
} from "./whatsapp-orphan-instance-sweep.ts";
import {
  DEFAULT_SELF_HEAL_PROBE_WINDOW_MS,
  DEFAULT_SELF_HEAL_RECONFIGURE_COOLDOWN_MS,
  DEFAULT_SELF_HEAL_VERIFY_WINDOW_MS,
  SELF_HEAL_ADVISORY_LOCK_KEY,
  WHATSAPP_WEBHOOK_PROCESSED_EVENT,
  WHATSAPP_WEBHOOK_REJECTED_SECRET_EVENT,
  WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE_EVENT,
  executeSelfHealCycle,
  runSelfHealWithLock,
  type InboundEventRow,
  type PendingVerification,
  type RepairResult,
  type WhatsAppInboundProbe,
  type WhatsAppRepairPlan,
} from "./whatsapp-webhook-self-heal-policy.ts";

export {
  executeSelfHealCycle,
  planWhatsAppWebhookRepair,
  runSelfHealWithLock,
  verifyWhatsAppRepair,
} from "./whatsapp-webhook-self-heal-policy.ts";

function envDuration(
  name: string,
  fallback: number,
  minimum = 1_000,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) return fallback;
  return parsed;
}

const pendingVerifications = new Map<string, PendingVerification>();
const lastReconfigureAt = new Map<string, number>();

/** Reads a bounded slice of the existing inbound diagnostics log. */
async function fetchInboundEvents(
  since: Date,
  until: Date,
): Promise<InboundEventRow[]> {
  try {
    const rows = await db
      .select({
        event: menaInboundWebhookEvents.event,
        instanceName: menaInboundWebhookEvents.instanceName,
        workspaceId: menaInboundWebhookEvents.workspaceId,
        createdAt: menaInboundWebhookEvents.createdAt,
      })
      .from(menaInboundWebhookEvents)
      .where(
        and(
          eq(menaInboundWebhookEvents.platform, "whatsapp"),
          gte(menaInboundWebhookEvents.createdAt, since),
        ),
      )
      .orderBy(desc(menaInboundWebhookEvents.createdAt))
      .limit(500);
    return rows
      .filter((row) => row.createdAt.getTime() <= until.getTime())
      .map((row) => ({
        event: row.event,
        instanceName: row.instanceName ?? null,
        workspaceId: row.workspaceId ?? null,
        createdAt: new Date(row.createdAt),
      }));
  } catch (error) {
    logger.warn({ error }, "WHATSAPP_SELF_HEAL_PROBE_READ_FAILED");
    return [];
  }
}

/** Detect: one log read plus the live connection list. No Evolution calls. */
export async function probeWhatsAppInboundHealth(
  now: Date = new Date(),
): Promise<WhatsAppInboundProbe> {
  const windowMs = envDuration(
    "WHATSAPP_SELF_HEAL_PROBE_WINDOW_MS",
    DEFAULT_SELF_HEAL_PROBE_WINDOW_MS,
  );
  const since = new Date(now.getTime() - windowMs);
  const events = await fetchInboundEvents(since, now);
  const connections = await db
    .select({
      workspaceId: menaWhatsAppConnections.workspaceId,
      instanceName: menaWhatsAppConnections.instanceName,
      phoneNumber: menaWhatsAppConnections.phoneNumber,
    })
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.status, "connected"));

  const unknownInstanceNames = [
    ...new Set(
      events
        .filter(
          (event) =>
            event.event === WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE_EVENT &&
            typeof event.instanceName === "string" &&
            event.instanceName.length > 0,
        )
        .map((event) => event.instanceName as string),
    ),
  ];
  const rejected = events.filter(
    (event) => event.event === WHATSAPP_WEBHOOK_REJECTED_SECRET_EVENT,
  );
  const rejectionTimes = events
    .filter((event) => isInboundWebhookRejection(event.event))
    .map((event) => event.createdAt.getTime());
  const acceptedTimes = events
    .filter((event) => event.event === WHATSAPP_WEBHOOK_PROCESSED_EVENT)
    .map((event) => event.createdAt.getTime());

  return {
    windowMs,
    unknownInstanceNames,
    rejectedSecretCount: rejected.length,
    lastRejectedAt: rejectionTimes.length
      ? new Date(Math.max(...rejectionTimes))
      : null,
    lastAcceptedAt: acceptedTimes.length
      ? new Date(Math.max(...acceptedTimes))
      : null,
    activeConnections: connections.map((connection) => ({
      workspaceId: connection.workspaceId,
      instanceName: connection.instanceName,
      phoneNumber: connection.phoneNumber ?? null,
    })),
  };
}

/**
 * Checks MenaFlow's own configuration before any blind reconfigure. Only
 * stable codes are returned; no secret, token or URL value is ever logged.
 */
export function validateWhatsAppWebhookConfiguration(): {
  valid: boolean;
  code: string | null;
} {
  try {
    if (!resolveWhatsAppWebhookSecret()) {
      return { valid: false, code: "WHATSAPP_WEBHOOK_SECRET_REQUIRED" };
    }
    whatsappWebhookUrl();
    return { valid: true, code: null };
  } catch (error) {
    return {
      valid: false,
      code:
        error instanceof EvolutionApiError
          ? error.message
          : "WHATSAPP_WEBHOOK_CONFIG_INVALID",
    };
  }
}

export type DetailedRepairResult = RepairResult & {
  sweep: OrphanSweepResult | null;
  configurationCode: string | null;
};

/**
 * Repair: uses the existing sweep and webhook configurator only. A support
 * request forces reconfiguration; the scheduled worker never does so without
 * a fresh `REJECTED_SECRET` decision from the policy.
 */
export async function repairWhatsAppInbound(input: {
  trigger: "scheduled" | "support";
  plan: WhatsAppRepairPlan;
  probe: WhatsAppInboundProbe;
  forceReconfigure?: boolean;
  now?: Date;
}): Promise<DetailedRepairResult> {
  const now = input.now ?? new Date();
  const configuration = validateWhatsAppWebhookConfiguration();
  const wantsReconfigure =
    input.plan.needsReconfigure || input.forceReconfigure === true;

  if (wantsReconfigure && !configuration.valid) {
    throw new EvolutionApiError(
      503,
      configuration.code ?? "WHATSAPP_WEBHOOK_CONFIG_INVALID",
    );
  }

  let sweep: OrphanSweepResult | null = null;
  const deletedInstanceNames: string[] = [];
  if (input.plan.needsSweep) {
    sweep = await sweepOrphanWhatsAppInstances({
      workspaceId: null,
      keepInstanceName: null,
      phoneNumber: null,
      trigger: "scheduled",
    });
    deletedInstanceNames.push(
      ...sweep.outcomes
        .filter((outcome) => outcome.action === "deleted")
        .map((outcome) => outcome.instanceName),
    );
  }

  const reconfiguredInstanceNames: string[] = [];
  if (wantsReconfigure) {
    const names = [
      ...new Set(input.probe.activeConnections.map((row) => row.instanceName)),
    ];
    for (const instanceName of names) {
      try {
        await configureWhatsAppWebhook(instanceName);
        reconfiguredInstanceNames.push(instanceName);
      } catch (error) {
        logger.warn(
          {
            instanceName,
            code:
              error instanceof EvolutionApiError
                ? error.message
                : "EVOLUTION_WEBHOOK_SET_FAILED",
          },
          "WHATSAPP_SELF_HEAL_RECONFIGURE_FAILED",
        );
      }
    }
  }

  const repaired =
    deletedInstanceNames.length > 0 || reconfiguredInstanceNames.length > 0;
  return {
    repairStartedAt: repaired ? now : null,
    deletedInstanceNames,
    reconfiguredInstanceNames,
    sweep,
    configurationCode: configuration.code,
  };
}

/** Maps the sweep result to the unchanged support-endpoint response shape. */
export function orphanCleanupFromSweep(sweep: OrphanSweepResult | null) {
  return {
    attempted: sweep?.attempted ?? false,
    deleted: sweep?.deleted ?? 0,
    failed: sweep?.failed ?? 0,
    skipped: sweep?.skipped ?? 0,
    instances: sweep?.outcomes ?? [],
  };
}

/**
 * Session-level advisory locks must be taken and released on the *same* pool
 * client; using two checkouts would unlock a different session and leave the
 * real lock held until disconnect.
 */
async function withSelfHealLock<T>(
  run: () => Promise<T>,
): Promise<{ acquired: boolean; result?: T }> {
  const client = await pool.connect();
  try {
    return await runSelfHealWithLock(
      async () => {
        const result = await client.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
          [SELF_HEAL_ADVISORY_LOCK_KEY],
        );
        return result.rows[0]?.acquired === true;
      },
      async () => {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
          SELF_HEAL_ADVISORY_LOCK_KEY,
        ]);
      },
      run,
    );
  } finally {
    client.release();
  }
}

/**
 * Worker entry point. The 5-minute interval is a polling period only: writes
 * happen exclusively when the policy finds a fresh problem.
 */
export async function runWhatsAppWebhookSelfHeal(
  now: Date = new Date(),
): Promise<void> {
  const outcome = await withSelfHealLock(() =>
      executeSelfHealCycle({
        now,
        probeHealth: () => probeWhatsAppInboundHealth(now),
        validateConfig: validateWhatsAppWebhookConfiguration,
        repair: (plan, probe) =>
          repairWhatsAppInbound({ trigger: "scheduled", plan, probe, now }),
        eventsSince: (since) => fetchInboundEvents(since, now),
        pendingVerifications,
        lastReconfigureAt,
        cooldownMs: envDuration(
          "WHATSAPP_SELF_HEAL_RECONFIGURE_COOLDOWN_MS",
          DEFAULT_SELF_HEAL_RECONFIGURE_COOLDOWN_MS,
        ),
        verifyWindowMs: envDuration(
          "WHATSAPP_SELF_HEAL_VERIFY_WINDOW_MS",
          DEFAULT_SELF_HEAL_VERIFY_WINDOW_MS,
        ),
        logger,
      }),
  );
  if (!outcome.acquired) {
    logger.debug({}, "WHATSAPP_SELF_HEAL_LOCK_BUSY");
  }
}

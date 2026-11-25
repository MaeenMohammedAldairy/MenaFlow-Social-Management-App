/**
 * whatsapp-webhook-self-heal-policy.ts
 *
 * Pure decision, verification and orchestration rules for the WhatsApp webhook
 * self-healing worker. No database, no network, no process state lives here: the
 * runtime module injects probes, repairs and loggers, so every branch of the
 * detect → decide → repair → verify cycle is testable without Evolution.
 *
 * The rule that shapes this file: observing a repair action is not the same as
 * observing delivery. `PROCESSED` for the active workspace and instance, logged
 * *after* the repair started, is the only accepted proof.
 */

import { isInboundWebhookRejection } from "./inbound-webhook-diagnostics.ts";

export const WHATSAPP_WEBHOOK_PROCESSED_EVENT = "WHATSAPP_WEBHOOK_PROCESSED";
export const WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE_EVENT =
  "WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE";
export const WHATSAPP_WEBHOOK_REJECTED_SECRET_EVENT =
  "WHATSAPP_WEBHOOK_REJECTED_SECRET";

export const DEFAULT_SELF_HEAL_PROBE_WINDOW_MS = 15 * 60_000;
export const DEFAULT_SELF_HEAL_VERIFY_WINDOW_MS = 15 * 60_000;
export const DEFAULT_SELF_HEAL_RECONFIGURE_COOLDOWN_MS = 30 * 60_000;
export const SELF_HEAL_ADVISORY_LOCK_KEY = "menaflow:whatsapp-webhook-self-heal";

/** One inbound diagnostics row, stripped down to what decisions need. */
export type InboundEventRow = {
  event: string;
  instanceName: string | null;
  workspaceId: string | null;
  createdAt: Date;
};

export type WhatsAppActiveConnection = {
  workspaceId: string;
  instanceName: string;
  phoneNumber: string | null;
};

export type WhatsAppInboundProbe = {
  windowMs: number;
  unknownInstanceNames: string[];
  rejectedSecretCount: number;
  lastRejectedAt: Date | null;
  lastAcceptedAt: Date | null;
  activeConnections: WhatsAppActiveConnection[];
};

export type RepairReason =
  | "UNKNOWN_INSTANCE"
  | "REJECTED_SECRET"
  | "CONFIG_INVALID_NO_RECONFIGURE"
  | "RECONFIGURE_COOLDOWN"
  | "RECOVERED"
  | "NO_ACTIVE_CONNECTION"
  | "NO_SIGNAL";

export type RepairAction =
  | "none"
  | "sweep"
  | "reconfigure"
  | "sweep_and_reconfigure";

export type WhatsAppRepairPlan = {
  action: RepairAction;
  reasons: RepairReason[];
  needsSweep: boolean;
  needsReconfigure: boolean;
};

function finite(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Decides whether anything should be written to Evolution.
 *
 * A rejection followed by a newer accepted event is a recovered incident, not
 * a repair target — reconfiguring there would be a blind write. Invalid local
 * configuration is never met with a reconfigure, because the call would fail
 * and the log would look like a repair attempt instead of a config error.
 */
export function planWhatsAppWebhookRepair(input: {
  probe: WhatsAppInboundProbe;
  now: number;
  configurationValid: boolean;
  lastReconfigureAt: number | null;
  cooldownMs?: number;
}): WhatsAppRepairPlan {
  const now = finite(input.now, Date.now());
  const cooldownMs = Math.max(
    1_000,
    finite(input.cooldownMs, DEFAULT_SELF_HEAL_RECONFIGURE_COOLDOWN_MS),
  );
  const probe = input.probe;
  const none = (reasons: RepairReason[]): WhatsAppRepairPlan => ({
    action: "none",
    reasons,
    needsSweep: false,
    needsReconfigure: false,
  });

  if (probe.activeConnections.length === 0) {
    return none(["NO_ACTIVE_CONNECTION"]);
  }

  const needsSweep = probe.unknownInstanceNames.length > 0;
  const hasRejection = probe.rejectedSecretCount > 0;
  const rejectedAt = probe.lastRejectedAt?.getTime() ?? null;
  const acceptedAt = probe.lastAcceptedAt?.getTime() ?? null;
  const recovered =
    !needsSweep &&
    rejectedAt !== null &&
    acceptedAt !== null &&
    acceptedAt > rejectedAt;

  if (recovered) return none(["RECOVERED"]);
  if (!needsSweep && !hasRejection) return none(["NO_SIGNAL"]);

  const reasons: RepairReason[] = [];
  if (needsSweep) reasons.push("UNKNOWN_INSTANCE");

  let needsReconfigure = false;
  if (hasRejection) {
    if (!input.configurationValid) {
      reasons.push("CONFIG_INVALID_NO_RECONFIGURE");
    } else if (
      input.lastReconfigureAt !== null &&
      now - finite(input.lastReconfigureAt, 0) < cooldownMs
    ) {
      reasons.push("RECONFIGURE_COOLDOWN");
    } else {
      needsReconfigure = true;
      reasons.push("REJECTED_SECRET");
    }
  }

  if (!needsSweep && !needsReconfigure) return none(reasons);

  return {
    action:
      needsSweep && needsReconfigure
        ? "sweep_and_reconfigure"
        : needsSweep
          ? "sweep"
          : "reconfigure",
    reasons,
    needsSweep,
    needsReconfigure,
  };
}

export type RepairVerificationState = "pass" | "pending" | "timeout" | "fail";

export type RepairVerification = {
  state: RepairVerificationState;
  reason: string;
  evidence?: {
    event: string;
    instanceName: string;
    workspaceId: string;
    createdAt: string;
  };
};

/**
 * Proves delivery, or refuses to claim it.
 *
 * Rejections aimed at instances the repair just deleted are tolerated: those
 * events were already in flight when the session was removed. Any other
 * rejection after the repair contradicts success, even if an accepted event is
 * also present.
 */
export function verifyWhatsAppRepair(input: {
  repairStartedAt: Date;
  events: readonly InboundEventRow[];
  activeInstanceName: string;
  activeWorkspaceId: string;
  toleratedInstanceNames?: readonly string[];
  now: number;
  windowMs?: number;
}): RepairVerification {
  const startedAt = input.repairStartedAt.getTime();
  const now = finite(input.now, Date.now());
  const windowMs = Math.max(
    1_000,
    finite(input.windowMs, DEFAULT_SELF_HEAL_VERIFY_WINDOW_MS),
  );
  const tolerated = new Set(input.toleratedInstanceNames ?? []);
  const after = input.events.filter(
    (event) => event.createdAt.getTime() >= startedAt,
  );

  const blockingRejection = after.find(
    (event) =>
      isInboundWebhookRejection(event.event) &&
      !(event.instanceName !== null && tolerated.has(event.instanceName)),
  );
  if (blockingRejection) {
    return { state: "fail", reason: blockingRejection.event };
  }

  const accepted = after.find(
    (event) =>
      event.event === WHATSAPP_WEBHOOK_PROCESSED_EVENT &&
      event.instanceName === input.activeInstanceName &&
      event.workspaceId === input.activeWorkspaceId,
  );
  if (accepted) {
    return {
      state: "pass",
      reason: WHATSAPP_WEBHOOK_PROCESSED_EVENT,
      evidence: {
        event: accepted.event,
        instanceName: accepted.instanceName ?? "",
        workspaceId: accepted.workspaceId ?? "",
        createdAt: accepted.createdAt.toISOString(),
      },
    };
  }

  if (now - startedAt >= windowMs) {
    return { state: "timeout", reason: "VERIFICATION_WINDOW_EXPIRED" };
  }
  return { state: "pending", reason: "AWAITING_ACCEPTED_EVENT" };
}

/** Returns true when exactly one caller owns the cycle, and always releases. */
export async function runSelfHealWithLock<T>(
  acquire: () => Promise<boolean>,
  release: () => Promise<void>,
  run: () => Promise<T>,
): Promise<{ acquired: boolean; result?: T }> {
  if (!(await acquire())) return { acquired: false };
  try {
    return { acquired: true, result: await run() };
  } finally {
    try {
      await release();
    } catch {
      // Releasing is best effort; a failed unlock expires with the session and
      // must not turn a completed repair into an error for the worker loop.
    }
  }
}

export type SelfHealLogger = {
  debug: (fields: Record<string, unknown>, message: string) => void;
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
};

export type RepairResult = {
  repairStartedAt: Date | null;
  deletedInstanceNames: string[];
  reconfiguredInstanceNames: string[];
};

export type PendingVerification = {
  workspaceId: string;
  instanceName: string;
  startedAt: number;
  toleratedInstanceNames: string[];
};

export type SelfHealCycleDeps = {
  now: Date;
  probeHealth: () => Promise<WhatsAppInboundProbe>;
  validateConfig: () => { valid: boolean; code: string | null };
  repair: (
    plan: WhatsAppRepairPlan,
    probe: WhatsAppInboundProbe,
  ) => Promise<RepairResult>;
  eventsSince: (since: Date) => Promise<InboundEventRow[]>;
  pendingVerifications: Map<string, PendingVerification>;
  lastReconfigureAt: Map<string, number>;
  cooldownMs: number;
  verifyWindowMs: number;
  logger: SelfHealLogger;
};

export type SelfHealCycleResult = {
  action: RepairAction;
  reasons: RepairReason[];
  verifications: RepairVerification[];
  repair: RepairResult | null;
};

export function pendingVerificationKey(
  workspaceId: string,
  instanceName: string,
): string {
  return `${workspaceId}:${instanceName}`;
}

/**
 * One monitor tick: finish outstanding verifications, probe, decide, repair,
 * arm verification. No Evolution write happens on the `none` branch.
 */
export async function executeSelfHealCycle(
  deps: SelfHealCycleDeps,
): Promise<SelfHealCycleResult> {
  const verifications: RepairVerification[] = [];

  for (const [key, pending] of [...deps.pendingVerifications]) {
    const events = await deps.eventsSince(new Date(pending.startedAt));
    const result = verifyWhatsAppRepair({
      repairStartedAt: new Date(pending.startedAt),
      events,
      activeInstanceName: pending.instanceName,
      activeWorkspaceId: pending.workspaceId,
      toleratedInstanceNames: pending.toleratedInstanceNames,
      now: deps.now.getTime(),
      windowMs: deps.verifyWindowMs,
    });
    verifications.push(result);
    if (result.state === "pass") {
      deps.logger.info(
        {
          workspaceId: pending.workspaceId,
          instanceName: pending.instanceName,
          event: result.evidence?.event ?? null,
          createdAt: result.evidence?.createdAt ?? null,
        },
        "WHATSAPP_SELF_HEAL_VERIFIED",
      );
    } else if (result.state === "fail") {
      deps.logger.warn(
        {
          workspaceId: pending.workspaceId,
          instanceName: pending.instanceName,
          reason: result.reason,
        },
        "WHATSAPP_SELF_HEAL_VERIFICATION_FAILED",
      );
    } else if (result.state === "timeout") {
      deps.logger.warn(
        {
          workspaceId: pending.workspaceId,
          instanceName: pending.instanceName,
          reason: result.reason,
        },
        "WHATSAPP_SELF_HEAL_VERIFICATION_TIMEOUT",
      );
    }
    if (result.state !== "pending") deps.pendingVerifications.delete(key);
  }

  const probe = await deps.probeHealth();
  const configuration = deps.validateConfig();
  const lastReconfigure = Math.max(
    0,
    ...probe.activeConnections.map(
      (connection) => deps.lastReconfigureAt.get(connection.instanceName) ?? 0,
    ),
  );
  const plan = planWhatsAppWebhookRepair({
    probe,
    now: deps.now.getTime(),
    configurationValid: configuration.valid,
    lastReconfigureAt: lastReconfigure === 0 ? null : lastReconfigure,
    cooldownMs: deps.cooldownMs,
  });

  if (
    !configuration.valid &&
    (plan.reasons.includes("REJECTED_SECRET") ||
      plan.reasons.includes("CONFIG_INVALID_NO_RECONFIGURE"))
  ) {
    deps.logger.warn(
      { code: configuration.code },
      "WHATSAPP_SELF_HEAL_CONFIG_INVALID_NO_RECONFIGURE",
    );
  }

  if (plan.action === "none") {
    deps.logger.debug({ reasons: plan.reasons }, "WHATSAPP_SELF_HEAL_NO_ACTION");
    return {
      action: "none",
      reasons: plan.reasons,
      verifications,
      repair: null,
    };
  }

  deps.logger.info(
    {
      action: plan.action,
      reasons: plan.reasons,
      unknownInstanceNames: probe.unknownInstanceNames.length,
      activeInstances: probe.activeConnections.length,
    },
    "WHATSAPP_SELF_HEAL_REPAIR_STARTED",
  );

  const repair = await deps.repair(plan, probe);
  if (plan.needsReconfigure) {
    for (const connection of probe.activeConnections) {
      deps.lastReconfigureAt.set(connection.instanceName, deps.now.getTime());
    }
  }
  if (repair.repairStartedAt) {
    for (const connection of probe.activeConnections) {
      deps.pendingVerifications.set(
        pendingVerificationKey(connection.workspaceId, connection.instanceName),
        {
          workspaceId: connection.workspaceId,
          instanceName: connection.instanceName,
          startedAt: repair.repairStartedAt.getTime(),
          toleratedInstanceNames: repair.deletedInstanceNames,
        },
      );
    }
  }

  return { action: plan.action, reasons: plan.reasons, verifications, repair };
}

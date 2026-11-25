/**
 * whatsapp-orphan-instance-policy.ts
 *
 * Decides which Evolution instances may be deleted when a merchant re-registers
 * their webhook or re-pairs a phone number, and which must be left alone.
 *
 * The problem this exists for, observed in production on 2026-11-24: the
 * delivery log filled with `WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE` for
 * `menaflow-a898bc54ab23` while the merchant's workspace was connected as
 * `menaflow-3c247db8a54d`, and `mena_whatsapp_direct_messages` held zero rows.
 * Instance names are `menaflow-` + sha256(workspaceId)[0:12]
 * (`whatsapp-instance.ts`), so that name is the deterministic instance of a
 * workspace id that no longer exists in `mena_workspaces` — a session left
 * behind by a workspace that was deleted or migrated away. It was still linked
 * to the merchant's phone, still had our webhook URL registered, and still
 * received every incoming message, which this server then refused because no
 * connection row matched. The merchant's live instance was configured and could
 * serve history syncs, but the orphan was the session holding the live events.
 *
 * Deleting an Evolution instance unlinks a WhatsApp session, so the rules here
 * are deliberately narrow. Everything that is not provably ours-and-unclaimed is
 * skipped with a named reason rather than deleted on suspicion:
 *
 * - only names carrying the `menaflow-` prefix (this app never touches instances
 *   it did not create; an Evolution server can be shared),
 * - never the instance the merchant is currently connecting,
 * - never a name another workspace's connection row claims (deleting it would
 *   break a live tenant — this is what the duplicate-workspace case looks like,
 *   and it is reported for an operator instead of resolved by force),
 * - never an instance bound to a different phone number,
 * - and at most a bounded number per run.
 *
 * Pure on purpose: no database and no network here, so the rules are testable
 * and the caller decides what to do with the plan.
 */

/** The prefix every instance this app creates carries. */
export const MENAFLOW_INSTANCE_PREFIX = "menaflow-";

/**
 * Instances deleted per run. A sweep is a repair, not a purge: if something
 * upstream returns a whole shared Evolution server as unclaimed, the damage stops
 * after five sessions and the rest are reported instead.
 */
export const ORPHAN_INSTANCE_CLEANUP_LIMIT = 5;

export type OrphanCleanupReason =
  /** The instance the merchant is connecting or re-registering right now. */
  | "KEEP_ACTIVE_INSTANCE"
  /** Another workspace's connection row names it; it is not an orphan. */
  | "CLAIMED_BY_WORKSPACE"
  /** Bound to a different phone number than the one being connected. */
  | "PHONE_NUMBER_MISMATCH"
  /** Not a name this app would have created. */
  | "NOT_CREATED_BY_MENAFLOW"
  /** Beyond the per-run cap; a later run can pick it up. */
  | "CLEANUP_LIMIT_REACHED";

export type OrphanInstanceAction =
  | "deleted"
  | "delete_failed"
  | "skipped"
  /** The sweep never ran (Evolution unreachable, or listing failed). */
  | "not_attempted";

/** One instance as Evolution reported it, normalized. */
export type EvolutionInstanceSummary = {
  instanceName: string;
  /** Digits only, or null when Evolution did not report a number. */
  phoneNumber: string | null;
  /** Evolution's own state word (`open`, `connecting`, `close`, …). */
  connectionStatus: string | null;
};

/** What the API reports back per instance, so the merchant sees the outcome. */
export type OrphanInstanceOutcome = {
  instanceName: string;
  phoneNumber: string | null;
  connectionStatus: string | null;
  action: OrphanInstanceAction;
  reason: OrphanCleanupReason | "DELETED" | "EVOLUTION_DELETE_FAILED";
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Strips formatting so `+967 777 187 184` and `967777187184` compare equal. */
export function whatsappPhoneDigits(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits ? digits : null;
}

export function isMenaFlowInstanceName(instanceName: string): boolean {
  return instanceName.startsWith(MENAFLOW_INSTANCE_PREFIX);
}

/**
 * Normalizes `GET /instance/fetchInstances`.
 *
 * Evolution has returned this list in more than one shape across versions: a
 * bare array, or wrapped in `instance`/`data`/`instances`; each item either flat
 * (`name`, `number`, `connectionStatus`) or nested under its own `instance`
 * object (`instanceName`, `number`, `state`). Every shape is accepted, and items
 * without a usable name are dropped rather than guessed at — a sweep that cannot
 * name an instance must not delete one.
 */
export function parseEvolutionInstanceList(payload: unknown): EvolutionInstanceSummary[] {
  const body = record(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(body?.instance)
      ? body.instance
      : Array.isArray(body?.data)
        ? body.data
        : Array.isArray(body?.instances)
          ? body.instances
          : null;
  if (!list) return [];

  const parsed: EvolutionInstanceSummary[] = [];
  for (const item of list) {
    const flat = record(item);
    if (!flat) continue;
    const nested = record(flat.instance) ?? record(flat.data);
    const instanceName =
      text(flat.name) ??
      text(flat.instanceName) ??
      text(nested?.instanceName) ??
      text(nested?.name);
    if (!instanceName) continue;
    const rawNumber =
      text(flat.number) ??
      text(flat.phoneNumber) ??
      text(nested?.number) ??
      text(nested?.phoneNumber);
    const rawStatus =
      text(flat.connectionStatus) ??
      text(flat.state) ??
      text(flat.status) ??
      text(nested?.state) ??
      text(nested?.connectionStatus) ??
      text(nested?.status);
    parsed.push({
      instanceName,
      phoneNumber: whatsappPhoneDigits(rawNumber),
      connectionStatus: rawStatus ? rawStatus.toLowerCase() : null,
    });
  }
  return parsed;
}

export type OrphanCleanupPlan = {
  /** Instance names safe to delete, in the order Evolution reported them. */
  toDelete: EvolutionInstanceSummary[];
  skipped: Array<{ instance: EvolutionInstanceSummary; reason: OrphanCleanupReason }>;
};

/**
 * Splits Evolution's instance list into what may be deleted and what may not.
 *
 * `claimedInstanceNames` are the names `mena_whatsapp_connections` holds for any
 * workspace — including `keepInstanceName`, which is listed separately so a
 * caller cannot accidentally sweep the instance it is repairing. An instance
 * whose number Evolution did not report is still deletable when it is unclaimed
 * and carries our prefix: naming is deterministic per workspace, so such an
 * instance can only be the leftover of a workspace that no longer exists.
 */
export function planOrphanInstanceCleanup(input: {
  instances: readonly EvolutionInstanceSummary[];
  /** The instance this request is connecting or re-registering. */
  keepInstanceName: string | null;
  /** Every instance name a connection row in any workspace claims. */
  claimedInstanceNames: ReadonlySet<string> | readonly string[];
  /** Digits of the phone number being connected, when known. */
  phoneNumber?: string | null;
  limit?: number;
}): OrphanCleanupPlan {
  // Both a Set and a readonly array are iterable, so one spread covers them.
  const claimed = new Set([...input.claimedInstanceNames]);
  const keep = input.keepInstanceName?.trim() || null;
  const wantedDigits = whatsappPhoneDigits(input.phoneNumber);
  const limit = Number.isSafeInteger(input.limit) && (input.limit as number) > 0
    ? Math.min(input.limit as number, ORPHAN_INSTANCE_CLEANUP_LIMIT)
    : ORPHAN_INSTANCE_CLEANUP_LIMIT;

  const toDelete: EvolutionInstanceSummary[] = [];
  const skipped: OrphanCleanupPlan["skipped"] = [];

  for (const instance of input.instances) {
    const skip = (reason: OrphanCleanupReason) => {
      skipped.push({ instance, reason });
    };

    if (keep && instance.instanceName === keep) {
      skip("KEEP_ACTIVE_INSTANCE");
      continue;
    }
    if (!isMenaFlowInstanceName(instance.instanceName)) {
      skip("NOT_CREATED_BY_MENAFLOW");
      continue;
    }
    if (claimed.has(instance.instanceName)) {
      skip("CLAIMED_BY_WORKSPACE");
      continue;
    }
    if (wantedDigits && instance.phoneNumber && instance.phoneNumber !== wantedDigits) {
      skip("PHONE_NUMBER_MISMATCH");
      continue;
    }
    if (toDelete.length >= limit) {
      skip("CLEANUP_LIMIT_REACHED");
      continue;
    }
    toDelete.push(instance);
  }

  return { toDelete, skipped };
}

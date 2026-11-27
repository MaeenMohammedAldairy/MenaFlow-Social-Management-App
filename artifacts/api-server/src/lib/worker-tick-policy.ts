/**
 * worker-tick-policy.ts
 *
 * Access rules for `POST /api/internal/worker-tick`, the one route whose whole
 * job is "run one pass over every queue now".
 *
 * It exists because the queues have no other driver in production: every worker
 * is a `setInterval` inside the API process (`app.ts` → `startAppWorkerLoops`),
 * `vercel.json` carries no `crons`, and a frozen instance runs no timers — so
 * media rows and extraction jobs sit past their own `next_attempt_at` /
 * `next_run_at` until a customer opens the app. A scheduler needs a door, and a
 * door that runs paid AI calls and outbound WhatsApp messages cannot be open.
 *
 * The three rules, in the order they are checked:
 *
 * 1. **Nothing configured, nothing served** — `TICK_DISABLED`, answered as 503.
 *    A deployment that has not decided gets an honest "this route is not
 *    enabled", never an accidental "anyone may knock". This is also why setting
 *    `MENA_WORKER_TICK_SECRET` to a short value disables the route rather than
 *    falling back to `CRON_SECRET`: a half-configured secret is the worst of the
 *    three states, because it looks enabled in the dashboard.
 * 2. **The secret is a list** (`MENA_WORKER_TICK_SECRET`, comma-separated, like
 *    `MENA_OWNER_CONSOLE_TOKEN`) so it can be rotated without a window where the
 *    scheduler's old value is rejected.
 * 3. **Short values are not secrets.** Anything under 24 characters is treated as
 *    unset. A typo in a dashboard should disable a route, not protect it.
 *
 * Comparison is over SHA-256 digests with `timingSafeEqual`, so neither the
 * secret's length nor its content leaks through timing, and a caller cannot make
 * the comparison cheap by sending a short prefix.
 *
 * Pure: reads an injected `env` and a header string, so the rules that keep the
 * route safe are the rules a unit test can reach — the route file itself cannot
 * be imported without pulling in `app-workers.ts` and the whole server graph.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** Below this, a value is a mistake rather than a bearer token. */
export const MIN_WORKER_TICK_SECRET_LENGTH = 24;

/**
 * What a pass may take before it defers the remaining queues. A fifth of a
 * second under Vercel's 25s default function limit, so a tick answers with what
 * it did instead of being killed mid-pass.
 */
export const DEFAULT_WORKER_TICK_BUDGET_MS = 25_000;

export type WorkerTickAccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "TICK_DISABLED" | "TICK_TOKEN_MISSING" | "TICK_TOKEN_REJECTED";
      /** 503 when the server cannot serve the route, 401 when the caller may not. */
      status: 503 | 401;
    };

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= MIN_WORKER_TICK_SECRET_LENGTH);
}

/**
 * The accepted secrets.
 *
 * `MENA_WORKER_TICK_SECRET` is the dedicated name and wins on its own. It falls
 * back to `CRON_SECRET` — which Vercel sends automatically as
 * `Authorization: Bearer <CRON_SECRET>` for a cron declared in `vercel.json` — only
 * when no dedicated value is configured.
 */
export function workerTickSecrets(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const dedicated = splitList(env.MENA_WORKER_TICK_SECRET);
  if (dedicated.length > 0) return dedicated;
  return splitList(env.CRON_SECRET);
}

function parseBearer(value: string | null | undefined):
  | { kind: "missing" }
  | { kind: "rejected" }
  | { kind: "token"; token: string } {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return { kind: "missing" };
  const [scheme, ...rest] = trimmed.split(/\s+/);
  const token = rest.join(" ").trim();
  if (scheme.toLowerCase() !== "bearer") return { kind: "rejected" };
  if (!token) return { kind: "missing" };
  return { kind: "token", token };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function secretMatches(token: string, secrets: readonly string[]): boolean {
  const candidate = digest(token);
  let matched = false;
  // Every entry is compared, so an early hit cannot be told apart from a miss by
  // how long the request took.
  for (const secret of secrets) {
    if (timingSafeEqual(candidate, digest(secret))) matched = true;
  }
  return matched;
}

export function decideWorkerTickAccess(input: {
  authorization?: string | null;
  env?: NodeJS.ProcessEnv;
}): WorkerTickAccessDecision {
  const secrets = workerTickSecrets(input.env ?? process.env);
  if (secrets.length === 0) {
    return { allowed: false, code: "TICK_DISABLED", status: 503 };
  }
  const header = parseBearer(input.authorization);
  if (header.kind === "missing") {
    return { allowed: false, code: "TICK_TOKEN_MISSING", status: 401 };
  }
  if (header.kind === "rejected" || !secretMatches(header.token, secrets)) {
    return { allowed: false, code: "TICK_TOKEN_REJECTED", status: 401 };
  }
  return { allowed: true };
}

/**
 * The pass budget, from `MENA_WORKER_TICK_BUDGET_MS`.
 *
 * `0` means "no limit", which is what a long-lived worker service wants. A
 * garbage value falls back to the default rather than to no limit: an
 * unbounded pass is the behaviour a timeout guard was supposed to prevent, so
 * it must never be the result of a typo.
 */
export function workerTickBudgetMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.MENA_WORKER_TICK_BUDGET_MS?.trim();
  if (!raw) return DEFAULT_WORKER_TICK_BUDGET_MS;
  // Digits only: a negative, a decimal, an exponent and a typo all fall back to
  // the default, and only an explicit `0` means "no limit".
  if (!/^\d+$/.test(raw)) return DEFAULT_WORKER_TICK_BUDGET_MS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : DEFAULT_WORKER_TICK_BUDGET_MS;
}

/**
 * Worker names a caller asked to restrict the pass to, from `?workers=a,b`.
 *
 * Unknown names are returned anyway: the pass filters by exact match, so a typo
 * yields an empty tick that the response can show, rather than a 400 that a cron
 * configuration UI cannot read.
 */
export function parseWorkerTickWorkers(
  value: string | null | undefined,
): string[] | null {
  const list = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

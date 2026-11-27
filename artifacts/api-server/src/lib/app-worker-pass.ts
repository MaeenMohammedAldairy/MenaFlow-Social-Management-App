/**
 * app-worker-pass.ts
 *
 * One pass over a list of background workers, for a caller that owns no timer.
 *
 * The loops in `app-workers.ts` are `setInterval`s inside the API process. On a
 * serverless deployment the process is frozen between requests, so the timers
 * only run while an instance happens to be warm: on 2026-11-27 four media rows
 * sat past `next_attempt_at` and thirteen extraction jobs past `next_run_at`
 * because nothing was awake to look at them. A scheduler — Vercel's cron, a
 * container's entrypoint, a GitHub Action, `systemd` — can call this instead, and
 * then the queue advances whether or not a merchant is in the app.
 *
 * Three behaviours make that safe, and they are the only reason this file exists
 * separately (so they can be tested without importing the server graph):
 *
 * - **Overlap is refused, not queued.** A pass that arrives while a worker is
 *   still running reports it `busy` and moves on. Two concurrent media-download
 *   passes on one queue is how a 30-second lambda becomes a 60-second one.
 * - **One worker's error does not end the pass.** A stalled extraction queue must
 *   not stop replies or push, and the error is named per worker so the response
 *   says what is broken instead of answering `{ok:false}`.
 * - **A budget defers the rest.** A platform timeout kills a function mid-pass;
 *   returning `deferred: ["media-thumbnails"]` is a pass an operator can read.
 */

export type WorkerPassDefinition = {
  name: string;
  enabled: () => boolean;
  run: () => unknown | Promise<unknown>;
};

export type WorkerPassResult = {
  /** Workers this pass ran to completion (their own errors are in `failed`). */
  ran: string[];
  /** Workers switched off by configuration — not failures, not oversights. */
  disabled: string[];
  /** Workers still busy from an earlier pass, so this one did not double up. */
  busy: string[];
  /** Workers the budget ran out before reaching, in registration order. */
  deferred: string[];
  failed: Array<{ name: string; error: string }>;
  /** Passes taken, so a caller can tell an empty tick from a full one. */
  processed: number;
  durationMs: number;
};

/** Shared by every caller that does not bring its own set. */
const defaultInFlight = new Set<string>();

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error).slice(0, 300);
}

export async function runWorkerPass(
  input: {
    definitions: readonly WorkerPassDefinition[];
    /** Restrict the pass to these names — one queue can be driven alone. */
    only?: readonly string[] | null;
    /** Wall-clock limit for the pass; `0` means no limit. */
    budgetMs?: number;
    now?: () => number;
    inFlight?: Set<string>;
  },
): Promise<WorkerPassResult> {
  const now = input.now ?? (() => Date.now());
  const inFlight = input.inFlight ?? defaultInFlight;
  const budgetMs = input.budgetMs ?? 25_000;
  const only = input.only && input.only.length > 0 ? new Set(input.only) : null;
  const startedAt = now();

  const result: WorkerPassResult = {
    ran: [],
    disabled: [],
    busy: [],
    deferred: [],
    failed: [],
    processed: 0,
    durationMs: 0,
  };

  for (const definition of input.definitions) {
    if (only && !only.has(definition.name)) continue;
    if (!definition.enabled()) {
      result.disabled.push(definition.name);
      continue;
    }
    // Only ask the clock once something has been done: the first worker is never
    // deferred, so a tiny budget still advances one queue instead of reporting a
    // tick that did nothing.
    if (
      budgetMs > 0 &&
      result.ran.length + result.failed.length > 0 &&
      now() - startedAt >= budgetMs
    ) {
      result.deferred.push(definition.name);
      continue;
    }
    if (inFlight.has(definition.name)) {
      result.busy.push(definition.name);
      continue;
    }

    inFlight.add(definition.name);
    try {
      await definition.run();
      result.ran.push(definition.name);
    } catch (error) {
      result.failed.push({ name: definition.name, error: describeError(error) });
    } finally {
      inFlight.delete(definition.name);
    }
  }

  result.processed = result.ran.length + result.failed.length;
  result.durationMs = now() - startedAt;
  return result;
}

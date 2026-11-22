export type BackgroundWorkerLoopHandle = {
  stop: () => Promise<void>;
};

/**
 * Heartbeat of one background worker loop, exposed through `/readyz`.
 *
 * Queue workers run inside the API process, so a deployment that never starts
 * them looks healthy from the outside: the API answers requests while replies
 * silently pile up in the database. These counters make a stopped or crashing
 * worker visible without reading the logs.
 */
export type BackgroundWorkerSnapshot = {
  name: string;
  intervalMs: number;
  startedAt: string;
  running: boolean;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  lastRunDurationMs: number | null;
  consecutiveErrors: number;
  lastError: string | null;
  lastErrorAt: string | null;
  /** True when the loop missed several expected cycles (or never completed one). */
  stale: boolean;
};

type BackgroundWorkerState = {
  intervalMs: number;
  startedAt: number;
  running: boolean;
  lastRunStartedAt: number | null;
  lastRunFinishedAt: number | null;
  lastRunDurationMs: number | null;
  consecutiveErrors: number;
  lastError: string | null;
  lastErrorAt: number | null;
};

const activeLoops = new Map<string, BackgroundWorkerLoopHandle>();
const workerStates = new Map<string, BackgroundWorkerState>();

const staleGraceMs = 15_000;

function staleAfterMs(intervalMs: number): number {
  return Math.max(intervalMs, 1_000) * 3 + staleGraceMs;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error).slice(0, 300);
}

export function backgroundWorkerSnapshots(
  now: number = Date.now(),
): BackgroundWorkerSnapshot[] {
  return [...workerStates.entries()].map(([name, state]) => {
    const lastActivity = state.lastRunFinishedAt ?? state.startedAt;
    return {
      name,
      intervalMs: state.intervalMs,
      startedAt: new Date(state.startedAt).toISOString(),
      running: state.running,
      lastRunStartedAt:
        state.lastRunStartedAt === null
          ? null
          : new Date(state.lastRunStartedAt).toISOString(),
      lastRunFinishedAt:
        state.lastRunFinishedAt === null
          ? null
          : new Date(state.lastRunFinishedAt).toISOString(),
      lastRunDurationMs: state.lastRunDurationMs,
      consecutiveErrors: state.consecutiveErrors,
      lastError: state.lastError,
      lastErrorAt:
        state.lastErrorAt === null
          ? null
          : new Date(state.lastErrorAt).toISOString(),
      stale: now - lastActivity > staleAfterMs(state.intervalMs),
    };
  });
}

export function startBackgroundWorkerLoop(
  name: string,
  runOnce: () => Promise<number>,
  onError: (error: unknown) => void,
  idleIntervalMs = 3_000,
  drainImmediately = true,
): BackgroundWorkerLoopHandle {
  const existing = activeLoops.get(name);
  if (existing) return existing;

  let stopping = false;
  let timer: NodeJS.Timeout | null = null;
  let activeRun: Promise<void> | null = null;

  const state: BackgroundWorkerState = {
    intervalMs: idleIntervalMs,
    startedAt: Date.now(),
    running: false,
    lastRunStartedAt: null,
    lastRunFinishedAt: null,
    lastRunDurationMs: null,
    consecutiveErrors: 0,
    lastError: null,
    lastErrorAt: null,
  };
  workerStates.set(name, state);

  const schedule = (delayMs: number) => {
    if (stopping) return;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delayMs);
    timer.unref();
  };

  const run = () => {
    if (stopping || activeRun) return;
    const startedAt = Date.now();
    state.running = true;
    state.lastRunStartedAt = startedAt;
    activeRun = Promise.resolve()
      .then(runOnce)
      .then((processed) => {
        state.consecutiveErrors = 0;
        schedule(drainImmediately && processed > 0 ? 0 : idleIntervalMs);
      })
      .catch((error: unknown) => {
        state.consecutiveErrors += 1;
        state.lastError = describeError(error);
        state.lastErrorAt = Date.now();
        onError(error);
        schedule(idleIntervalMs);
      })
      .finally(() => {
        const finishedAt = Date.now();
        state.lastRunFinishedAt = finishedAt;
        state.lastRunDurationMs = finishedAt - startedAt;
        state.running = false;
        activeRun = null;
      });
  };

  const handle: BackgroundWorkerLoopHandle = {
    async stop() {
      if (stopping) {
        await activeRun;
        return;
      }
      stopping = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await activeRun;
      if (activeLoops.get(name) === handle) activeLoops.delete(name);
    },
  };

  activeLoops.set(name, handle);
  run();
  return handle;
}

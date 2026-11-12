export type BackgroundWorkerLoopHandle = {
  stop: () => Promise<void>;
};

const activeLoops = new Map<string, BackgroundWorkerLoopHandle>();

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
    activeRun = Promise.resolve()
      .then(runOnce)
      .then((processed) => {
        schedule(drainImmediately && processed > 0 ? 0 : idleIntervalMs);
      })
      .catch((error: unknown) => {
        onError(error);
        schedule(idleIntervalMs);
      })
      .finally(() => {
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

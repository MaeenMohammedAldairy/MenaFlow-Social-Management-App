export type WhatsAppCloudWorkerLoopHandle = {
  stop: () => Promise<void>;
};

let activeLoop: WhatsAppCloudWorkerLoopHandle | null = null;

export function startWhatsAppCloudWorkerLoop(
  runOnce: () => Promise<number>,
  onError: (error: unknown) => void,
  idleIntervalMs = 3_000,
): WhatsAppCloudWorkerLoopHandle {
  if (activeLoop) return activeLoop;

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
        schedule(processed > 0 ? 0 : idleIntervalMs);
      })
      .catch((error: unknown) => {
        onError(error);
        schedule(idleIntervalMs);
      })
      .finally(() => {
        activeRun = null;
      });
  };

  const handle: WhatsAppCloudWorkerLoopHandle = {
    async stop() {
      if (stopping) {
        await activeRun;
        return;
      }
      stopping = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await activeRun;
      if (activeLoop === handle) activeLoop = null;
    },
  };

  activeLoop = handle;
  run();
  return handle;
}

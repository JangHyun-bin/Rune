import type { HotExitSnapshot } from "./hotExit";

export function createHotExitStore(
  snapshot: () => HotExitSnapshot | null,
  save: (value: HotExitSnapshot) => Promise<void>,
  clear: () => Promise<void>,
  delay: number,
  onError: (error: unknown) => void = () => {},
  startEnabled = true,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let enabled = startEnabled;
  let writes = Promise.resolve();

  const enqueue = (): Promise<void> => {
    pending = false;
    const value = snapshot();
    writes = writes.catch(() => {}).then(() => value ? save(value) : clear());
    return writes;
  };

  const cancelTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  return {
    schedule(): void {
      pending = true;
      cancelTimer();
      if (!enabled) return;
      timer = setTimeout(() => {
        timer = undefined;
        void enqueue().catch(onError);
      }, delay);
    },
    flush(): Promise<void> {
      cancelTimer();
      if (!enabled) return writes;
      return pending ? enqueue() : writes;
    },
    async discard(): Promise<void> {
      cancelTimer();
      pending = false;
      await writes.catch(() => {});
      await clear();
    },
    enable(flushPending = true): void {
      enabled = true;
      if (pending && flushPending) this.schedule();
      else pending = false;
    },
  };
}

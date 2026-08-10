import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHotExitStore } from "./hotExitStore";
import type { HotExitSnapshot } from "./hotExit";

const recovered = (text: string): HotExitSnapshot => ({
  version: 1,
  workspaceRoot: "C:/notes",
  activePaneId: "pane-1",
  panes: [{
    id: "pane-1",
    tabs: [{ path: null, savedText: "", currentText: text, active: true }],
  }],
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Hot Exit store scheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("debounces edits and persists the latest recovery snapshot", async () => {
    let snapshot: HotExitSnapshot | null = recovered("first");
    const save = vi.fn(async () => {});
    const clear = vi.fn(async () => {});
    const store = createHotExitStore(() => snapshot, save, clear, 250);

    store.schedule();
    snapshot = recovered("latest");
    store.schedule();
    await vi.advanceTimersByTimeAsync(250);
    await store.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(recovered("latest"));
    expect(clear).not.toHaveBeenCalled();
  });

  it("removes stale recovery data when every tab becomes clean", async () => {
    const clear = vi.fn(async () => {});
    const store = createHotExitStore(() => null, vi.fn(async () => {}), clear, 250);

    store.schedule();
    await store.flush();

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight save before clearing on an approved shutdown", async () => {
    const pending = deferred();
    const calls: string[] = [];
    const store = createHotExitStore(
      () => recovered("dirty"),
      async () => { calls.push("save:start"); await pending.promise; calls.push("save:end"); },
      async () => { calls.push("clear"); },
      250,
    );

    store.schedule();
    await vi.advanceTimersByTimeAsync(250);
    const discarded = store.discard();
    expect(calls).toEqual(["save:start"]);

    pending.resolve();
    await discarded;

    expect(calls).toEqual(["save:start", "save:end", "clear"]);
  });

  it("reports a background persistence failure without leaking an unhandled rejection", async () => {
    const failure = new Error("disk full");
    const onError = vi.fn();
    const store = createHotExitStore(
      () => recovered("dirty"),
      async () => { throw failure; },
      async () => {},
      250,
      onError,
    );

    store.schedule();
    await vi.advanceTimersByTimeAsync(250);

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("does not overwrite recovery data while startup restoration is disabled", async () => {
    const save = vi.fn(async () => {});
    const clear = vi.fn(async () => {});
    const store = createHotExitStore(
      () => recovered("startup"),
      save,
      clear,
      250,
      vi.fn(),
      false,
    );

    store.schedule();
    await vi.advanceTimersByTimeAsync(500);
    await store.flush();
    store.enable(false);

    expect(save).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();

    store.schedule();
    await store.flush();
    expect(save).toHaveBeenCalledWith(recovered("startup"));
  });
});

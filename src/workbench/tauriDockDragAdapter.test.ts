import { describe, expect, it } from "vitest";
import {
  createTauriDockDragAdapter,
  logicalClientPointToPhysicalScreen,
  type TauriDockDragFacade,
} from "./tauriDockDragAdapter";

function facade(overrides: Partial<TauriDockDragFacade> = {}): TauriDockDragFacade {
  return {
    windowLabel: () => "view-7",
    innerPosition: async () => ({ x: -1440, y: 180 }),
    scaleFactor: async () => 1.5,
    cursorPosition: async () => ({ x: -720, y: 540 }),
    startDragging: async () => {},
    onMoved: async () => () => {},
    ...overrides,
  };
}

describe("Tauri native dock drag adapter", () => {
  it("keeps physical screen positions and a fractional scale factor intact", async () => {
    const adapter = createTauriDockDragAdapter(facade());

    await expect(adapter.metrics()).resolves.toEqual({
      windowLabel: "view-7",
      innerOrigin: { x: -1440, y: 180 },
      scaleFactor: 1.5,
    });
    await expect(adapter.cursor()).resolves.toEqual({ x: -720, y: 540 });
  });

  it("preserves movement listener lifetime through the adapter", async () => {
    let notify: (() => void) | undefined;
    let active = true;
    const adapter = createTauriDockDragAdapter(facade({
      onMoved: async (listener) => {
        notify = () => { if (active) listener(); };
        return () => { active = false; };
      },
    }));
    let moves = 0;

    const stop = await adapter.onWindowMoved(() => { moves += 1; });
    notify?.();
    expect(moves).toBe(1);

    stop();
    notify?.();
    expect(moves).toBe(1);
  });

  it("does not hide native startDragging failures", async () => {
    const denied = new Error("startDragging denied");
    const adapter = createTauriDockDragAdapter(facade({
      startDragging: async () => { throw denied; },
    }));

    await expect(adapter.startNativeWindowDrag()).rejects.toBe(denied);
  });

  it("converts logical client coordinates through a fractional mixed-DPI origin", () => {
    expect(logicalClientPointToPhysicalScreen({
      windowLabel: "view-7",
      innerOrigin: { x: -1440, y: 180 },
      scaleFactor: 1.5,
    }, { x: 480, y: 240 })).toEqual({ x: -720, y: 540 });
  });
});

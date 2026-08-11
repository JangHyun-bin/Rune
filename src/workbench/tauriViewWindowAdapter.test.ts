import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  startDragging: vi.fn(async () => {}),
  cursorPosition: vi.fn(async () => ({ x: -720, y: 540 })),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  PhysicalPosition: class PhysicalPosition { constructor(public x: number, public y: number) {} },
  PhysicalSize: class PhysicalSize { constructor(public width: number, public height: number) {} },
  availableMonitors: vi.fn(async () => []),
  cursorPosition: tauri.cursorPosition,
  primaryMonitor: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class WebviewWindow {
    label: string;
    constructor(label: string) { this.label = label; }
    once(event: string, listener: () => void) {
      if (event === "tauri://created") queueMicrotask(listener);
      return Promise.resolve(() => {});
    }
    close() { return Promise.resolve(); }
    setFocus() { return Promise.resolve(); }
    startDragging() { return tauri.startDragging(); }
  },
}));

import { tauriViewWindowAdapter } from "./tauriViewWindowAdapter";

describe("Tauri View window adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts native movement on the newly created target window", async () => {
    const handle = await tauriViewWindowAdapter.create("view-7", {
      url: "view.html",
      title: "Rune",
      width: 420,
      height: 640,
      minWidth: 280,
      minHeight: 240,
    });

    await handle.startDragging?.();

    expect(tauri.startDragging).toHaveBeenCalledTimes(1);
  });

  it("reads the global physical cursor for authoritative cross-window hit testing", async () => {
    await expect(tauriViewWindowAdapter.cursor?.()).resolves.toEqual({ x: -720, y: 540 });
    expect(tauri.cursorPosition).toHaveBeenCalledTimes(1);
  });
});

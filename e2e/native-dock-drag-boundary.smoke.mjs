import { spawnSync } from "node:child_process";

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const wait = (milliseconds) => Atomics.wait(
  new Int32Array(new SharedArrayBuffer(4)),
  0,
  0,
  milliseconds,
);

const checkedSpawn = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
};

const nativePointerDrag = (start, delta, scaleFactor) => {
  const end = { x: start.x + delta.x, y: start.y + delta.y };
  if (process.platform === "win32") {
    const typeDefinition = `
using System;
using System.Runtime.InteropServices;
public static class RuneNativePointer {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
`;
    const steps = Array.from({ length: 12 }, (_, index) => {
      const ratio = (index + 1) / 12;
      return `[RuneNativePointer]::SetCursorPos(${Math.round(start.x + delta.x * ratio)}, ${Math.round(start.y + delta.y * ratio)}) | Out-Null; Start-Sleep -Milliseconds 60`;
    }).join("\n");
    const command = `$typeDefinition = @'\n${typeDefinition}\n'@\nAdd-Type -TypeDefinition $typeDefinition\n[RuneNativePointer]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null\n[RuneNativePointer]::SetCursorPos(${Math.round(start.x)}, ${Math.round(start.y)}) | Out-Null\nStart-Sleep -Milliseconds 250\n[RuneNativePointer]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)\nStart-Sleep -Milliseconds 350\n${steps}\nStart-Sleep -Milliseconds 250\n[RuneNativePointer]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)`;
    checkedSpawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);
    return;
  }
  if (process.platform === "darwin") {
    const logicalStart = { x: start.x / scaleFactor, y: start.y / scaleFactor };
    const logicalDelta = { x: delta.x / scaleFactor, y: delta.y / scaleFactor };
    const python = `
import ctypes, time
class CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]
cg = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
cf = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
cg.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32]
cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
cf.CFRelease.argtypes = [ctypes.c_void_p]
def post(kind, x, y):
    event = cg.CGEventCreateMouseEvent(None, kind, CGPoint(x, y), 0)
    cg.CGEventPost(0, event)
    cf.CFRelease(event)
sx, sy = ${logicalStart.x}, ${logicalStart.y}
dx, dy = ${logicalDelta.x}, ${logicalDelta.y}
post(5, sx, sy)
time.sleep(.25)
post(1, sx, sy)
time.sleep(.35)
for step in range(1, 13):
    ratio = step / 12
    post(6, sx + dx * ratio, sy + dy * ratio)
    time.sleep(.06)
time.sleep(.25)
post(2, sx + dx, sy + dy)
`;
    checkedSpawn("python3", ["-c", python]);
    return;
  }

  checkedSpawn("xdotool", ["mousemove", "--sync", String(Math.round(start.x)), String(Math.round(start.y))]);
  wait(250);
  checkedSpawn("xdotool", ["mousedown", "1"]);
  wait(350);
  for (let step = 1; step <= 12; step += 1) {
    const ratio = step / 12;
    checkedSpawn("xdotool", [
      "mousemove",
      "--sync",
      String(Math.round(start.x + delta.x * ratio)),
      String(Math.round(start.y + delta.y * ratio)),
    ]);
    wait(60);
  }
  wait(250);
  checkedSpawn("xdotool", ["mouseup", "1"]);
};

describe("native docking drag boundary", () => {
  it("observes native movement, physical cursor coordinates, and drag completion", async () => {
    await $('html[data-wdio-ready="true"]').waitForExist();
    await $('html[data-wdio-native-dock-drag-ready="true"]').waitForExist();

    await browser.execute(async () => {
      const probe = window.__RUNE_NATIVE_DOCK_DRAG__;
      const handle = document.createElement("button");
      handle.id = "native-dock-drag-handle";
      handle.textContent = "Native dock drag boundary probe";
      Object.assign(handle.style, {
        position: "fixed",
        inset: "48px auto auto 48px",
        zIndex: "2147483647",
        width: "240px",
        height: "72px",
      });
      document.body.appendChild(handle);

      const state = {
        before: await probe.adapter.metrics(),
        moves: 0,
        lastMoveAt: null,
        pointerUpAt: null,
        clientPoint: null,
        cursorAtDown: null,
        startCalledAt: null,
        startResolvedAt: null,
        startError: null,
        dragPromise: null,
        inputEvents: [],
      };
      state.stop = await probe.adapter.onWindowMoved(() => {
        state.moves += 1;
        state.lastMoveAt = performance.now();
      });
      document.addEventListener("mouseup", () => {
        state.pointerUpAt = performance.now();
      }, { capture: true, once: true });
      const beginDrag = (event) => {
        state.inputEvents.push(event.type);
        if (state.dragPromise) return;
        state.clientPoint = { x: event.clientX, y: event.clientY };
        state.cursorAtDown = probe.adapter.cursor();
        state.startCalledAt = performance.now();
        state.dragPromise = probe.adapter.startNativeWindowDrag()
          .then(() => { state.startResolvedAt = performance.now(); })
          .catch((error) => { state.startError = String(error); });
      };
      handle.addEventListener("pointerdown", beginDrag);
      handle.addEventListener("mousedown", beginDrag);
      handle.addEventListener("click", (event) => { state.inputEvents.push(event.type); });
      probe.state = state;
    });

    const handle = await $("#native-dock-drag-handle");
    await handle.waitForDisplayed();
    const armed = await browser.execute(() => {
      const state = window.__RUNE_NATIVE_DOCK_DRAG__.state;
      return {
        start: window.__RUNE_NATIVE_DOCK_DRAG__.logicalClientPointToPhysicalScreen(
          state.before,
          { x: 168, y: 84 },
        ),
        scaleFactor: state.before.scaleFactor,
      };
    });
    nativePointerDrag(armed.start, { x: 180, y: 120 }, armed.scaleFactor);
    await browser.waitUntil(async () => browser.execute(() => (
      window.__RUNE_NATIVE_DOCK_DRAG__.state.startCalledAt !== null
    )), { timeoutMsg: "The native drag handle did not receive an OS press event" });

    const result = await browser.execute(async () => {
      const probe = window.__RUNE_NATIVE_DOCK_DRAG__;
      const state = probe.state;
      const actionReturnedAt = performance.now();
      await state.dragPromise;
      await new Promise((resolve) => setTimeout(resolve, 300));
      const stableStart = await probe.adapter.metrics();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const after = await probe.adapter.metrics();
      const cursorAtDown = await state.cursorAtDown;
      state.stop();
      return {
        before: state.before,
        after,
        stableStart,
        cursorAtDown,
        expectedCursorAtDown: probe.logicalClientPointToPhysicalScreen(state.before, state.clientPoint),
        fractionalFixture: probe.logicalClientPointToPhysicalScreen({
          windowLabel: "fixture",
          innerOrigin: { x: -1440, y: 180 },
          scaleFactor: 1.5,
        }, { x: 480, y: 240 }),
        moves: state.moves,
        lastMoveAt: state.lastMoveAt,
        pointerUpAt: state.pointerUpAt,
        actionReturnedAt,
        startCalledAt: state.startCalledAt,
        startResolvedAt: state.startResolvedAt,
        startError: state.startError,
        inputEvents: state.inputEvents,
      };
    });

    console.log(`NATIVE_DOCK_BOUNDARY ${JSON.stringify(result)}`);
    expect(result.startError).toBeNull();
    expect(result.startResolvedAt).not.toBeNull();
    expect(result.moves).toBeGreaterThan(0);
    expect(distance(result.before.innerOrigin, result.after.innerOrigin)).toBeGreaterThan(30);
    expect(distance(result.stableStart.innerOrigin, result.after.innerOrigin)).toBeLessThanOrEqual(2);
    expect(distance(result.cursorAtDown, result.expectedCursorAtDown)).toBeLessThanOrEqual(12);
    expect(result.fractionalFixture).toEqual({ x: -720, y: 540 });
  });
});

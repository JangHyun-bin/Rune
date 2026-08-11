import { distance, nativePointerDrag } from "./native-pointer.mjs";

/* The shared helper takes an absolute destination so evidence is comparable across suites. */
const dragBy = (start, delta, scaleFactor) => nativePointerDrag(start, {
  x: start.x + delta.x,
  y: start.y + delta.y,
}, scaleFactor);
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
    await $("#editor-toolbar").click();
    await browser.pause(200);
    const armed = await browser.execute(() => {
      const state = window.__RUNE_NATIVE_DOCK_DRAG__.state;
      const rect = document.querySelector("#native-dock-drag-handle").getBoundingClientRect();
      const clientPoint = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      return {
        metrics: state.before,
        clientPoint,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        start: window.__RUNE_NATIVE_DOCK_DRAG__.logicalClientPointToPhysicalScreen(
          state.before,
          clientPoint,
        ),
        scaleFactor: state.before.scaleFactor,
      };
    });
    console.log(`NATIVE_DOCK_ARMED ${JSON.stringify(armed)}`);
    dragBy(armed.start, { x: 180, y: 120 }, armed.scaleFactor);
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

const waitForWindowCount = async (count) => {
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === count, {
    timeout: 15_000,
    timeoutMsg: `Expected ${count} native Rune window(s)`,
  });
  return browser.getWindowHandles();
};

const singleSessionDocking = process.platform === "linux";

const mainHandle = async () => {
  for (const handle of await browser.getWindowHandles()) {
    await browser.switchToWindow(handle);
    if (await $("#editor").isExisting()) return handle;
  }
  throw new Error("Rune main window was not found");
};

const resetDetachedViews = async () => {
  await browser.pause(1_500);
  while ((await browser.getWindowHandles()).length > 1) {
    const handles = await browser.getWindowHandles();
    const initialCount = handles.length;
    let redocked = false;
    for (const handle of handles) {
      await browser.switchToWindow(handle);
      const button = await $(".detached-view-redock");
      if (await button.isExisting()) {
        await button.click();
        redocked = true;
        break;
      }
    }
    if (!redocked) throw new Error("Unexpected native window could not be re-docked");
    await waitForWindowCount(initialCount - 1);
  }
};

const tearOffOutline = async () => {
  await $('html[data-wdio-docking-release-gate-ready="true"]').waitForExist();
  const drag = await browser.execute(async () => {
    const gate = window.__RUNE_DOCKING_RELEASE_GATE__;
    await gate.normalizeWindow();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const element = [
      document.querySelector('.panel-tab[data-view-id="outline"]'),
      document.querySelector('.view-group-tab[data-view-id="outline"]'),
      document.querySelector('.workbench-view[data-view-id="outline"] .workbench-view-header'),
    ].find((candidate) => candidate?.getBoundingClientRect().width > 0);
    if (!gate || !element) throw new Error("Outline pointer source is unavailable");
    const rect = element.getBoundingClientRect();
    await gate.focus();
    const metrics = await gate.metrics();
    return {
      start: gate.toPhysical(metrics, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }),
      end: gate.toPhysical(metrics, { x: window.innerWidth + 96, y: Math.max(120, rect.top + rect.height / 2) }),
      scaleFactor: metrics.scaleFactor,
    };
  });
  console.log(`TEAR_OFF_POINTER ${JSON.stringify(drag)}`);
  nativePointerDrag(drag.start, drag.end, drag.scaleFactor);
  return waitForWindowCount(2);
};

const physicalPoint = async (selector, xRatio = 0.5, yRatio = 0.5) => browser.execute(async (value, x, y) => {
  const gate = window.__RUNE_DOCKING_RELEASE_GATE__;
  const element = document.querySelector(value);
  if (!gate || !element) throw new Error(`Docking release-gate target is unavailable: ${value}`);
  const rect = element.getBoundingClientRect();
  await gate.focus();
  const metrics = await gate.metrics();
  return {
    point: gate.toPhysical(metrics, { x: rect.left + rect.width * x, y: rect.top + rect.height * y }),
    clientPoint: { x: rect.left + rect.width * x, y: rect.top + rect.height * y },
    metrics,
  };
}, selector, xRatio, yRatio);

describe("native Workbench release smoke", () => {
  it("preserves a dirty editor while tearing off and persists the committed layout", async () => {
    await $('html[data-wdio-ready="true"]').waitForExist();
    await browser.execute(() => window.dispatchEvent(new Event("rune:wdio-restore-view-windows")));
    await resetDetachedViews();
    const main = await mainHandle();
    await browser.switchToWindow(main);
    const editor = await $('.cm-content[contenteditable="true"]');
    await editor.waitForDisplayed();
    await editor.setValue("RC dirty buffer sentinel");
    expect(await editor.getText()).toContain("RC dirty buffer sentinel");

    const exactBeforeCancel = await browser.execute(() => window.__RUNE_DOCKING_RELEASE_GATE__.serializedLayout());
    await browser.execute(() => {
      const header = [
        document.querySelector('.panel-tab[data-view-id="outline"]'),
        document.querySelector('.view-group-tab[data-view-id="outline"]'),
        document.querySelector('.workbench-view[data-view-id="outline"] .workbench-view-header'),
      ].find((candidate) => candidate?.getBoundingClientRect().width > 0);
      header.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 91, clientX: 20, clientY: 20 }));
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 91, clientX: 40, clientY: 40 }));
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    const exactAfterCancel = await browser.execute(() => window.__RUNE_DOCKING_RELEASE_GATE__.serializedLayout());
    expect(exactAfterCancel).toBe(exactBeforeCancel);

    await browser.execute(() => delete document.documentElement.dataset.wdioSavedWindowCount);
    const handles = await tearOffOutline();
    const detachedHandle = handles.find((handle) => handle !== main);
    expect(detachedHandle).toBeTruthy();
    await browser.switchToWindow(detachedHandle);
    await $(".detached-view-redock").waitForDisplayed();

    if (singleSessionDocking) {
      await $('html[data-wdio-docking-release-gate-ready="true"]').waitForExist();
      await browser.switchToWindow(main);
      await browser.execute(() => window.__RUNE_DOCKING_RELEASE_GATE__.preparePanel());
      const target = await physicalPoint('.view-group[data-container-id="panel"]', 0.7, 0.5);
      await browser.switchToWindow(detachedHandle);
      const source = await physicalPoint('.detached-view-tabs [data-view-id="outline"]', 0.5, 0.9);
      console.log(`CROSS_WINDOW_POINTER ${JSON.stringify({ source, target })}`);
      nativePointerDrag(source.point, target.point, source.metrics.scaleFactor, {
        linuxWindowTitle: "^Rune",
        linuxWindowMaxWidth: 600,
        linuxWindowPosition: {
          x: source.point.x - 80,
          y: source.point.y - 40,
        },
        linuxFocusClick: true,
      });
      await browser.pause(2_000);
      if ((await browser.getWindowHandles()).length !== 1) {
        await browser.switchToWindow(main);
        const mainState = await browser.execute(() => ({
          workspace: window.__RUNE_DOCKING_RELEASE_GATE__.workspace(),
          overlay: document.querySelector(".dock-target-overlay")?.className ?? null,
        }));
        await browser.switchToWindow(detachedHandle);
        const detachedState = await browser.execute(() => window.__RUNE_DOCKING_RELEASE_GATE__.dockState());
        console.log(`CROSS_WINDOW_PENDING ${JSON.stringify({ mainState, detachedState })}`);
      }
      await waitForWindowCount(1);
      await browser.switchToWindow(main);
      const after = await browser.execute(() => window.__RUNE_DOCKING_RELEASE_GATE__.workspace());
      const group = Object.values(after.workbench.viewGroups.panel.groups)
        .find((candidate) => candidate.viewIds.includes("outline"));
      expect(after.workbench.views.outline.containerId).toBe("panel");
      expect(group.viewIds).toEqual(["search", "outline"]);
      await $('html[data-wdio-saved-window-count="0"]').waitForExist();
    } else {
      await browser.switchToWindow(main);
      await $('html[data-wdio-saved-window-count="1"]').waitForExist();
    }

    await browser.switchToWindow(main);
    expect(await $('.cm-content[contenteditable="true"]').getText()).toContain("RC dirty buffer sentinel");
    await browser.execute(() => window.dispatchEvent(new Event("rune:wdio-save-shutdown-layout")));
    await $('html[data-wdio-shutdown-saved="true"]').waitForExist();
  });
});
import { nativePointerDrag } from "./native-pointer.mjs";

import { nativePointerDrag } from "./native-pointer.mjs";

const waitForWindowCount = async (count) => {
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === count, {
    timeout: 20_000,
    timeoutMsg: `Expected ${count} native Rune window(s)`,
  });
  return browser.getWindowHandles();
};

const findWindows = async () => {
  let main = null;
  let detached = null;
  await browser.waitUntil(async () => {
    let nextMain = null;
    let nextDetached = null;
    const handles = await browser.getWindowHandles();
    for (const handle of handles) {
      try {
        await browser.switchToWindow(handle);
        if (await $("#editor").isExisting()) nextMain = handle;
        if (await $(".detached-view-shell").isExisting()) nextDetached = handle;
      } catch (error) {
        if (!String(error).includes("no such window")) throw error;
      }
    }
    if (!nextMain || !nextDetached) return false;
    main = nextMain;
    detached = nextDetached;
    return true;
  }, { timeout: 15_000, timeoutMsg: "Expected restored main and detached Rune windows" });
  return { main, detached };
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
    metrics,
  };
}, selector, xRatio, yRatio);

const snapshot = () => browser.execute(() => window.__RUNE_DOCKING_RELEASE_GATE__.workspace());

describe("real cross-window docking release gate", () => {
  it("uses an actual OS pointer to dock restored Outline into the requested Panel group", async () => {
    await $('html[data-wdio-ready="true"]').waitForExist();
    await browser.execute(() => window.dispatchEvent(new Event("rune:wdio-restore-view-windows")));
    await waitForWindowCount(2);
    const { main, detached } = await findWindows();
    expect(main).toBeTruthy();
    expect(detached).toBeTruthy();

    await browser.switchToWindow(main);
    await $('html[data-wdio-docking-release-gate-ready="true"]').waitForExist();
    const dirty = await $('.cm-content[contenteditable="true"]').getText();
    await browser.execute(() => window.__RUNE_DOCKING_RELEASE_GATE__.preparePanel());
    const target = await physicalPoint('.view-group[data-container-id="panel"]', 0.7, 0.5);

    await browser.switchToWindow(detached);
    await $('html[data-wdio-docking-release-gate-ready="true"]').waitForExist();
    const source = await physicalPoint('.detached-view-tabs [data-view-id="outline"]');
    console.log(`CROSS_WINDOW_POINTER ${JSON.stringify({ source, target })}`);
    nativePointerDrag(source.point, target.point, source.metrics.scaleFactor);

    await browser.pause(1_000);
    if ((await browser.getWindowHandles()).length !== 1) {
      await browser.switchToWindow(main);
      console.log(`CROSS_WINDOW_PENDING ${JSON.stringify(await snapshot())}`);
    }
    await waitForWindowCount(1);
    await browser.switchToWindow(main);
    const after = await snapshot();
    const outline = after.workbench.views.outline;
    const group = Object.values(after.workbench.viewGroups.panel.groups)
      .find((candidate) => candidate.viewIds.includes("outline"));
    expect(outline.containerId).toBe("panel");
    expect(group).toBeTruthy();
    expect(group.viewIds.indexOf("outline")).toBe(1);
    expect(group.viewIds).toEqual(["search", "outline"]);
    expect(await $('.cm-content[contenteditable="true"]').getText()).toBe(dirty);
    expect((await browser.getWindowHandles()).length).toBe(1);
    await browser.execute(() => window.dispatchEvent(new Event("rune:wdio-save-shutdown-layout")));
    await $('html[data-wdio-shutdown-saved="true"]').waitForExist();
  });
});

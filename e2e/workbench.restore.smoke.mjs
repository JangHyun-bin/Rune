const waitForWindowCount = async (count) => {
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === count, {
    timeout: 15_000,
    timeoutMsg: `Expected ${count} native Rune window(s)`,
  });
  return browser.getWindowHandles();
};

describe("native Workbench layout recovery smoke", () => {
  it("restores the detached View group in a new app session and re-docks it", async () => {
    await $('html[data-wdio-ready="true"]').waitForExist();
    await $('html[data-wdio-pending-window-count="1"]').waitForExist();
    await $('html[data-wdio-hot-exit-recovered="true"]').waitForExist();
    await browser.execute(() => window.dispatchEvent(new Event("rune:wdio-restore-view-windows")));
    const handles = await waitForWindowCount(2);
    let main;
    let detached;
    await browser.waitUntil(async () => {
      for (const handle of handles) {
        await browser.switchToWindow(handle);
        if (await $("#editor").isExisting()) main = handle;
        if (await $(".detached-view-redock").isExisting()) detached = handle;
      }
      return Boolean(main && detached);
    }, { timeout: 15_000, timeoutMsg: "Expected restored Rune windows to become ready" });
    expect(main).toBeTruthy();
    expect(detached).toBeTruthy();

    await browser.switchToWindow(detached);
    const button = await $(".detached-view-redock");
    await button.waitForClickable();
    await button.click();
    await waitForWindowCount(1);
    await browser.switchToWindow(main);
    await $('.workbench-view[data-view-id="outline"]').waitForDisplayed();
    expect(await $('.cm-content[contenteditable="true"]').getText()).toContain("RC dirty buffer sentinel");
  });
});

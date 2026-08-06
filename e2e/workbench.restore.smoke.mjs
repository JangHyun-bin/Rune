const waitForWindowCount = async (count) => {
  await browser.waitUntil(async () => (await browser.tauri.listWindows()).length === count, {
    timeout: 15_000,
    timeoutMsg: `Expected ${count} native Rune window(s)`,
  });
  return browser.tauri.listWindows();
};

describe("native Workbench layout recovery smoke", () => {
  it("restores the detached View group in a new app session and re-docks it", async () => {
    const labels = await waitForWindowCount(2);
    const detached = labels.find((label) => label !== "main");
    expect(labels).toContain("main");
    expect(detached).toBeTruthy();

    await browser.tauri.switchWindow("main");
    const main = await browser.getWindowHandle();
    await browser.tauri.switchWindow(detached);
    const button = await $(".detached-view-redock");
    await button.waitForClickable();
    await button.click();
    await browser.switchToWindow(main);
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1, {
      timeout: 15_000,
      timeoutMsg: "Expected the detached Rune window to close",
    });
    await $('.workbench-view[data-view-id="outline"]').waitForDisplayed();
  });
});

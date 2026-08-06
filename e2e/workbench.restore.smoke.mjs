const waitForWindowCount = async (count) => {
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === count, {
    timeout: 15_000,
    timeoutMsg: `Expected ${count} native Rune window(s)`,
  });
  return browser.getWindowHandles();
};

describe("native Workbench layout recovery smoke", () => {
  it("restores the detached View group in a new app session and re-docks it", async () => {
    const handles = await waitForWindowCount(2);
    let main;
    let detached;
    for (const handle of handles) {
      await browser.switchToWindow(handle);
      if (await $("#editor").isExisting()) main = handle;
      if (await $(".detached-view-redock").isExisting()) detached = handle;
    }
    expect(main).toBeTruthy();
    expect(detached).toBeTruthy();

    await browser.switchToWindow(detached);
    const button = await $(".detached-view-redock");
    await button.waitForClickable();
    await button.click();
    await waitForWindowCount(1);
    await browser.switchToWindow(main);
    await $('.workbench-view[data-view-id="outline"]').waitForDisplayed();
  });
});
